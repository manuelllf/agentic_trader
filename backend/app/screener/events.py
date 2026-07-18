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
"""

from __future__ import annotations

import datetime
import logging
import re

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


def _fetch_wikitext(page: str, timeout: float = 15.0) -> str:
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
    except Exception:
        logger.warning("Wikipedia fetch falló para %s", page)
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


def wikipedia_current_events(days: int = 7, max_chars: int = 12000) -> str:
    """Eventos macro-relevantes de los últimos `days` días (portal diario, keyless, fiable)."""
    out: list[str] = []
    today = datetime.date.today()
    for i in range(days):
        d = today - datetime.timedelta(days=i)
        page = f"Portal:Current_events/{d.strftime('%Y_%B_')}{d.day}"  # p.ej. 2026_July_9
        wt = _fetch_wikitext(page)
        if not wt:
            continue
        macro = _macro_sections_only(wt)
        if macro:
            out.append(f"[{d.isoformat()}]\n{macro}")
    return "\n\n".join(out)[:max_chars]


def wikipedia_scheduled_events(year: int | None = None, max_chars: int = 3000) -> str:
    """Calendario FUTURO: sección 'Predicted and scheduled events' de la página del año (Exhibit 2D)."""
    year = year or datetime.date.today().year
    wt = _fetch_wikitext(str(year))
    if not wt:
        return ""
    m = re.search(r"==\s*Predicted and scheduled events\s*==(.*?)(?:\n==[^=]|\Z)", wt, flags=re.S)
    if not m:
        return ""
    return _clean_wikitext(m.group(1))[:max_chars]


def gdelt_headlines(
    query: str = ('("Federal Reserve" OR inflation OR "US economy" OR "stock market")'
                  " sourcelang:eng"),
    max_records: int = 8, retries: int = 2, timeout: float = 20.0,
) -> list[str]:
    """Titulares macro recientes de GDELT (keyless). Best-effort: [] si rate-limit/fallo.

    `sourcelang:eng` en la query: sin él GDELT mezcla titulares en cualquier idioma."""
    import time
    last: int | None = None
    for attempt in range(retries):
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
                return titles
            if r.status_code == 429 and attempt + 1 < retries:
                time.sleep(3)
        except Exception:
            logger.warning("GDELT falló (intento %d)", attempt + 1)
    if last is not None and last != 200:
        # Mismo criterio que Wikipedia: un rate-limit/bloqueo NO es excepción y sin este log
        # el macro se quedaría sin titulares en silencio.
        logger.warning("GDELT devolvió %s: escaneo sin sus titulares", last)
    return []
