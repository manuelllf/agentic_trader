"""Eventos y noticias macro GRATIS y sin API key (fiel al Exhibit 2C/2D del paper).

El paper alimenta el macro con noticias + páginas de Wikipedia de eventos actuales. Replicamos
eso, gratis y keyless, y filtrando a lo que mueve el mercado:

- `wikipedia_current_events`: portal diario de los últimos N días, quedándonos SOLO con las
  secciones de contexto geopolítico y macroeconómico (conflictos armados, economía, política,
  relaciones internacionales) y tirando el ruido (deportes, sucesos, etc.). Fresco y fiable.
- `wikipedia_scheduled_events`: sección "Predicted and scheduled events" de la página del año
  → calendario FUTURO de eventos (justo lo que pide el Exhibit 2D: timeline a 3 meses).
- `gdelt_headlines`: titulares macro de GDELT (keyless, PERO muy rate-limitado → best-effort).

Todo best-effort: si una fuente cae, el macro degrada sin romperse.

**CACHÉ PERSISTENTE (tabla Meta).** Sin ella, un solo 403 dejaba el macro sin eventos y a la
semana siguiente volvía a intentarlo desde cero: el outlook salió mudo semanas enteras. La clave
está en que la página del portal de un día PASADO ya no cambia nunca, así que se guarda para
siempre; solo el día en curso y el calendario del año caducan. En régimen normal cada escaneo
baja UNA página (la de hoy) en vez de siete, y un día que se logró traer no se vuelve a perder
aunque Wikipedia bloquee la IP de Railway durante un mes.

Los reintentos van con espera creciente y jitter, y SOLO ante fallos transitorios (429/5xx o
error de red): un 403 es un bloqueo por política y reintentarlo es regalar minutos al escaneo.
"""

from __future__ import annotations

import datetime
import json
import logging
import random
import re
import time

import httpx

logger = logging.getLogger(__name__)
# La política de User-Agent de Wikimedia exige identificar al cliente CON una vía de contacto;
# sin ella responden 403 ("robot policy") y los eventos llegan vacíos. Al resto de fuentes
# el contacto les da igual.
_UA = {"User-Agent": "AgenticTrader/1.0 (personal portfolio research; "
                     "contact: agentictraderfr@gmail.com)"}
_API = "https://en.wikipedia.org/w/api.php"

# Secciones del portal diario que dan contexto GEOPOLÍTICO y MACROECONÓMICO — lo único que se
# inyecta al LLM; el resto (deportes, sucesos, ciencia, crímenes locales) es ruido. Solo
# contexto y sin sesgo: el filtro elige SECCIONES enteras, nunca titulares concretos.
_MACRO_SECTIONS = (
    "armed conflicts", "business and economy", "politics and elections",
    "international relations",
)


# ---- caché persistente (tabla Meta) -----------------------------------------
_CACHE_KEY = "events_cache"
_CACHE_PRUNE_DAYS = 45          # más allá, ninguna entrada le sirve ya a una ventana de 7 días
_RETRIES = 3
_BACKOFF = 2.0                  # segundos; se dobla en cada intento (2 · 4), con jitter
_TRANSITORIO = {408, 425, 429, 500, 502, 503, 504}


def _cache_load(db) -> dict:  # noqa: ANN001
    if db is None:
        return {}
    from app.models import Meta

    row = db.get(Meta, _CACHE_KEY)
    if not row:
        return {}
    try:
        return json.loads(row.value)
    except ValueError:
        return {}


def _cache_save(db, cache: dict) -> None:  # noqa: ANN001
    if db is None:
        return
    from app.models import Meta

    corte = (datetime.date.today() - datetime.timedelta(days=_CACHE_PRUNE_DAYS)).isoformat()
    podado = {k: v for k, v in cache.items() if (v.get("at") or "9999") >= corte}
    payload = json.dumps(podado)
    row = db.get(Meta, _CACHE_KEY)
    if row:
        row.value = payload
    else:
        db.add(Meta(key=_CACHE_KEY, value=payload))
    db.commit()


def _cached(cache: dict, key: str, ttl_h: float | None):
    """Valor guardado si sigue vigente. `ttl_h=None` = no caduca nunca (día ya cerrado)."""
    e = cache.get(key)
    if not e:
        return None
    if ttl_h is None:
        return e.get("v")
    try:
        edad = (datetime.datetime.now(datetime.UTC)
                - datetime.datetime.fromisoformat(e["at"])).total_seconds() / 3600
    except (KeyError, ValueError):
        return None
    return e.get("v") if edad < ttl_h else None


def _store(cache: dict, key: str, value) -> None:  # noqa: ANN001
    cache[key] = {"at": datetime.datetime.now(datetime.UTC).isoformat(), "v": value}


def _fetch_wikitext(page: str, timeout: float = 15.0) -> str:
    """Wikitext de una página, con reintentos de espera creciente ante fallos TRANSITORIOS.

    Un 403 (política de bots / IP de datacenter) no se reintenta: es un no permanente y
    reintentarlo siete veces por escaneo solo alarga el escaneo sin traer nada.
    """
    for intento in range(_RETRIES):
        try:
            r = httpx.get(
                _API,
                params={"action": "parse", "page": page, "format": "json",
                        "prop": "wikitext", "formatversion": "2"},
                headers=_UA, timeout=timeout,
            )
            if r.status_code == 200:
                return r.json().get("parse", {}).get("wikitext", "")
            # Un 4xx aquí NO es excepción: sin este log, un bloqueo (p.ej. 403 por el User-Agent)
            # deja el macro sin eventos EN SILENCIO durante semanas.
            logger.warning("Wikipedia devolvió %s para %s", r.status_code, page)
            if r.status_code not in _TRANSITORIO:
                return ""
        except Exception:
            logger.warning("Wikipedia fetch falló para %s (intento %d)", page, intento + 1)
        if intento + 1 < _RETRIES:
            # Jitter: si varios fetches se sincronizan, reintentar todos a la vez agrava el 429.
            time.sleep(_BACKOFF * (2 ** intento) * (0.5 + random.random()))  # noqa: S311
    return ""


def _clean_wikitext(wt: str) -> str:
    """Wikitext → texto legible (no hace falta perfección para el prompt del LLM)."""
    wt = re.sub(r"<!--.*?-->", "", wt, flags=re.S)
    wt = re.sub(r"<ref[^>]*>.*?</ref>", "", wt, flags=re.S)
    wt = re.sub(r"<ref[^>]*/>", "", wt)
    wt = re.sub(r"\{\{[^{}]*\}\}", "", wt)                 # plantillas simples
    wt = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", wt)   # [[destino|texto]] -> texto
    wt = re.sub(r"\[\[([^\]]*)\]\]", r"\1", wt)            # [[texto]] -> texto
    wt = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", wt)  # [url texto] -> texto
    wt = re.sub(r"\[https?://\S+\]", "", wt)               # [url] -> (nada)
    wt = wt.replace("'''", "").replace("''", "").replace("}}", "")
    return re.sub(r"\n{3,}", "\n\n", wt).strip()


def _macro_sections_only(wt: str) -> str:
    """Del wikitext de un día del portal, deja solo las secciones macro-relevantes."""
    parts = re.split(r"'''([^']+?)'''", wt)   # [pre, cat, body, cat, body, ...]
    kept: list[str] = []
    for i in range(1, len(parts) - 1, 2):
        cat = parts[i].strip()
        if any(k in cat.lower() for k in _MACRO_SECTIONS):
            body = _clean_wikitext(parts[i + 1]).strip()
            if body:
                kept.append(f"{cat}:\n{body}")
    return "\n".join(kept)


def wikipedia_current_events(days: int = 7, max_chars: int = 12000, db=None) -> str:  # noqa: ANN001
    """Eventos macro-relevantes de los últimos `days` días (portal diario, keyless, fiable).

    Se cachea DÍA A DÍA y solo se guarda lo ya filtrado. Un día pasado no vuelve a cambiar, así
    que se conserva sin caducidad: es lo que hace que un bloqueo puntual deje de vaciar la
    ventana entera y que el escaneo normal baje una sola página en vez de siete.
    """
    cache = _cache_load(db)
    hoy = datetime.date.today()
    out: list[str] = []
    nuevo = False
    for i in range(days):
        d = hoy - datetime.timedelta(days=i)
        clave = f"wiki:{d.isoformat()}"
        # El día EN CURSO todavía se está escribiendo → caduca a las 6 h; los cerrados, nunca.
        macro = _cached(cache, clave, 6.0 if d == hoy else None)
        if macro is None:
            page = f"Portal:Current_events/{d.strftime('%Y_%B_')}{d.day}"  # p.ej. 2026_July_9
            wt = _fetch_wikitext(page)
            if not wt:
                continue                      # sin dato: NO se cachea el vacío, se reintentará
            macro = _macro_sections_only(wt)
            _store(cache, clave, macro)
            nuevo = True
        if macro:
            out.append(f"[{d.isoformat()}]\n{macro}")
    if nuevo:
        _cache_save(db, cache)
    return "\n\n".join(out)[:max_chars]


def wikipedia_scheduled_events(year: int | None = None, max_chars: int = 3000,
                               db=None) -> str:  # noqa: ANN001
    """Calendario FUTURO: sección 'Predicted and scheduled events' de la página del año (Exhibit 2D).

    Cacheado 24 h: un calendario anual no cambia de hora en hora.
    """
    year = year or datetime.date.today().year
    cache = _cache_load(db)
    clave = f"sched:{year}"
    guardado = _cached(cache, clave, 24.0)
    if guardado is not None:
        return guardado[:max_chars]

    wt = _fetch_wikitext(str(year))
    if not wt:
        return ""
    m = re.search(r"==\s*Predicted and scheduled events\s*==(.*?)(?:\n==[^=]|\Z)", wt, flags=re.S)
    texto = _clean_wikitext(m.group(1))[:max_chars] if m else ""
    _store(cache, clave, texto)
    _cache_save(db, cache)
    return texto


def gdelt_headlines(
    query: str = ('("Federal Reserve" OR inflation OR "US economy" OR "stock market")'
                  " sourcelang:eng"),
    max_records: int = 8, timeout: float = 20.0, db=None,  # noqa: ANN001
) -> list[str]:
    """Titulares macro recientes de GDELT (keyless). Best-effort: [] si rate-limit/fallo.

    `sourcelang:eng` en la query: sin él GDELT mezcla titulares en cualquier idioma. Cacheado
    6 h y con espera creciente entre reintentos: su API gratuita va muy rate-limitada y machacarla
    en cada escaneo era la forma más segura de no obtener nada.
    """
    cache = _cache_load(db)
    guardado = _cached(cache, "gdelt", 6.0)
    if guardado is not None:
        return list(guardado)

    last: int | None = None
    for intento in range(_RETRIES):
        try:
            r = httpx.get(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                params={"query": query, "mode": "artlist", "maxrecords": str(max_records),
                        "format": "json", "sort": "datedesc", "timespan": "3d"},
                headers=_UA, timeout=timeout,
            )
            last = r.status_code
            if r.status_code == 200 and r.content:
                arts = r.json().get("articles", [])
                seen: set[str] = set()
                titles: list[str] = []
                for a in arts:
                    t = (a.get("title") or "").strip()
                    if t and t not in seen:
                        seen.add(t)
                        titles.append(t)
                if titles:
                    _store(cache, "gdelt", titles)
                    _cache_save(db, cache)
                return titles
            if r.status_code not in _TRANSITORIO:
                break
        except Exception:
            logger.warning("GDELT falló (intento %d)", intento + 1)
        if intento + 1 < _RETRIES:
            time.sleep(_BACKOFF * (2 ** intento) * (0.5 + random.random()))  # noqa: S311
    if last is not None and last != 200:
        # Mismo criterio que Wikipedia: un rate-limit/bloqueo NO es excepción y sin este log
        # el macro se quedaría sin titulares en silencio.
        logger.warning("GDELT devolvió %s: escaneo sin sus titulares", last)
    return []
