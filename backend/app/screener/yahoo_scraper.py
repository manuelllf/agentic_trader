"""Scraper HTTP directo de Yahoo Finance — motor PRIMARIO del gather (yfinance queda de reserva).

Por qué existe: en Railway (región EU), el endpoint `v1/test/getcrumb` del que depende yfinance
devuelve 401 "Invalid Crumb" bajo carga con mucha frecuencia. La causa real, comprobada en vivo
contra Yahoo (no es una suposición): las peticiones con IP geolocalizada en la UE caen al muro de
consentimiento GDPR (`consent.yahoo.com`), y yfinance nunca implementa ese flujo — se queda
pidiendo un crumb que Yahoo nunca le da hasta que alguien acepta el consentimiento primero.

Esto resuelve el consentimiento UNA vez por proceso (`consentir_y_crumb`), pide UN crumb y lo
reutiliza para todo el escaneo (miles de peticiones), y llama a los mismos endpoints que usa
yfinance por debajo (`v10/finance/quoteSummary`, `v8/finance/chart`, el mismo XHR de noticias
de finance.yahoo.com) en vez de reinventar la API.

Concurrencia y ritmo (MEDIDOS en vivo contra Yahoo, no estimados): 2 hilos trabajadores + una
pausa de 0,35-0,4s por hilo entre sus propias peticiones dieron 2.991/3.000 (99,7%) de éxito en
una tirada de tamaño de producción completa, contra un ~0-50% de yfinance puro en las mismas
ventanas de limitación de Yahoo. 10 hilos con la misma pausa se cayeron a un 48,3% — hay un techo
real de concurrencia entre 2 y 10 que no se ha acotado más; 2 es el único nivel validado seguro a
volumen completo (ver `_GATHER_WORKERS`/`_GATHER_PACE_S` en `scan_service.py`, que son quienes
DECIDEN cuántos hilos y cuánto pausar — este módulo solo hace la petición, no fija política de
ritmo).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import pandas as pd
from curl_cffi import requests as creq

if TYPE_CHECKING:
    from app.screener.fundamentals import NameData

# Módulos del quoteSummary que cubren los mismos datos que trae `.info` de yfinance: valoración,
# tipo de instrumento, estadísticas clave, perfil de la empresa, resumen de mercado, calendario de
# resultados y los datos "financieros" (targets de analistas, márgenes, cash, deuda...).
MODULES = ("financialData,quoteType,defaultKeyStatistics,assetProfile,summaryDetail,"
           "calendarEvents,price")
NEWS_URL = "https://finance.yahoo.com/xhr/ncp?queryRef=latestNews&serviceKey=ncp_fin"


class TransportError(Exception):
    """Fallo de TRANSPORTE (HTTP/red/JSON), no de datos: HTTP != 200, timeout, conexión caída,
    JSON ilegible o crumb/consentimiento roto a mitad de escaneo. Distinto a "sin datos" (ticker
    deslistado, 200 OK pero vacío) porque el caller (`fundamentals.gather`) los trata distinto:
    esto reintenta el MISMO ticker por yfinance; "sin datos" no reintenta (mismos tickers fallan
    igual en ambos sitios, medido)."""


def consentir_y_crumb() -> tuple[creq.Session, str]:
    """Sesión con la cookie de consentimiento GDPR aceptada + UN crumb, reutilizables para
    todo el escaneo. Lanza RuntimeError si no se puede (el caller cae entero a yfinance)."""
    s = creq.Session(impersonate="chrome")
    r = s.get("https://finance.yahoo.com/quote/AAPL/", timeout=15)
    txt = r.text
    # Si no hay muro de consentimiento (ej. IP no-EU), estos campos no existen: no es un fallo,
    # solo no hace falta consentir. Detectarlo por la ausencia de "consent.yahoo.com" en la URL.
    if "consent.yahoo.com" not in r.url:
        rc = s.get("https://query1.finance.yahoo.com/v1/test/getcrumb", timeout=15)
        if rc.status_code == 200 and rc.text and "error" not in rc.text.lower():
            return s, rc.text.strip()
        raise RuntimeError(
            f"No se pudo obtener crumb sin consentir: {rc.status_code} {rc.text[:200]}")
    session_id = re.search(r'name="sessionId" value="([^"]+)"', txt).group(1)
    csrf = re.search(r'name="csrfToken" value="([^"]+)"', txt).group(1)
    done_url = (re.search(r'name="originalDoneUrl" value="([^"]+)"', txt)
                .group(1).replace("&#x3D;", "="))
    namespace = re.search(r'name="namespace" value="([^"]+)"', txt).group(1)
    s.post(r.url, data={"csrfToken": csrf, "sessionId": session_id, "originalDoneUrl": done_url,
                        "namespace": namespace, "agree": "agree"}, timeout=15)
    rc = s.get("https://query1.finance.yahoo.com/v1/test/getcrumb", timeout=15)
    if rc.status_code != 200 or not rc.text or "error" in rc.text.lower():
        raise RuntimeError(f"No se pudo obtener crumb: {rc.status_code} {rc.text[:200]}")
    return s, rc.text.strip()


def _sin_raw(valor: object) -> object:
    """Yahoo envuelve casi todo lo numérico del quoteSummary como `{"raw": ..., "fmt": "..."}`;
    yfinance ya lo devuelve pelado en `.info`. Se desenvuelve aquí para que `_fundamentals_text`/
    `_technical_text` (pensados para el dict de yfinance) lean exactamente lo mismo sin tocarlos."""
    if isinstance(valor, dict) and "raw" in valor:
        return valor["raw"]
    return valor


def _historico(s: creq.Session, ticker: str) -> pd.DataFrame | None:
    """Histórico de 1 año/diario vía `v8/finance/chart` — mismo rango que
    `yt.history(period="1y", interval="1d")` del gather de yfinance. NO fatal: si falla, el
    técnico se construye sin histórico, mismo criterio de tolerancia que el bloque
    try/except de `fundamentals.gather()` (un histórico caído no invalida el resto del nombre)."""
    try:
        # query2, no query1: es el subdominio que se usó en la tirada de 3.000 que dio 99,7%
        # — mismo servicio (Yahoo balancea entre los dos), pero solo query2 está medido en vivo
        # a este volumen; el crumb (otro endpoint, otro comportamiento) sí se pidió por query1.
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
        r = s.get(url, params={"range": "1y", "interval": "1d"}, timeout=15)
        if r.status_code != 200:
            return None
        payload = r.json()
        result = (payload.get("chart") or {}).get("result") or []
        if not result:
            return None
        ch = result[0]
        ts = ch.get("timestamp") or []
        if not ts:
            return None
        quote = ((ch.get("indicators") or {}).get("quote") or [{}])[0]
        adj = ((ch.get("indicators") or {}).get("adjclose") or [{}])[0]
        # adjclose (ajustado a splits/dividendos) con fallback al close crudo del quote, igual que
        # yfinance con `auto_adjust=True`.
        closes = adj.get("adjclose") or quote.get("close") or []
        hist = pd.DataFrame({"close": closes}, index=pd.to_datetime(ts, unit="s")).dropna()
        return hist if not hist.empty else None
    except Exception:
        return None


def _news_desde_stream(stream: list[dict], max_items: int = 8) -> list[str]:
    """Titular + resumen desde los items crudos del XHR de noticias — mismo criterio que
    `fundamentals._news()` (titular solo es menos informativo que titular+resumen), pero leyendo
    la respuesta HTTP directa en vez de `yf.Ticker.news`. Reutiliza `_recorta_palabra` (import
    perezoso: evita el ciclo, `fundamentals` importa este módulo a nivel de módulo)."""
    from app.screener.fundamentals import _recorta_palabra

    out: list[str] = []
    for item in (stream or [])[:max_items]:
        content = item.get("content") or item
        title = content.get("title") or item.get("title")
        if not title:
            continue
        summary = content.get("summary") or item.get("summary")
        texto = f"{title.strip()} — {summary.strip()}" if summary else title.strip()
        out.append(_recorta_palabra(texto, 300))
    return out


def _noticias(s: creq.Session, ticker: str, max_items: int = 8) -> list[str]:
    """Titulares recientes vía `NEWS_URL`. NO fatal (mismo criterio que `fundamentals._news()`):
    sin noticias el nombre se sigue analizando, solo con esa sección vacía."""
    try:
        r = s.post(NEWS_URL, json={"serviceConfig": {"snippetCount": max_items, "s": [ticker]}},
                   timeout=15)
        if r.status_code != 200:
            return []
        payload = r.json()
        # Confirmado leyendo el propio yfinance (`base.py::get_news()`, mismo endpoint): la
        # respuesta anida el stream bajo "tickerStream", no bajo "main". Con la clave equivocada
        # esto no rompe nada (try/except lo traga) — simplemente vuelve "" en cada noticia,
        # invisible sin comprobarlo contra la forma real de la respuesta.
        stream = ((payload.get("data") or {}).get("tickerStream") or {}).get("stream") or []
        # Yahoo mete anuncios en el mismo stream (campo "ad" no vacío); yfinance los descarta
        # con el mismo criterio antes de devolver la lista.
        stream = [item for item in stream if not item.get("ad")]
        return _news_desde_stream(stream, max_items)
    except Exception:
        return []


def gather_scraper(s: creq.Session, crumb: str, ticker: str,
                   query_symbol: str | None = None) -> tuple[NameData | None, str | None]:
    """Equivalente de `fundamentals.gather()` por HTTP directo (motor primario). Mismo contrato
    EXACTO: `(datos, motivo)`, `motivo` solo puesto cuando `datos` es None.

    `query_symbol`: para el universo global, Yahoo exige el símbolo CON el sufijo de mercado
    (`000001.SZ`, no `000001`) — ver `universe_global._resolver_simbolo_por_isin`. Si se pasa,
    es lo que se manda a Yahoo; `ticker` (el del dataset, sin sufijo) sigue siendo la identidad
    bajo la que se guarda/lee la foto en todo el resto de la app.

    Distingue dos fallos (ver docstring de `TransportError`):
      - "sin_datos": 200 OK pero sin `sector`/`marketCap`/`shortName` — el ticker no tiene datos
        de verdad (deslistado/thin listing). Se devuelve `(None, motivo)` tal cual: NO es un
        fallo de transporte y reintentar por yfinance no cambiaría nada (medido: los mismos
        tickers fallan igual con o sin la sesión de consentimiento).
      - fallo de transporte (HTTP/red/JSON/crumb roto): se levanta `TransportError` para que el
        caller (`fundamentals.gather`) reintente ESE ticker por yfinance puro.
    """
    from app.screener import fundamentals as fund_mod  # perezoso: evita el ciclo de imports

    q = query_symbol or ticker
    # query2 (no query1): mismo motivo que en `_historico` — es lo medido en vivo a 3.000/3.000.
    url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{q}"
    params = {"modules": MODULES, "corsDomain": "finance.yahoo.com", "crumb": crumb,
             "formatted": "false"}
    try:
        r = s.get(url, params=params, timeout=15)
    except Exception as exc:
        raise TransportError(f"quoteSummary {q}: {exc}") from exc
    if r.status_code != 200:
        raise TransportError(f"quoteSummary {q}: HTTP {r.status_code}")
    try:
        payload = r.json()
    except Exception as exc:
        raise TransportError(f"quoteSummary {q}: JSON inválido ({exc})") from exc

    qs = payload.get("quoteSummary") or {}
    if qs.get("error"):
        # Típicamente un crumb inválido/caducado a mitad de escaneo — es transporte, no "sin
        # datos": el ticker puede tener datos perfectamente, es la petición la que falló.
        raise TransportError(f"quoteSummary {q}: {qs['error']}")
    resultados = qs.get("result") or []
    if not resultados:
        return None, "sin resultado en quoteSummary (vacío o deslistado)"
    resultado = resultados[0]

    # Los 6 módulos pedidos, aplanados en un único dict "a lo yfinance" (mismas claves que `.info`,
    # números desenvueltos de su `{"raw":...}`). Solapes entre módulos (ej. marketCap en price Y
    # summaryDetail) no importan: son el mismo dato repetido, el último módulo gana.
    info: dict = {}
    for modulo in ("price", "quoteType", "defaultKeyStatistics", "assetProfile",
                   "summaryDetail", "financialData"):
        for k, v in (resultado.get(modulo) or {}).items():
            info[k] = _sin_raw(v)

    # calendarEvents.earnings no es un módulo plano como los demás (trae una lista de fechas, no
    # un timestamp suelto) — se traduce a los mismos campos que yfinance ya deja en `.info`
    # (earningsTimestampStart/End/isEarningsDateEstimate) para que `_earnings_text` no distinga.
    cal = (resultado.get("calendarEvents") or {}).get("earnings") or {}
    fechas = cal.get("earningsDate") or []
    if fechas:
        info["earningsTimestampStart"] = _sin_raw(fechas[0])
        info["earningsTimestampEnd"] = _sin_raw(fechas[-1])
    if "isEarningsDateEstimate" in cal:
        info["isEarningsDateEstimate"] = cal["isEarningsDateEstimate"]

    if not (info.get("sector") or info.get("marketCap") or info.get("shortName")):
        return None, "sin sector/marketCap/shortName en quoteSummary (vacío o deslistado)"

    hist = _historico(s, q)
    news = _noticias(s, q)

    price = info.get("currentPrice") or info.get("regularMarketPrice")
    mcap = info.get("marketCap")
    target_high = info.get("targetHighPrice")
    target_mean = info.get("targetMeanPrice")
    data = fund_mod.NameData(
        ticker=ticker,
        sector=info.get("sector", "n/d"),
        industry=info.get("industry", "n/d"),
        price=fund_mod.numero_finito(price),
        fundamentals_text=fund_mod._fundamentals_text(info),
        technical_text=fund_mod._technical_text(info, hist),
        market_cap=fund_mod.numero_finito(mcap),
        news=news,
        earnings_text=fund_mod._earnings_text(info),
        name=info.get("shortName", ""),
        target_high=fund_mod.numero_finito(target_high),
        target_mean=fund_mod.numero_finito(target_mean),
        fundamentales_crudos=fund_mod._valores_crudos(info),
        **fund_mod.metricas(info),
    )
    return data, None
