"""Registro y correos de acceso con límites de frecuencia y destinos propios."""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr

from app.config import settings
from app.liga import acceso, gestion

router = APIRouter(prefix="/registro")
_limite = acceso.LimiteFrecuencia(tope=5, ventana_s=15 * 60)
_global = acceso.LimiteFrecuencia(tope=100, ventana_s=15 * 60)
_alias = re.compile(r"^[a-z0-9_.]{3,20}$")
RESERVADOS = {"admin", "administrador", "alpha", "beta", "omega", "lambda", "jev",
              "liguilla", "liga", "vennett", "soporte", "ayuda", "moderador",
              "moderacion", "casa", "sistema", "root", "staff"}
VERSION_TERMINOS = "1"


@router.get("")
def estado_registro() -> dict:
    disponible = bool(settings.supabase_url and settings.supabase_publishable_key)
    return {"correo_disponible": disponible,
            "registro_abierto": disponible and gestion.registro_abierto()}


class CorreoIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    origen: str = Field(min_length=1, max_length=300)


class RegistroIn(CorreoIn):
    alias: str = Field(min_length=3, max_length=20)
    clave: SecretStr
    acepta_terminos: bool


def validar_clave(clave: str) -> bool:
    return (8 <= len(clave) <= 200 and any(unicodedata.category(c) == "Lu" for c in clave)
            and any(not c.isalnum() and not c.isspace() for c in clave))


def _preparar(body: CorreoIn, request: Request) -> tuple[str, str]:
    if not _limite.permitido(acceso.ip_cliente(request)) or not _global.permitido("correos"):
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


def _enviar(ruta: str, datos: dict, destino: str) -> None:
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
    if respuesta.status_code >= 400:
        # No reenviamos mensajes que puedan revelar cuentas o datos internos del proveedor.
        if ruta == "signup":
            raise HTTPException(503, "No se pudo crear la cuenta. Prueba otro nombre de usuario "
                                "o inténtalo más tarde.")
        raise HTTPException(503, "No se pudo completar la solicitud. Prueba en un momento.")

    if ruta == "signup" and not respuesta.json().get("access_token"):
        raise HTTPException(503, "No se pudo crear la cuenta. Prueba otro nombre de usuario "
                            "o inténtalo más tarde.")


@router.post("")
def registrar(body: RegistroIn, request: Request) -> dict:
    if not gestion.registro_abierto():
        raise HTTPException(403, "El registro está cerrado por ahora.")
    email, origen = _preparar(body, request)
    alias = body.alias.strip().lower()
    if not _alias.fullmatch(alias) or alias in RESERVADOS:
        raise HTTPException(422, "Usa 3 a 20 letras minúsculas, números, puntos o guiones bajos.")
    if not body.acepta_terminos:
        raise HTTPException(422, "Acepta los términos para crear la cuenta.")
    clave = body.clave.get_secret_value()
    if not validar_clave(clave):
        raise HTTPException(422, "Usa al menos 8 caracteres, una mayúscula y un símbolo.")
    _enviar("signup", {"email": email, "password": clave,
                      "data": {"alias": alias, "terminos_version": VERSION_TERMINOS}},
            "")
    return {"ok": True}


@router.post("/recuperar")
@router.post("/reenviar")
def correo_pospuesto() -> None:
    raise HTTPException(404, "Not Found")
