"""Titulares recientes de cada empresa desde el RSS de Google News (sin clave).

Acotado a lo que el prescore necesita: la empresa por su nombre exacto, una ventana de días
(`noticias_ventana_dias`, o `desde`/`hasta` explícitos), solo titulares que la nombran y sin las
fichas de cotización, previsiones y avisos de participaciones que no son noticia. Ritmo global
compartido por todos los hilos y un fallo de red queda contado (`resumen`), nunca silencioso.
"""
from __future__ import annotations

import html
import logging
import random
import re
import threading
import time
import unicodedata
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_URL = "https://news.google.com/rss/search"
_UA = {"User-Agent": "Mozilla/5.0 (compatible; Vennett/1.0)"}
_TRANSITORIO = {429, 500, 502, 503, 504}
_BACKOFF_S = (2.0, 6.0, 15.0)
_MAX_CARACTERES = 220

# Terminaciones legales que Yahoo pega al nombre; "Inc." solo aporta ruido a la búsqueda.
_SUFIJOS = ("incorporated", "inc", "corporation", "corp", "company", "co", "holdings", "holding",
            "group", "limited", "ltd", "plc", "llc", "lp", "nv", "sa", "ag", "se", "trust")
_NOMBRE_RECORTADO = 30  # Yahoo recorta `shortName` ("Baldwin Insurance Group, In")

# Páginas de cotización, previsiones y avisos automáticos: no cuentan nada de la empresa.
_RUIDO_TITULO = re.compile(
    r"stock (price|quote|forecast|analysis)|share price|(price|target) (target|price)|"
    r"quote\b.*\bhistory|"
    r"stock (trades|traders)|technical signals|liquidity mapping|expected to post earnings|"
    r"earnings preview|stock has average|voting power|passive stake|\bform (4|144)\b|"
    r"52-week (high|low)|price[- ]to[- ](book|earnings)",
    re.IGNORECASE)
# Un nombre de una sola palabra puede ser corriente ("Target", "Block"): solo vale el titular que
# habla de la empresa como empresa (cotización, resultados, operaciones, pleitos, directivos).
_CONTEXTO = re.compile(
    r"\b(nyse|nasdaq|stock|shares?|earnings|revenue|quarter|guidance|analysts?|investors?|ceo|cfo|"
    r"chairman|acquir\w*|acquisition|merger|takeover|take-private|go-private|buyout|offer|bid|"
    r"agreement|ipo|dividend|sec|lawsuit|sues?|suit|settlement|layoffs?|fda|trial|downgrad\w*|"
    r"upgrad\w*|outlook|profit|loss|debt|bonds?|probe|investigation|sells?|sold|buys?|assets|"
    r"divest\w*|spin-?off|restructur\w*|contract|partnership|recall\w*|refocus\w*)\b",
    re.IGNORECASE)
_RUIDO_FUENTE = {"stock titan", "stock traders daily", "techgraph", "chartmill", "marketbeat",
                 "simply wall st", "gurufocus", "investing.com stock quote"}


def _dormir(segundos: float) -> None:
    time.sleep(segundos)


class _Ritmo:
    """Separa las peticiones de todos los hilos: Google limita por IP, no por hilo."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proximo = 0.0

    def esperar(self, rps: float) -> None:
        with self._lock:
            ahora = time.monotonic()
            toca = max(ahora, self._proximo)
            self._proximo = toca + 1.0 / max(rps, 0.1)
        if toca > ahora:
            _dormir(toca - ahora)


class _Cuentas:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.reiniciar()

    def reiniciar(self) -> None:
        with self._lock:
            self.consultas = 0
            self.con_noticias = 0
            self.vacias = 0
            self.sin_nombre = 0
            self.fallos: Counter[str] = Counter()

    def anotar(self, *, con: bool = False, vacia: bool = False, sin_nombre: bool = False,
               fallo: str | None = None) -> None:
        with self._lock:
            self.consultas += 1
            self.con_noticias += con
            self.vacias += vacia
            self.sin_nombre += sin_nombre
            if fallo:
                self.fallos[fallo] += 1

    def resumen(self) -> dict:
        with self._lock:
            return {"consultas": self.consultas, "con_noticias": self.con_noticias,
                    "vacias": self.vacias, "sin_nombre": self.sin_nombre,
                    "fallos": dict(self.fallos)}


_ritmo = _Ritmo()
_cuentas = _Cuentas()


def reiniciar() -> None:
    _cuentas.reiniciar()


def resumen() -> dict:
    return _cuentas.resumen()


def incidencia() -> str | None:
    """Texto para las incidencias del proceso si las noticias fallaron de forma apreciable."""
    r = _cuentas.resumen()
    fallos = sum(r["fallos"].values())
    if not r["consultas"]:
        return None
    if fallos / r["consultas"] > 0.05 or (r["consultas"] >= 20 and not r["con_noticias"]):
        tipos = ", ".join(f"{k}={v}" for k, v in sorted(r["fallos"].items())) or "sin error"
        return (f"Noticias (Google News): {r['con_noticias']}/{r['consultas']} empresas con "
                f"titulares, {fallos} consultas falladas ({tipos}).")
    return None


def _normaliza(texto: str) -> str:
    plano = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", plano).strip()


def nombre_busqueda(nombre: str | None) -> str:
    """Nombre sin artículo ni terminación legal: 'The Baldwin Insurance Group, In' -> 'Baldwin
    Insurance'."""
    crudo = html.unescape(nombre or "").strip()
    n = re.sub(r"^the\s+", "", crudo, flags=re.IGNORECASE)
    palabras = [p for p in re.split(r"[\s,]+", n) if p]
    recortado = len(crudo) >= _NOMBRE_RECORTADO
    while len(palabras) > 1:
        ultima = palabras[-1].replace(".", "").lower()
        es_sufijo = ultima in _SUFIJOS
        es_cortado = recortado and any(s.startswith(ultima) for s in _SUFIJOS)
        if not (es_sufijo or es_cortado):
            break
        palabras.pop()
        recortado = False
    return " ".join(palabras).replace('"', "")


def _consulta(nucleo: str, desde: date | None, hasta: date | None, dias: int) -> str:
    q = f'"{nucleo}"'
    if len(nucleo) < 4:
        q += " (stock OR shares)"
    if desde or hasta:
        if desde:
            q += f" after:{desde.isoformat()}"
        if hasta:
            q += f" before:{(hasta + timedelta(days=1)).isoformat()}"
    else:
        q += f" when:{dias}d"
    return q


def _items(xml: str) -> list[tuple[str, str, datetime]]:
    """(titulo, fuente, fecha) de cada <item>; sin fecha válida no se puede acotar y se descarta."""
    salida = []
    for bloque in re.findall(r"<item>(.*?)</item>", xml, flags=re.S):
        t = re.search(r"<title>(.*?)</title>", bloque, flags=re.S)
        p = re.search(r"<pubDate>(.*?)</pubDate>", bloque)
        if not (t and p):
            continue
        titulo = html.unescape(re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", t.group(1), flags=re.S))
        fuente = re.search(r"<source[^>]*>(.*?)</source>", bloque, flags=re.S)
        try:
            fecha = parsedate_to_datetime(p.group(1))
        except (TypeError, ValueError):
            continue
        if fecha.tzinfo is None:
            fecha = fecha.replace(tzinfo=UTC)
        salida.append((titulo.strip(), html.unescape(fuente.group(1)).strip() if fuente else "",
                       fecha))
    return salida


def _filtrar(items: list[tuple[str, str, datetime]], ticker: str, nucleo: str,
             inicio: datetime, fin: datetime, max_items: int) -> list[str]:
    n_nucleo = f" {_normaliza(nucleo)} "
    generico = len(nucleo.split()) == 1
    con_mayuscula = re.compile(rf"\b{re.escape(nucleo)}\b")
    patron_ticker = re.compile(rf"\(\s*(?:[A-Za-z]+:)?{re.escape(ticker)}\s*\)")
    vistos: set[str] = set()
    buenos: list[tuple[datetime, str]] = []
    for titulo, fuente, fecha in sorted(items, key=lambda x: x[2], reverse=True):
        if not (inicio <= fecha <= fin) or _RUIDO_TITULO.search(titulo):
            continue
        if fuente.lower() in _RUIDO_FUENTE:
            continue
        por_ticker = bool(patron_ticker.search(titulo))
        if n_nucleo not in f" {_normaliza(titulo)} " and not por_ticker:
            continue
        es_sujeto = _normaliza(titulo).startswith(n_nucleo.strip() + " ")
        if generico and not por_ticker:
            # "to block", "target price": una palabra corriente solo cuenta con su mayúscula y
            # hablando de la empresa.
            if not con_mayuscula.search(titulo) or not (es_sujeto or _CONTEXTO.search(titulo)):
                continue
        clave = _normaliza(titulo.rsplit(" - ", 1)[0])[:70]  # misma noticia en varios medios
        if clave in vistos:
            continue
        vistos.add(clave)
        buenos.append((fecha, titulo[:_MAX_CARACTERES]))
        if len(buenos) >= max_items:
            break
    return [f"{f:%Y-%m-%d} {t}" for f, t in buenos]


def titulares(ticker: str, nombre: str | None, desde: date | None = None,
              hasta: date | None = None, max_items: int | None = None) -> list[str]:
    """Titulares de la empresa, el más reciente primero, `AAAA-MM-DD Titular - Medio`. Nunca
    lanza: un fallo de red se cuenta y devuelve []."""
    nucleo = nombre_busqueda(nombre)
    if not nucleo:
        _cuentas.anotar(sin_nombre=True)
        return []
    ahora = datetime.now(UTC)
    if desde or hasta:
        inicio = datetime.combine(desde or date.min, datetime.min.time(), UTC)
        fin = datetime.combine(hasta or ahora.date(), datetime.max.time(), UTC)
    else:
        inicio, fin = ahora - timedelta(days=settings.noticias_ventana_dias), ahora
    params = {"q": _consulta(nucleo, desde, hasta, settings.noticias_ventana_dias),
              "hl": "en-US", "gl": "US", "ceid": "US:en"}
    ultimo: str | None = None
    for intento in range(len(_BACKOFF_S) + 1):
        _ritmo.esperar(settings.noticias_rps)
        try:
            r = httpx.get(_URL, params=params, headers=_UA, timeout=15, follow_redirects=True)
        except httpx.HTTPError as exc:
            ultimo = type(exc).__name__
        else:
            if r.status_code == 200:
                lista = _filtrar(_items(r.content.decode("utf-8", "replace")), ticker, nucleo,
                                 inicio, fin, max_items or settings.noticias_max)
                _cuentas.anotar(con=bool(lista), vacia=not lista)
                return lista
            ultimo = f"HTTP {r.status_code}"
            if r.status_code not in _TRANSITORIO:
                break
        if intento < len(_BACKOFF_S):
            _dormir(_BACKOFF_S[intento] * (0.5 + random.random()))  # noqa: S311
    logger.debug("Noticias de %s sin respuesta: %s", ticker, ultimo)
    _cuentas.anotar(fallo=ultimo or "sin respuesta")
    return []
