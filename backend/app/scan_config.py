"""Config de LLM por etapa PERSISTIDA para el escaneo con DECISIÓN (cron mensual + botón
"Analizar y decidir" de Alpha).

El observatorio ya era configurable: su override por etapa viaja en el cuerpo de
`POST /demo/run` desde el modal y no se guarda (es un banco de pruebas, cada tirada elige).
El escaneo con decisión no tenía forma de configurarse -- el cron no manda cuerpo y "Analizar
y decidir" tampoco. Aquí se guarda en `Meta` (clave->valor JSON) para que cron y botón lean
exactamente lo mismo. Es INDEPENDIENTE del observatorio a propósito: cada escaneo afina su
circuito por su cuenta.

`None` guardado (o clave ausente) = el escaneo usa los defaults de `settings`, igual que antes.

Los interruptores (capa media, macro en Jev) NO son por modo: valen igual para cron, decisión y
observatorio.
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Meta

_META_KEY = "scan_decide_llm_overrides"
_META_KEY_MID = "scan_mid_layer"
_META_KEY_JEV_MACRO = "scan_jev_macro"
_STAGES = ("prescore", "mid", "deep", "constructor")
_CAMPOS = ("model", "reasoning_effort", "temperature", "top_p")


def get_decide_overrides(db: Session) -> dict | None:
    """Override guardado para el escaneo con decisión, saneado a {etapa: {campo: valor}}.
    `None` si no hay nada -> el escaneo cae a los defaults de `settings` (ver
    `scan_service._stage_cfg`)."""
    row = db.get(Meta, _META_KEY)
    if not row or not row.value:
        return None
    try:
        crudo = json.loads(row.value)
    except (ValueError, TypeError):
        return None
    return _sanear(crudo) or None


def set_decide_overrides(db: Session, overrides: dict | None) -> dict:
    """Guarda el override del escaneo con decisión, o borra la clave si queda vacío (volver a
    los defaults de producción). Devuelve lo que quedó guardado (`{}` si se borró)."""
    limpio = _sanear(overrides or {})
    row = db.get(Meta, _META_KEY)
    if not limpio:
        if row:
            db.delete(row)
        db.commit()
        return {}
    texto = json.dumps(limpio, ensure_ascii=False, sort_keys=True)
    if row:
        row.value = texto
    else:
        db.add(Meta(key=_META_KEY, value=texto))
    db.commit()
    return limpio


def _sanear(crudo: object) -> dict:
    """Deja solo etapas y campos conocidos; descarta el resto sin fallar. No valida rangos --
    de eso se encarga el Pydantic del endpoint antes de llegar aquí."""
    if not isinstance(crudo, dict):
        return {}
    out: dict = {}
    for etapa in _STAGES:
        val = crudo.get(etapa)
        if not isinstance(val, dict):
            continue
        campos = {k: val[k] for k in _CAMPOS if val.get(k) is not None}
        if campos:
            out[etapa] = campos
    return out


def _interruptor(db: Session, clave: str, default: bool) -> bool:
    row = db.get(Meta, clave)
    if row is None or row.value not in ("0", "1"):
        return default
    return row.value == "1"


def _set_interruptor(db: Session, clave: str, activo: bool) -> bool:
    row = db.get(Meta, clave)
    valor = "1" if activo else "0"
    if row:
        row.value = valor
    else:
        db.add(Meta(key=clave, value=valor))
    db.commit()
    return activo


def mid_layer_activa(db: Session) -> bool:
    """Interruptor de la capa media de Alpha, para TODOS los escaneos (cron, decisión y
    observatorio). Clave ausente = `settings.mid_layer`."""
    return _interruptor(db, _META_KEY_MID, settings.mid_layer)


def set_mid_layer(db: Session, activa: bool) -> bool:
    return _set_interruptor(db, _META_KEY_MID, activa)


def jev_macro_activa(db: Session) -> bool:
    """¿El prescore de Jev ve el macro con contexto (E) o solo datos (B)? Vale para todos los
    escaneos. Clave ausente = `settings.jev_macro`."""
    return _interruptor(db, _META_KEY_JEV_MACRO, settings.jev_macro)


def set_jev_macro(db: Session, activa: bool) -> bool:
    return _set_interruptor(db, _META_KEY_JEV_MACRO, activa)
