"""Envío diario contra la BD de pruebas, sin correo externo."""

import json
import os
import uuid
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app import correo
from app.config import settings
from app.criptico import envio

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture(params=["es", "en"])
def datos(request, monkeypatch):
    pytest.importorskip("psycopg")
    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    idioma = request.param
    with motor.connect() as cx:
        exterior = cx.begin()
        try:
            cx.execute(text("""
                insert into liga.ajustes (clave, valor) values ('criptico.envio.activo', 'true')
                on conflict (clave) do update set valor = excluded.valor
            """))
            dia = cx.execute(text("""
                select d::date from generate_series(date '2090-01-02', date '2099-12-31',
                                                    interval '1 day') d
                where not exists (select 1 from criptico.acertijos
                    where idioma = :idioma and dia in (d::date, d::date - 1))
                order by d limit 1
            """), {"idioma": idioma}).scalar_one()
            numero = cx.execute(text("select coalesce(max(numero), 0) + 2 "
                                     "from criptico.acertijos where idioma = :idioma"),
                                {"idioma": idioma}).scalar_one()
            ids = []
            for desplazamiento, respuesta in ((0, "SECRETOHOY"), (-1, "AYER")):
                ids.append(cx.execute(text("""
                    insert into criptico.acertijos
                        (idioma, numero, dia, pista, longitud, respuesta, palabra, nivel,
                         ayudas, resolucion, concepto, ejemplo, estado)
                    values (:idioma, :numero, :dia, cast(:pista as jsonb), :longitud,
                            :respuesta, :respuesta, 'facil', '{}', :resolucion,
                            :concepto, 'Ejemplo', 'publicado') returning id
                """), {"idioma": idioma, "numero": numero + desplazamiento,
                       "dia": dia + timedelta(days=desplazamiento),
                       "pista": json.dumps([{"texto": "[[Una <pista>]] & ", "papel": "def"},
                                            {"texto": "otra", "papel": "mat"}]),
                       "longitud": len(respuesta), "respuesta": respuesta,
                       "resolucion": "Resolución <explicada>",
                       "concepto": "Concepto & contexto"}).scalar_one())
            # Aísla los destinatarios sin modificar las suscripciones que ya tenga la BD.
            cx.execute(text("""
                insert into criptico.entregas (acertijo_id, suscriptor_id, estado)
                select :aid, id, 'enviado' from criptico.suscriptores
                where idioma = :idioma and estado = 'confirmado'
            """), {"aid": ids[0], "idioma": idioma})
            suscriptores = []
            for estado in ("confirmado", "confirmado", "pendiente", "baja"):
                token = uuid.uuid4().hex
                sid = cx.execute(text("""
                    insert into criptico.suscriptores
                        (correo, idioma, estado, token_baja, confirmado_en, hash_alta,
                         alta_expira, baja_en)
                    values (:correo, :idioma, :estado, :token, now(), :hash,
                            now() + interval '7 days', now()) returning id
                """), {"correo": token + "@prueba.local", "idioma": idioma,
                       "estado": estado, "token": token, "hash": token * 2}).scalar_one()
                if estado == "confirmado":
                    suscriptores.append((sid, token))
            buzon = []

            def enviar(destino, asunto, texto, html, cabeceras=None):
                buzon.append({"destino": destino, "asunto": asunto, "texto": texto,
                              "html": html, "cabeceras": cabeceras})
                return True

            monkeypatch.setattr(correo, "enviar", enviar)
            yield {"cx": cx, "fabrica": lambda: Session(
                bind=cx, join_transaction_mode="create_savepoint"), "idioma": idioma,
                "ahora": datetime.combine(dia, time(7), ZoneInfo("Europe/Madrid")),
                "hoy": ids[0], "ayer": ids[1], "suscriptores": suscriptores, "buzon": buzon,
                "numero": numero}
        finally:
            exterior.rollback()
    motor.dispose()


def _enviar(datos):
    return envio.enviar_del_dia(datos["idioma"], datos["fabrica"], datos["ahora"])


def _estados(datos):
    return dict(datos["cx"].execute(text("""
        select suscriptor_id, estado from criptico.entregas where acertijo_id = :aid
    """), {"aid": datos["hoy"]}).all())


def test_apagado(datos):
    datos["cx"].execute(text("update liga.ajustes set valor = 'false' "
                             "where clave = 'criptico.envio.activo'"))
    antes = _estados(datos)
    assert _enviar(datos) == 0
    assert not datos["buzon"]
    assert _estados(datos) == antes


def test_envio_unico_y_cabeceras(datos):
    assert _enviar(datos) == 2
    assert _enviar(datos) == 0
    assert len(datos["buzon"]) == 2
    ruta = "/en/criptico" if datos["idioma"] == "en" else "/criptico"
    for mensaje, (sid, token) in zip(datos["buzon"], datos["suscriptores"], strict=True):
        url = settings.url_publica + ruta + "/baja?token=" + token
        un_clic = settings.url_publica + "/api/criptico/baja?token=" + token
        assert mensaje["cabeceras"] == {
            "List-Unsubscribe": f"<{un_clic}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
        assert mensaje["destino"] == token + "@prueba.local"
        assert url in mensaje["texto"] and url in mensaje["html"]
        assert settings.url_publica + ruta in mensaje["texto"]
        assert _estados(datos)[sid] == "enviado"


def test_borrador(datos):
    datos["cx"].execute(text("update criptico.acertijos set estado = 'borrador' where id = :id"),
                        {"id": datos["hoy"]})
    assert _enviar(datos) == 0
    assert not datos["buzon"]


@pytest.mark.parametrize("con_media", [False, True])
def test_solo_respuesta_de_ayer_y_escape(datos, con_media):
    datos["cx"].execute(text("""
        insert into criptico.resultados (acertijo_id, ayudas_usadas)
        select :id, 1 from generate_series(1, :n)
    """), {"id": datos["ayer"], "n": 20 if con_media else 19})
    assert _enviar(datos) == 2
    for mensaje in datos["buzon"]:
        assert "SECRETOHOY" not in " ".join(mensaje[k] for k in ("asunto", "texto", "html"))
        assert "AYER" in mensaje["texto"] and "AYER" in mensaje["html"]
        assert "Resolución <explicada>" in mensaje["texto"]
        assert "Resolución &lt;explicada&gt;" in mensaje["html"]
        assert "Concepto &amp; contexto" in mensaje["html"]
        assert "Una &lt;pista&gt; &amp; otra" in mensaje["html"]
        assert "[[" not in mensaje["asunto"]
        assert mensaje["asunto"].endswith("Una <pista> & otra")
        assert mensaje["html"].count('class="hoja linea"') == len("SECRETOHOY")
        assert "prefers-color-scheme: dark" in mensaje["html"]
        linea_media = "20 personas" if datos["idioma"] == "es" else "20 people"
        assert (linea_media in mensaje["html"]) == con_media
        assert (linea_media in mensaje["texto"]) == con_media
        assert ("Ayer era AYER." if datos["idioma"] == "es" else
                "Yesterday was AYER.") in mensaje["html"]


def test_sin_ayer(datos):
    datos["cx"].execute(text("update criptico.acertijos set estado = 'borrador' where id = :id"),
                        {"id": datos["ayer"]})
    assert _enviar(datos) == 2
    for mensaje in datos["buzon"]:
        assert "AYER" not in mensaje["texto"] + mensaje["html"]
        assert "La de ayer" not in mensaje["html"]
        assert "Yesterday&#x27;s" not in mensaje["html"]


@pytest.mark.parametrize("lanza", [False, True])
def test_fallo_no_para_lote(datos, monkeypatch, lanza):
    original = correo.enviar
    primero = datos["suscriptores"][0][1] + "@prueba.local"

    def enviar(destino, *args, **kwargs):
        if destino == primero:
            if lanza:
                raise RuntimeError("Fallo simulado")
            return False
        return original(destino, *args, **kwargs)

    monkeypatch.setattr(correo, "enviar", enviar)
    assert _enviar(datos) == 1
    assert _enviar(datos) == 0
    assert len(datos["buzon"]) == 1
    estados = _estados(datos)
    assert estados[datos["suscriptores"][0][0]] == "error"
    assert estados[datos["suscriptores"][1][0]] == "enviado"
