"""Red de seguridad de logging (plan §14, F8.7): aunque un `logger.*` se equivocara, un JWT, una
clave de Supabase o un email no deberían poder llegar a los logs. No sustituye la disciplina de no
loguear textos de usuario ni tokens (ya se cumple hoy en `app.liga.*`, `app.auth` y `app.main`):
esto es la última barrera, aplicada al `Handler`, no al `Logger` — un filtro puesto en un `Logger`
no ve lo que propagan sus hijos; uno puesto en el `Handler` sí ve todo lo que llega a él."""

from __future__ import annotations

import logging
import re

_JWT = re.compile(r"eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,}){1,2}")
_CLAVE_SUPABASE = re.compile(r"sb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


class FiltroDatosPersonales(logging.Filter):
    """Redacta JWT, claves de Supabase y emails del mensaje ya formateado, antes del `Handler`."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            mensaje = record.getMessage()
        except Exception:  # noqa: BLE001 — un `%s` de más no debe tumbar el logging
            return True
        redactado = _JWT.sub("[jwt]", mensaje)
        redactado = _CLAVE_SUPABASE.sub("[clave]", redactado)
        redactado = _EMAIL.sub("[email]", redactado)
        if redactado != mensaje:
            record.msg = redactado
            record.args = ()
        return True


_LOGGERS_PROPIOS_UVICORN = ("uvicorn", "uvicorn.error", "uvicorn.access")


def instalar(logger_raiz: logging.Logger | None = None) -> None:
    """Añade el filtro a cada `Handler` del logger raíz (o del que se le pase). Idempotente: no
    lo duplica si ya está puesto (recarga en caliente, tests)."""
    raiz = logger_raiz if logger_raiz is not None else logging.getLogger()
    for handler in raiz.handlers:
        if not any(isinstance(f, FiltroDatosPersonales) for f in handler.filters):
            handler.addFilter(FiltroDatosPersonales())


def instalar_en_uvicorn() -> None:
    """Uvicorn configura sus propios loggers (`uvicorn`, `uvicorn.error`, `uvicorn.access`) con
    sus propios handlers y `propagate=False`: no pasan por el logger raíz, así que `instalar()`
    solo (llamada con el raíz) nunca los alcanza -- `uvicorn.access` traza método/ruta/query de
    CADA petición, la última barrera de este módulo se los saltaba. Se añade el mismo filtro a
    cada uno de sus `Handler`, igual que hace `instalar()` con el raíz."""
    for nombre in _LOGGERS_PROPIOS_UVICORN:
        instalar(logging.getLogger(nombre))
