"""IndexNow: avisos con el cliente HTTP y la base simulados."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from app import indexnow
from app.config import Settings, settings
from app.liga import gestion

CLAVE = "k" * 32


@pytest.fixture(autouse=True)
def _con_clave_y_sin_base(monkeypatch):
    monkeypatch.setattr(settings, "indexnow_clave", CLAVE)
    monkeypatch.setattr(settings, "url_publica", "https://vennett.app")
    # Sin interruptor guardado manda el defecto del catálogo, sin tocar la base.
    monkeypatch.setattr(gestion, "_ajuste_booleano", lambda clave, por_defecto: por_defecto)


def _post(monkeypatch, estado=200, error=None):
    llamadas = []

    def post(url, json=None, timeout=None):
        llamadas.append({"url": url, "json": json})
        if error:
            raise error
        return SimpleNamespace(status_code=estado)

    monkeypatch.setattr(indexnow.httpx, "post", post)
    return llamadas


def test_la_clave_publicada_es_la_que_usa_el_servicio():
    por_defecto = Settings.model_fields["indexnow_clave"].default
    fichero = Path(__file__).resolve().parents[2] / "frontend" / "public" / f"{por_defecto}.txt"
    assert por_defecto and fichero.read_text(encoding="utf-8") == por_defecto


def test_envia_solo_las_urls_propias_sin_repetir_con_la_clave_y_su_ubicacion(monkeypatch):
    llamadas = _post(monkeypatch)
    ok = indexnow.enviar(["https://vennett.app/blog", "https://vennett.app/blog",
                          "https://otro.test/x", "https://vennett.app.otro.test/y",
                          "https://vennett.app/en/blog"])
    assert ok is True
    assert llamadas == [{"url": indexnow.ENDPOINT, "json": {
        "host": "vennett.app", "key": CLAVE, "keyLocation": f"https://vennett.app/{CLAVE}.txt",
        "urlList": ["https://vennett.app/blog", "https://vennett.app/en/blog"]}}]


@pytest.mark.parametrize(("estado", "esperado"), [(200, True), (202, True), (400, False),
                                                    (403, False), (422, False), (429, False)])
def test_acepta_200_y_202_y_rechaza_lo_demas(monkeypatch, estado, esperado):
    _post(monkeypatch, estado)
    assert indexnow.enviar(["https://vennett.app/"]) is esperado


def test_sin_clave_o_sin_urls_propias_no_llama(monkeypatch):
    llamadas = _post(monkeypatch)
    assert indexnow.enviar([]) is False
    assert indexnow.enviar(["https://otro.test/"]) is False
    monkeypatch.setattr(settings, "indexnow_clave", "")
    assert indexnow.enviar(["https://vennett.app/"]) is False
    assert llamadas == []


def test_un_fallo_de_red_no_lanza(monkeypatch):
    _post(monkeypatch, error=httpx.ConnectError("sin red"))
    assert indexnow.enviar(["https://vennett.app/"]) is False


def test_parte_en_lotes_y_un_lote_rechazado_hace_falso_el_total(monkeypatch):
    monkeypatch.setattr(indexnow, "MAX_URLS", 2)
    llamadas = _post(monkeypatch)
    urls = [f"https://vennett.app/p{i}" for i in range(5)]
    assert indexnow.enviar(urls) is True
    assert [len(c["json"]["urlList"]) for c in llamadas] == [2, 2, 1]

    respuestas = iter([200, 429, 200])
    monkeypatch.setattr(indexnow.httpx, "post",
                        lambda *a, **k: SimpleNamespace(status_code=next(respuestas)))
    assert indexnow.enviar(urls) is False


def test_avisar_respeta_el_interruptor_del_admin(monkeypatch):
    llamadas = _post(monkeypatch)
    consultas = []
    monkeypatch.setattr(gestion, "_ajuste_booleano",
                        lambda clave, por_defecto: consultas.append((clave, por_defecto)) or False)
    assert indexnow.avisar(["https://vennett.app/"]) is False
    assert llamadas == []
    assert consultas == [("procesos.indexnow.auto", True)]
    monkeypatch.setattr(gestion, "_ajuste_booleano", lambda clave, por_defecto: True)
    assert indexnow.avisar(["https://vennett.app/"]) is True
    assert len(llamadas) == 1


def test_avisar_sin_clave_ni_siquiera_consulta_la_base(monkeypatch):
    consultas = []
    monkeypatch.setattr(settings, "indexnow_clave", "")
    monkeypatch.setattr(gestion, "_ajuste_booleano", lambda *a: consultas.append(a) or True)
    assert indexnow.avisar(["https://vennett.app/"]) is False
    assert consultas == []


def test_avisar_nunca_lanza_aunque_falle_la_base(monkeypatch):
    def roto(clave, por_defecto):
        raise RuntimeError("base caída")

    monkeypatch.setattr(gestion, "_ajuste_booleano", roto)
    assert indexnow.avisar(["https://vennett.app/"]) is False


def test_el_interruptor_esta_en_el_catalogo_del_admin_encendido_por_defecto():
    meta = gestion.CATALOGO[indexnow.AJUSTE]
    assert meta.tipo == "interruptor" and meta.defecto is True and meta.grupo == "Procesos"


def test_urls_de_articulos_en_los_dos_idiomas_con_los_listados_y_el_slug_escapado():
    assert indexnow.urls_de_articulos(["uno", "ñandú y más"]) == [
        "https://vennett.app/blog", "https://vennett.app/en/blog",
        "https://vennett.app/blog/uno", "https://vennett.app/en/blog/uno",
        "https://vennett.app/blog/%C3%B1and%C3%BA%20y%20m%C3%A1s",
        "https://vennett.app/en/blog/%C3%B1and%C3%BA%20y%20m%C3%A1s"]


class _Db:
    def __init__(self, filas):
        self.filas = filas
        self.consultas = []

    def execute(self, sql, params=None):
        self.consultas.append((str(sql), params))
        return SimpleNamespace(all=lambda: self.filas)

    def commit(self):
        pass


def test_urls_del_criptico_son_las_portadas_el_archivo_y_el_acertijo_de_cada_idioma():
    db = _Db([("en", 3), ("es", 7)])
    assert indexnow.urls_del_criptico(db, "2026-11-18") == [
        "https://vennett.app/criptico", "https://vennett.app/en/criptico",
        "https://vennett.app/criptico/archivo", "https://vennett.app/en/criptico/archivo",
        "https://vennett.app/en/criptico/3", "https://vennett.app/criptico/7"]
    sql, params = db.consultas[0]
    assert "estado = 'publicado'" in sql and params == {"dia": "2026-11-18"}


def test_el_job_del_criptico_avisa_y_deja_constancia(monkeypatch):
    @contextmanager
    def sesion(_fabrica):
        yield _Db([("es", 7), ("en", 3)])

    avisos, auditoria = [], []
    monkeypatch.setattr(indexnow, "sesion", sesion)
    monkeypatch.setattr(indexnow, "avisar", lambda urls: avisos.append(urls) or True)
    monkeypatch.setattr(indexnow, "auditar",
                        lambda db, accion, objeto, datos, uid: auditoria.append((accion, datos)))
    assert indexnow.job_criptico() is True
    assert avisos[0][-2:] == ["https://vennett.app/criptico/7", "https://vennett.app/en/criptico/3"]
    assert auditoria == [("indexnow.criptico", {"urls": 6, "aceptado": True})]


def test_el_job_del_criptico_no_lanza_si_falla(monkeypatch):
    fallos = []

    @contextmanager
    def sesion(_fabrica):
        raise RuntimeError("base caída")
        yield

    monkeypatch.setattr(indexnow, "sesion", sesion)
    monkeypatch.setattr(indexnow, "auditar_fallo", lambda *a: fallos.append(a[1]))
    assert indexnow.job_criptico() is None
    assert fallos == ["indexnow_criptico"]


def test_el_sitemap_se_lee_con_sus_entidades_y_se_manda_entero(monkeypatch):
    xml = ("<urlset><url><loc>https://vennett.app/</loc></url>"
           "<url><loc> https://vennett.app/en/liga?a=1&amp;b=2 </loc></url></urlset>")
    monkeypatch.setattr(indexnow.httpx, "get", lambda url, **k: SimpleNamespace(
        text=xml, raise_for_status=lambda: None))
    assert indexnow.urls_del_sitemap() == ["https://vennett.app/", "https://vennett.app/en/liga?a=1&b=2"]
    llamadas = _post(monkeypatch)
    assert indexnow.enviar_sitemap() == (2, True)
    assert len(llamadas[0]["json"]["urlList"]) == 2
