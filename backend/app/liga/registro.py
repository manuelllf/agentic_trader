"""Registro y correos de acceso con límites de frecuencia y destinos propios."""

from __future__ import annotations

import logging
import re
import time
import unicodedata
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr

from app.config import settings
from app.i18n import translate
from app.liga import acceso, gestion, turnstile

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/registro")
_VENTANA_S = 15 * 60
_limite = acceso.LimiteFrecuencia(tope=10, ventana_s=_VENTANA_S)
# Un pico de altas avisa a administración; nunca rechaza a nadie.
UMBRAL_PICO = 100
_altas = acceso.LimiteFrecuencia(tope=UMBRAL_PICO, ventana_s=_VENTANA_S)
_ultimo_aviso_pico = float("-inf")
_alias = re.compile(r"^[a-z0-9_.]{3,20}$")
RESERVADOS = {"admin", "administrador", "alpha", "beta", "omega", "lambda", "jev",
              "liguilla", "liga", "vennett", "soporte", "ayuda", "moderador",
              "moderacion", "casa", "sistema", "root", "staff"}
VERSION_TERMINOS = "5"
ENLACE_CLAVE = "/auth/callback?next=%2Fcambiar-clave"
ENLACE_ENTRADA = "/auth/callback?next=%2Fliga"
ENLACE_CONFIRMAR = "/confirmar"


@router.get("")
def estado_registro() -> dict:
    disponible = bool(settings.supabase_url and settings.supabase_publishable_key)
    return {"correo_disponible": disponible,
            "registro_abierto": disponible and gestion.registro_abierto()}


class CorreoIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    origen: str = Field(min_length=1, max_length=300)
    turnstile: str | None = None


class RegistroIn(CorreoIn):
    alias: str = Field(min_length=3, max_length=20)
    clave: SecretStr
    acepta_terminos: bool
    edad: int


def validar_clave(clave: str) -> bool:
    return (8 <= len(clave) <= 200 and any(unicodedata.category(c) == "Lu" for c in clave)
            and any(not c.isalnum() and not c.isspace() for c in clave))


def _preparar(body: CorreoIn, request: Request) -> tuple[str, str]:
    if not _limite.permitido(acceso.ip_cliente(request)):
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos.")
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Revisa el correo electrónico.")
    try:
        partes = urlsplit(body.origen)
    except ValueError:
        raise HTTPException(422, "El destino del correo no es válido.") from None
    origen = body.origen.rstrip("/")
    permitidos = {s.strip().rstrip("/") for s in settings.cors_origins.split(",")}
    if (origen not in permitidos or partes.scheme not in {"http", "https"}
            or partes.username or partes.password or partes.query or partes.fragment
            or partes.path not in {"", "/"}):
        raise HTTPException(422, "El destino del correo no es válido.")
    if not settings.supabase_url or not settings.supabase_publishable_key:
        raise HTTPException(503, "El acceso por correo todavía no está disponible.")
    return email, origen


def _enviar(ruta: str, datos: dict, destino: str, *, sin_revelar: bool = False) -> None:
    try:
        respuesta = httpx.post(
            settings.supabase_url.rstrip("/") + "/auth/v1/" + ruta,
            headers={"apikey": settings.supabase_publishable_key},
            params={"redirect_to": destino} if destino else {}, json=datos, timeout=10,
        )
    except httpx.HTTPError:
        raise HTTPException(503, "No se pudo enviar el correo. Prueba en un momento.") from None
    if respuesta.status_code == 429:
        raise HTTPException(429, "Espera unos minutos antes de pedir otro correo.")
    codigo = respuesta.status_code
    if sin_revelar and 400 <= codigo < 500 and codigo not in (401, 403):
        # Sin cuenta o ya confirmada, el proveedor responde error: no se lo decimos al usuario.
        logger.info("Correo %s sin efecto en el proveedor (%s)", ruta, codigo)
        return
    if respuesta.status_code >= 400:
        # No reenviamos mensajes que puedan revelar cuentas o datos internos del proveedor.
        if ruta == "signup":
            raise HTTPException(503, "No se pudo crear la cuenta. Revisa los datos o entra si "
                                "ya tienes cuenta.")
        raise HTTPException(503, "No se pudo completar la solicitud. Prueba en un momento.")


def _vigilar_pico() -> None:
    """Cuenta la alta; si el ritmo pasa el umbral, avisa por push una vez por ventana."""
    global _ultimo_aviso_pico
    if _altas.permitido("altas") or time.monotonic() - _ultimo_aviso_pico < _VENTANA_S:
        return
    _ultimo_aviso_pico = time.monotonic()
    try:
        from app import push
        from app.liga.procesos.comun import fabrica_sistema

        db = fabrica_sistema()
        try:
            push.send_to_all(db, title="Vennett: pico de altas",
                             body=f"Más de {UMBRAL_PICO} altas en 15 minutos.",
                             url="/admin", tag="agentic-liga")
        finally:
            db.close()
    except Exception:
        logger.exception("No se pudo avisar del pico de altas")


def _idioma(request: Request) -> str:
    return "en" if request.headers.get("accept-language", "").lower().startswith("en") else "es"


@router.post("")
def registrar(body: RegistroIn, request: Request) -> dict:
    turnstile.verificar(body.turnstile, request.client.host if request.client else None)
    if not gestion.registro_abierto():
        raise HTTPException(403, "El registro está cerrado por ahora.")
    email, origen = _preparar(body, request)
    alias = body.alias.strip().lower()
    if not _alias.fullmatch(alias) or alias in RESERVADOS:
        raise HTTPException(422, "Usa 3 a 20 letras minúsculas, números, puntos o guiones bajos.")
    if not body.acepta_terminos:
        raise HTTPException(422, "Acepta los términos para crear la cuenta.")
    if body.edad < 14:
        raise HTTPException(422, translate("api_error_edad_minima"))
    if body.edad > 120:
        raise HTTPException(422, translate("api_error_edad_no_valida"))
    clave = body.clave.get_secret_value()
    if not validar_clave(clave):
        raise HTTPException(422, "Usa al menos 8 caracteres, una mayúscula y un símbolo.")
    _enviar("signup", {"email": email, "password": clave,
                      "data": {"alias": alias, "terminos_version": VERSION_TERMINOS,
                               "idioma": _idioma(request), "edad": body.edad}},
            origen + ENLACE_CONFIRMAR)
    _vigilar_pico()
    return {"ok": True}


@router.post("/recuperar")
def recuperar(body: CorreoIn, request: Request) -> dict:
    turnstile.verificar(body.turnstile, request.client.host if request.client else None)
    email, origen = _preparar(body, request)
    _enviar("recover", {"email": email}, origen + ENLACE_CLAVE, sin_revelar=True)
    return {"ok": True}


@router.post("/reenviar")
def reenviar(body: CorreoIn, request: Request) -> dict:
    turnstile.verificar(body.turnstile, request.client.host if request.client else None)
    email, origen = _preparar(body, request)
    _enviar("resend", {"type": "signup", "email": email}, origen + ENLACE_CONFIRMAR,
            sin_revelar=True)
    return {"ok": True}
