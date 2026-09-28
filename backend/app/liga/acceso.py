"""Entrar con el nombre de usuario. El backend busca el correo y pide la sesión a Supabase Auth:
el correo nunca sale del servidor. Alias inexistente y contraseña mala responden igual (mismo
error y el mismo viaje a Supabase), así que desde fuera no se puede saber qué alias existen."""

from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from collections.abc import Iterator

import httpx
from fastapi import Depends, HTTPException, Request
from sqlalchemy import text

from app.config import settings
from app.db import SessionLocal
from app.liga.auth import Identidad, require_jugador

logger = logging.getLogger(__name__)

_ALIAS = re.compile(r"^[a-z0-9_.]{3,20}$")
_MAL = "El usuario o la contraseña no coinciden. Revísalos y prueba otra vez."


class LimiteFallos:
    """Solo cuentan los fallos: N por IP en la ventana y un tope global de respaldo (la IP del
    X-Forwarded-For la puede falsear el cliente). En memoria: un solo proceso en Railway."""

    def __init__(self, por_ip: int, global_: int, ventana_s: int) -> None:
        self.por_ip, self.global_, self.ventana_s = por_ip, global_, ventana_s
        self._fallos: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _podar(self, ahora: float) -> None:
        corte = ahora - self.ventana_s
        for ip in list(self._fallos):
            vivos = [t for t in self._fallos[ip] if t > corte]
            if vivos:
                self._fallos[ip] = vivos
            else:
                del self._fallos[ip]

    def espera(self, ip: str) -> int:
        """Segundos que le quedan de bloqueo a esta IP (0 = puede intentarlo)."""
        ahora = time.time()
        with self._lock:
            self._podar(ahora)
            propios = self._fallos.get(ip, [])
            if len(propios) >= self.por_ip:
                return max(1, int(propios[0] + self.ventana_s - ahora) + 1)
            todos = [t for v in self._fallos.values() for t in v]
            if len(todos) >= self.global_:
                return max(1, int(min(todos) + self.ventana_s - ahora) + 1)
        return 0

    def fallo(self, ip: str) -> None:
        with self._lock:
            self._podar(time.time())
            self._fallos.setdefault(ip, []).append(time.time())

    def acierto(self, ip: str) -> None:
        with self._lock:
            self._fallos.pop(ip, None)


limite = LimiteFallos(por_ip=5, global_=50, ventana_s=15 * 60)


class LimiteFrecuencia:
    """Como mucho `tope` llamadas por `ventana_s` segundos y clave (aquí, el usuario). En
    memoria: vale mientras la liga sea un solo proceso (plan §11)."""

    def __init__(self, tope: int, ventana_s: int) -> None:
        self.tope, self.ventana_s = tope, ventana_s
        self._golpes: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def permitido(self, clave: str) -> bool:
        ahora = time.time()
        with self._lock:
            corte = ahora - self.ventana_s
            vivos = [t for t in self._golpes.get(clave, []) if t > corte]
            if len(vivos) >= self.tope:
                self._golpes[clave] = vivos
                return False
            vivos.append(ahora)
            self._golpes[clave] = vivos
            return True


class LimiteSimultaneas:
    """Peticiones caras (bucles de llamadas a la IA) en marcha a la vez: una por usuario y `total`
    en todo el servidor. Cada una tiene una conexión de BD y un hilo ocupados durante minutos; sin
    tope, unas pocas bastan para dejar sin conexiones al resto. En memoria: un solo proceso."""

    def __init__(self, total: int) -> None:
        self.total = total
        self._activas: set[str] = set()
        self._lock = threading.Lock()

    def entrar(self, clave: str) -> None:
        with self._lock:
            if clave in self._activas:
                raise HTTPException(429, "Ya tienes una petición de IA en marcha. Espera a que "
                                         "termine.")
            if len(self._activas) >= self.total:
                raise HTTPException(503, "Hay mucha gente usando la IA ahora mismo. Prueba en "
                                         "un momento.", headers={"Retry-After": "20"})
            self._activas.add(clave)

    def salir(self, clave: str) -> None:
        with self._lock:
            self._activas.discard(clave)


ia_en_marcha = LimiteSimultaneas(total=8)


def ocupar_ia(ident: Identidad = Depends(require_jugador)) -> Iterator[None]:
    """Dependencia de las rutas que encadenan llamadas a la IA (probar con pregunta, convertir,
    leer la cartera): solo cuentas activas y, mientras dura la petición, ese usuario no puede
    lanzar otra."""
    ia_en_marcha.entrar(ident.uid)
    try:
        yield
    finally:
        ia_en_marcha.salir(ident.uid)


def ip_cliente(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "?"


def _email_de(alias: str) -> str | None:
    """Servicio de sistema acotado: solo resuelve alias → correo para entrar."""
    with SessionLocal() as db:
        return db.execute(text(
            "select u.email from liga.perfiles p join auth.users u on u.id = p.id "
            "where p.alias = :a"), {"a": alias}).scalar()


def _pedir_sesion(email: str, clave: str) -> dict | None:
    if not settings.supabase_url or not settings.supabase_publishable_key:
        raise HTTPException(503, "Las cuentas de usuario todavía no están activas.")
    try:
        r = httpx.post(
            settings.supabase_url.rstrip("/") + "/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_publishable_key},
            json={"email": email, "password": clave}, timeout=10)
    except httpx.HTTPError as e:
        raise HTTPException(503, "No se pudo entrar ahora. Prueba en un momento.") from e
    if r.status_code == 429:
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos.")
    if r.status_code >= 500:
        logger.warning("Supabase Auth respondió %s al entrar por alias", r.status_code)
        raise HTTPException(503, "No se pudo entrar ahora. Prueba en un momento.")
    return r.json() if r.status_code == 200 else None


def entrar_con_alias(usuario: str, clave: str, ip: str) -> dict:
    espera = limite.espera(ip)
    if espera:
        raise HTTPException(429, "Demasiados intentos fallidos. Espera unos minutos.",
                            headers={"Retry-After": str(espera)})
    alias = usuario.strip().lower()
    email = _email_de(alias) if _ALIAS.fullmatch(alias) else None
    # Sin alias también se pregunta a Supabase: mismo tiempo de respuesta que con uno real.
    sesion = _pedir_sesion(email or f"{uuid.uuid4().hex}@no-existe.invalid", clave)
    if not email or sesion is None:
        limite.fallo(ip)
        raise HTTPException(401, _MAL)
    limite.acierto(ip)
    return {"access_token": sesion["access_token"], "refresh_token": sesion["refresh_token"]}
