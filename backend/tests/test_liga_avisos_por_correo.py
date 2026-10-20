"""Los avisos de la liga salen también por correo a quien lo activó en Cuenta › Avisos. La base de
datos, el push y el correo se simulan; la consulta real se prueba en test_procesos_integracion."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app import correo, push
from app.config import settings
from app.liga import avisos

CIERRA = datetime(2027, 1, 4, 14, 0, tzinfo=UTC)          # 15:00 en Madrid
CON_CORREO = ("cartera_lista", "quitadas_vaciadas", "sin_pregunta", "empieza")


class _Resultado:
    def __init__(self, filas: list) -> None:
        self._filas = filas

    def all(self) -> list:
        return self._filas

    def one_or_none(self):  # noqa: ANN201
        return self._filas[0] if self._filas else None


class _Db:
    """Responde a las lecturas de `avisar` y apunta los borrados y los commits."""

    def __init__(self, perfil=None, subs=()) -> None:  # noqa: ANN001
        self.perfil, self.subs = perfil, list(subs)
        self.borradas: list[int] = []
        self.commits = 0
        self.guardados: list[dict] = []

    def execute(self, sql, params=None):  # noqa: ANN001, ANN201
        texto = str(sql)
        if "insert into liga.avisos" in texto:
            self.guardados.append(params)
            return _Resultado([])
        if "perfiles_privados" in texto:
            return _Resultado([self.perfil] if self.perfil else [])
        if "delete from liga.suscripciones_push" in texto:
            self.borradas.append(params["i"])
            return _Resultado([])
        if "from liga.suscripciones_push" in texto:
            return _Resultado(self.subs)
        raise AssertionError(f"consulta inesperada: {texto}")

    def commit(self) -> None:
        self.commits += 1


def perfil(**campos) -> SimpleNamespace:  # noqa: ANN003
    base = {"idioma": "es", "avisos_correo": True, "correo_avisos": None,
            "email": "ana@ejemplo.com", "zona_horaria": None}
    return SimpleNamespace(**{**base, **campos})


def suscripcion(n: int) -> SimpleNamespace:
    return SimpleNamespace(id=n, endpoint=f"https://fcm.googleapis.com/fcm/send/{n}",
                           p256dh="p", auth="a")


@pytest.fixture
def buzon(monkeypatch) -> list:  # noqa: ANN001
    """Los correos que saldrían: (destino, asunto, texto, html). Sin salir a ninguna red."""
    enviados: list = []
    monkeypatch.setattr(correo, "enviar", lambda destino, asunto, texto, html=None:
                        enviados.append((destino, asunto, texto, html)) or True)
    return enviados


@pytest.fixture
def empujes(monkeypatch) -> list:  # noqa: ANN001
    """Los push que saldrían: (endpoint, contenido)."""
    enviados: list = []

    def falso(endpoint, p256dh, auth, payload):  # noqa: ANN001, ANN202
        enviados.append((endpoint, json.loads(payload)))
        return "ok"

    monkeypatch.setattr(push, "enviar", falso)
    return enviados


def test_con_el_correo_activado_el_aviso_sale_tambien_por_correo(buzon) -> None:  # noqa: ANN001
    assert avisos.avisar(_Db(perfil()), "u1", "cartera_lista", cierra=CIERRA) == 0
    ((destino, asunto, texto, html),) = buzon
    assert destino == "ana@ejemplo.com"
    assert asunto == "Tu cartera está lista"
    assert "Puedes cambiar empresas hasta el 4 de enero a las 15:00." in texto
    assert f"Ver en Vennett: {settings.url_publica}/mias" in texto
    assert f'href="{settings.url_publica}/mias"' in html


def test_el_correo_sale_en_el_idioma_de_la_cuenta(buzon) -> None:  # noqa: ANN001
    avisos.avisar(_Db(perfil(idioma="en")), "u1", "cartera_lista", cierra=CIERRA)
    ((_, asunto, texto, _),) = buzon
    assert asunto == "Your portfolio is ready"
    assert "You can swap companies until January 4 at 15:00." in texto
    assert f"See it in Vennett: {settings.url_publica}/mias" in texto


def test_con_el_correo_apagado_no_sale_correo(buzon, empujes) -> None:  # noqa: ANN001
    db = _Db(perfil(avisos_correo=False), [suscripcion(1)])
    assert avisos.avisar(db, "u1", "empieza") == 1
    assert buzon == []


def test_la_direccion_propia_gana_a_la_de_la_cuenta(buzon) -> None:  # noqa: ANN001
    avisos.avisar(_Db(perfil(correo_avisos="otra@ejemplo.com")), "u1", "empieza")
    assert [destino for destino, *_ in buzon] == ["otra@ejemplo.com"]


@pytest.mark.parametrize("campos", [{"email": None}, {"email": ""}])
def test_sin_destinatario_no_sale_correo(buzon, campos) -> None:  # noqa: ANN001
    avisos.avisar(_Db(perfil(**campos)), "u1", "empieza")
    assert buzon == []


def test_una_cuenta_sin_perfil_no_recibe_correo(buzon) -> None:  # noqa: ANN001
    assert avisos.avisar(_Db(None), "u1", "empieza") == 0
    assert buzon == []


@pytest.mark.parametrize("tipo", CON_CORREO)
def test_cada_aviso_de_la_liga_sale_por_correo(buzon, tipo) -> None:  # noqa: ANN001
    avisos.avisar(_Db(perfil()), "u1", tipo, cierra=CIERRA, name="Mi estrategia")
    assert len(buzon) == 1


def test_el_recordatorio_de_cierre_de_cambios_sigue_solo_por_push(buzon, empujes) -> None:  # noqa: ANN001
    db = _Db(perfil(), [suscripcion(1)])
    assert avisos.avisar(db, "u1", "cambios_cierran", cierra=CIERRA) == 1
    assert buzon == []


def test_el_recuento_es_el_del_push_y_el_correo_sale_una_vez(buzon, empujes) -> None:  # noqa: ANN001
    db = _Db(perfil(), [suscripcion(1), suscripcion(2)])
    assert avisos.avisar(db, "u1", "empieza") == 2
    assert len(empujes) == 2
    assert len(buzon) == 1


def test_el_push_sigue_podando_lo_que_el_navegador_dio_de_baja(monkeypatch, buzon) -> None:  # noqa: ANN001
    monkeypatch.setattr(push, "enviar", lambda e, p, a, c: "baja" if e.endswith("/2") else "ok")
    db = _Db(perfil(), [suscripcion(1), suscripcion(2)])
    assert avisos.avisar(db, "u1", "empieza") == 1
    assert db.borradas == [2]
    assert db.commits == 1


def test_si_el_correo_falla_el_aviso_no_se_rompe(monkeypatch, empujes) -> None:  # noqa: ANN001
    def rota(*_a, **_k):  # noqa: ANN002, ANN003, ANN202
        raise RuntimeError("sin red")

    monkeypatch.setattr(correo, "enviar", rota)
    assert avisos.avisar(_Db(perfil(), [suscripcion(1)]), "u1", "empieza") == 1
    assert len(empujes) == 1


def test_con_caducidad_el_aviso_se_guarda_antes_del_push(buzon, empujes) -> None:  # noqa: ANN001
    db = _Db(perfil(avisos_correo=False), [suscripcion(1)])
    avisos.avisar(db, "u1", "cartera_lista", cierra=CIERRA, caduca=CIERRA,
                  datos={"jornada_id": 3})
    assert len(db.guardados) == 1
    assert db.guardados[0]["t"] == "cartera_lista"
    assert json.loads(db.guardados[0]["d"]) == {"jornada_id": 3}
    assert db.guardados[0]["c"] == CIERRA


def test_sin_caducidad_no_se_guarda(buzon, empujes) -> None:  # noqa: ANN001
    db = _Db(perfil(avisos_correo=False), [suscripcion(1)])
    avisos.avisar(db, "u1", "empieza")
    assert db.guardados == []


def test_la_hora_del_aviso_va_en_la_zona_de_la_cuenta(buzon, empujes) -> None:  # noqa: ANN001
    db = _Db(perfil(avisos_correo=False, zona_horaria="America/New_York"), [suscripcion(1)])
    avisos.avisar(db, "u1", "cartera_lista", cierra=CIERRA)
    assert "09:00" in json.dumps(empujes[0][1], ensure_ascii=False)


def test_una_zona_que_no_existe_vuelve_a_madrid(buzon, empujes) -> None:  # noqa: ANN001
    db = _Db(perfil(avisos_correo=False, zona_horaria="Marte/Base"), [suscripcion(1)])
    avisos.avisar(db, "u1", "cartera_lista", cierra=CIERRA)
    assert "15:00" in json.dumps(empujes[0][1], ensure_ascii=False)
