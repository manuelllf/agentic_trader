"""Avisos del admin (Omega) por los canales de cada tipo: push a los dispositivos del panel de admin
y correo a las cuentas admin que lo activaron en Cuenta › Avisos, en su idioma y a su dirección.

El panel de avisos (backlog) pasará `CANALES` a base de datos; hoy van fijos aquí."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import correo, correo_plantilla, push
from app.config import settings
from app.i18n import MESSAGES, Locale, translate

logger = logging.getLogger(__name__)

CANALES: dict[str, frozenset[str]] = {
    "omega_nuevas": frozenset({"push", "correo"}),
    "omega_reactivadas": frozenset({"push", "correo"}),
    "omega_resueltas": frozenset({"push", "correo"}),
    "omega_candidatos": frozenset({"push", "correo"}),
}
_NUEVA_YORK = ZoneInfo("America/New_York")
_MESES_ES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
             "septiembre", "octubre", "noviembre", "diciembre")


def avisar(db: Session, tipo: str, *, title: str, body: str, url: str, tag: str,
           filas: Sequence[correo_plantilla.Fila] = (), **valores: object) -> int:
    """Manda el aviso por los canales del tipo. Devuelve los dispositivos que recibieron el push.
    El correo, como el push, nunca tira el proceso que avisa."""
    canales = CANALES.get(tipo, frozenset())
    enviados = 0
    if "push" in canales:
        enviados = push.send_to_all(db, title=title, body=body, url=url, tag=tag)
    if "correo" in canales:
        por_correo(tipo, url, filas, **valores)
    return enviados


def por_correo(tipo: str, ruta: str, filas: Sequence[correo_plantilla.Fila] = (),
               **valores: object) -> int:
    """Manda el correo del aviso a cada destinatario; devuelve cuántos aceptó Resend."""
    if not settings.resend_api_key:
        logger.info("Correo omitido: falta RESEND_API_KEY.")
        return 0
    try:
        lista = destinatarios()
    except Exception:
        logger.exception("No se pudieron leer los destinatarios del correo")
        return 0
    momento = datetime.now(UTC)
    aceptados = 0
    for destino, idioma in lista:
        asunto, texto, html = mensaje(tipo, idioma, ruta, filas, momento, **valores)
        aceptados += correo.enviar(destino, asunto, texto, html)
    return aceptados


def destinatarios() -> list[tuple[str, Locale]]:
    """Cuentas admin con el correo activado: su dirección propia o, sin ella, la de la cuenta."""
    from app.liga.procesos.comun import fabrica_sistema, sesion

    with sesion(fabrica_sistema) as db:
        filas = db.execute(text("""
            select coalesce(p.correo_avisos, u.email) as correo, p.idioma
            from liga.perfiles_privados p
            join auth.users u on u.id = p.id
            where p.avisos_correo and coalesce(p.correo_avisos, u.email) is not null
              and exists (select 1 from liga.roles_usuario r
                          where r.usuario_id = p.id and r.rol = 'admin')
        """)).all()
    return [(f.correo, "en" if f.idioma == "en" else "es") for f in filas]


def mensaje(tipo: str, idioma: Locale, ruta: str, filas: Sequence[correo_plantilla.Fila],
            momento: datetime, **valores: object) -> tuple[str, str, str]:
    """(asunto, texto, html) del aviso en el idioma de la cuenta."""
    valores = dict(valores)
    if "motivo" in valores:
        valores["motivo"] = translate(f"correo_motivo_{valores['motivo']}", idioma)
    if "ret" in valores:
        valores["ret"] = _porcentaje(valores["ret"], idioma)
    asunto = _t(f"correo_{tipo}_asunto", idioma, **valores)
    texto, html = correo_plantilla.render(
        idioma=idioma, asunto=asunto, meta=_meta(momento, idioma),
        intro=_t(f"correo_{tipo}_intro", idioma, **valores),
        filas=[(ticker, _detalle(detalle, idioma)) for ticker, detalle in filas],
        columnas=(translate("correo_col_ticker", idioma), translate("correo_col_tipo", idioma)),
        enlace_texto=translate("correo_ver", idioma), ruta=ruta,
        pie=translate("correo_pie", idioma), ajustes_texto=translate("correo_ajustes", idioma),
        legal_texto=translate("correo_legal", idioma))
    return asunto, texto, html


def enviar_prueba() -> int:
    """Correo de prueba con el diseño real a los destinatarios: `python -m app.avisos_admin`."""
    return por_correo("prueba", "/cuenta/avisos")


def _t(clave: str, idioma: Locale, **valores: object) -> str:
    """Texto del catálogo; con `count` igual a 1 usa la variante `_uno` si existe."""
    if valores.get("count") == 1 and f"{clave}_uno" in MESSAGES[idioma]:
        clave = f"{clave}_uno"
    return translate(clave, idioma, **valores)


def _detalle(tipo_senal: str | None, idioma: Locale) -> str | None:
    if not tipo_senal:
        return None
    clave = f"correo_tipo_{tipo_senal}"
    return translate(clave, idioma) if clave in MESSAGES[idioma] else tipo_senal


def _porcentaje(valor: object, idioma: Locale) -> str:
    if valor is None:
        return "n/d"
    numero = f"{float(valor):+.1f}"
    return f"{numero}%" if idioma == "en" else f"{numero.replace('.', ',')} %"


def _meta(momento: datetime, idioma: Locale) -> str:
    local = momento.astimezone(_NUEVA_YORK)
    fecha = (f"{local:%B} {local.day}, {local.year}" if idioma == "en"
             else f"{local.day} de {_MESES_ES[local.month - 1]} de {local.year}")
    return translate("correo_meta", idioma, fecha=fecha, hora=f"{local:%H:%M}")


if __name__ == "__main__":
    print(enviar_prueba())
