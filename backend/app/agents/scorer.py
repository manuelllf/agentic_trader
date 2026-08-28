"""Scorer por nombre (método whitepaper DeepSeek, Exhibit 1).

Una llamada razonada por empresa: informe (noticias, financials, valoración, outlook) e
INTERPRETA → score 1-100. Prompt en inglés; salida en español.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.trace import ticker_ctx
from app.screener.fundamentals import NameData

logger = logging.getLogger(__name__)

# Núcleo compartido por prescore, capa media y profundo (Exhibit 1 del paper). Entero en vez de
# decimales: el reasoning real mostraba al modelo dudando entre dos números — precisión de mentira.
_SCORE_CORE = (
    "Use the financial data and news to assign a score (from 1 to 100) reflecting the "
    "potential investment value of the company for the next month. "
    "A price move is not by itself a verdict in either direction: a fall does not make a "
    "business weak, nor does a rally make it strong. "
    "Give the score as a whole number, and do not let it always collapse to a multiple of five. "
)

SYSTEM = (
    "You are a financial expert with stock-recommendation experience. You provide an investment "
    "score for the NEXT MONTH for a company, based on its financial data and news. Speak "
    "in the third person; do not mention credentials; do not speak directly to investors nor "
    "recommend actions; do not recommend alternatives. Write a short investment report with "
    "sections: recent news, financials, valuation, and economic outlook affecting the firm. "
    "INTERPRET the news, do not just repeat it. Do not describe the data as 'provided': call it "
    "recent or latest. The macro outlook is background context "
    "about the environment the firm operates in. "
    + _SCORE_CORE +
    # under_acquisition preguntada explícitamente, no deducida: el modelo diferencia
    # quién compra de quién es comprado cuando se le pregunta.
    "ALSO state whether THIS company is itself the TARGET of a definitive acquisition offer "
    "(someone is buying THIS company). It is false when this company is the one ACQUIRING "
    "another business. "
    'Respond ONLY in JSON: {"report": "...", "headline": "one-sentence thesis", '
    '"score": <number 1-100, whole number>, '
    '"under_acquisition": <true|false>}. '
    "Write report and headline in Spanish."
)


MID_SYSTEM = (
    _SCORE_CORE +
    # Headline se omite: no se consume (scan_service, traza, watchlist, web). ~20 tokens de salida sin uso.
    'Respond ONLY in JSON: {"score": <number 0-100, whole number>}.'
)


@dataclass
class PrescoreResult:
    ticker: str
    score: float
    # error/raw: solo si falló. `error` distingue transporte (429, timeout…) de un JSON roto;
    # `raw` guarda la respuesta cruda ENTERA. El caller decide si reintenta con `error`.
    error: str | None = None
    raw: str | None = None
    # Probabilidad del token menos seguro del LOTE (no por ticker: no hay forma barata de mapear
    # cada nota a sus tokens dentro de un JSON de 20 entradas). None si el proveedor no expone
    # logprobs (FakeLLM en tests, OpenRouter).
    confidence: float | None = None
    # A.5.4: en 3-8 palabras, qué campo pesó más. None si el flag está apagado o el modelo se lo
    # saltó. Telemetría — no entra en ningún ranking ni vuelve a un prompt.
    driver: str | None = None


@dataclass
class ScoreResult:
    ticker: str
    # float aunque el valor sea siempre entero (ver `SYSTEM`): evita tocar el tipo en toda la
    # cadena (BD, ordenación, pesos) por un cambio que es de formato, no de tipo.
    score: float
    headline: str
    report: str
    target_price: float | None = None
    # None = el modelo NO contestó al campo (no es un "no"): pasa en ~1 de cada 10 respuestas de
    # los modelos rápidos, que devuelven JSON válido sin la clave. Tratarlo como False dejaría el
    # guardarraíl desactivado en silencio, justo en el caso que existe para cazar.
    under_acquisition: bool | None = None
    error: str | None = None
    raw: str | None = None


# Etiquetas EXACTAS que emite `_fundamentals_text` para el P/E: la mediana se pega a esa línea y
# nada más — el dato al lado del dato, sin una sola instrucción sobre qué hacer con él.
_ETIQUETA_PE_TRAILING = "- P/E (trailing): "
_ETIQUETA_PE_FORWARD = "- P/E (forward): "


def _con_mediana(
    fundamentals_text: str, sector: str, medianas: dict[str, dict[str, float]] | None,
) -> str:
    """Añade `(sector median X)` a las líneas de P/E trailing Y forward (por separado — un
    sector puede tener mediana de uno y no del otro). Sin mediana para ese sector/campo, no
    toca esa línea."""
    entrada = (medianas or {}).get(sector)
    if not entrada:
        return fundamentals_text
    lineas = fundamentals_text.split("\n")
    for i, linea in enumerate(lineas):
        if "trailing" in entrada and linea.startswith(_ETIQUETA_PE_TRAILING):
            lineas[i] = f"{linea} (sector median {entrada['trailing']})"
        elif "forward" in entrada and linea.startswith(_ETIQUETA_PE_FORWARD):
            lineas[i] = f"{linea} (sector median {entrada['forward']})"
    return "\n".join(lineas)


def _user_prompt(data: NameData, macro_block: str, prior_thesis: str | None,
                 medianas: dict[str, dict[str, float]] | None = None) -> str:
    news = "\n".join(f"- {h}" for h in data.news) if data.news else "none"
    prior = (
        f"\nPrior view on this name (from our records): {prior_thesis}\n"
        "Assess explicitly what has changed since then.\n"
        if prior_thesis else ""
    )
    return (
        # Macro delante del ticker (antes iba detrás): el bloque macro es idéntico para TODAS
        # las llamadas del profundo en un mismo escaneo — ponerlo primero deja el prefijo
        # repetido más largo posible para la caché de disco de DeepSeek (ver `llm/deepseek.py`),
        # sin cambiar ni una palabra del contenido.
        f"Macro outlook:\n{macro_block}\n\n"
        # "Macro & SECTOR outlook" era un resto de cuando el macro traía tilt sectorial: ahora el
        # prompt del macro le PROHÍBE nombrar sectores, así que la etiqueta prometía algo que no
        # existe y colaba la palabra "sector" como marco en cada llamada. El sector de ESTA empresa
        # sigue abajo, que es donde el paper lo pone.
        f"Company: {data.ticker} — sector {data.sector} / {data.industry}.\n"
        f"Latest fundamentals:\n{_con_mediana(data.fundamentals_text, data.sector, medianas)}\n\n"
        f"Technical context: {data.technical_text or 'n/d'}\n"
        # Fecha de resultados como dato más del contexto, SIN regla de qué hacer con ella
        # (decisión pública del post de AXS: dato sí, instrucción no). Solo en el profundo.
        f"Earnings calendar: {data.earnings_text or 'n/d'}\n\n"
        f"Recent news:\n{news}\n"
        f"{prior}\n"
        "Write the investment report (JSON) and the 1-100 score."
    )


def _mid_prompt(data: NameData, macro_block: str,
                medianas: dict[str, dict[str, float]] | None = None) -> str:
    # Todos los titulares, no solo los 3 primeros: la capa media decide quién llega al análisis
    # caro viendo un tercio de las noticias. En un escaneo real dio 100/100 a un nombre —el
    # único ≥90 de 2.594— y el profundo le puso 48 en cuanto vio la noticia que lo hundía (venta
    # de acciones por directivos), fuera del top-3. La segunda opinión no es un profundo barato:
    # es otro juez.
    news = "; ".join(data.news) if data.news else "none"
    name = f" ({data.name})" if data.name else ""
    # Las noticias van ANTES de los ~50 fundamentales, no detrás: el propio SYSTEM dice que se
    # pesen "TOGETHER", y quedaban enterradas tras cincuenta líneas de números.
    return (
        # Macro delante (mismo motivo que en `_user_prompt`): prefijo idéntico entre las ~200
        # llamadas de la capa media de un escaneo, cache-friendly sin tocar el contenido.
        f"Macro: {macro_block}\n"
        f"{data.ticker}{name} — {data.sector}/{data.industry}\n"
        f"News: {news}\n"
        f"Fundamentals:\n{_con_mediana(data.fundamentals_text, data.sector, medianas)}\n"
        f"Technical: {data.technical_text or 'n/d'}\n"
        # Igual que en el lote barato (ver `_prescore_batch_prompt`): dato del calendario, sin
        # regla de qué hacer con él.
        f"Earnings: {data.earnings_text or 'n/d'}\n"
        "1-100 score (JSON)."
    )


# La respuesta cruda de un fallo va ENTERA a `ScanRun.failures` (antes se recortaba a 1500
# chars): un JSON degenerado o un bucle de repetición se diagnostica por su forma completa, y
# son unas decenas de casos por escaneo, no miles.


def mid_prescore(
    llm: LLMProvider, data: NameData, macro_block: str, temperature: float = 1.0,
    top_p: float | None = 0.95, medianas: dict[str, dict[str, float]] | None = None,
) -> PrescoreResult:
    """Segunda opinión: best-effort 0 si falla, con error/raw para decidir reintento."""
    raw = ""
    try:
        # `ticker_ctx`: el proveedor no sabe de qué nombre es la llamada; así la traza lo sabe
        # sin meter un parámetro de telemetría en la interfaz del LLM (ver `app/llm/trace.py`).
        with ticker_ctx(data.ticker):
            raw = llm.chat(MID_SYSTEM, _mid_prompt(data, macro_block, medianas),
                           temperature=temperature, top_p=top_p) or ""
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = max(0.0, min(100.0, round(float(obj.get("score", 0)))))
        # Score 0 en escala 1-100 = fallo de parseo. Sin esto, nombres caen sin rastro.
        # Medido: 118/3.000 invisibles sin este guardarraíl.
        if sc <= 0:
            return PrescoreResult(data.ticker, 0.0,
                                  error="SinNota: JSON válido sin score utilizable",
                                  raw=raw)
        return PrescoreResult(data.ticker, sc)
    except Exception as exc:
        logger.warning("Capa media no parseable para %s (%s): %r", data.ticker, exc, raw[:400])
        return PrescoreResult(data.ticker, 0.0, error=f"{type(exc).__name__}: {exc}",
                              raw=raw)


# Pre-score INDIVIDUAL — triaje rápido del universo, 1 llamada/ticker (fiel al paper).
# Macro va siempre delante para maximizar hit de caché de prefijo DeepSeek.

# El orden de las claves es TODO el diseño: con la nota primero, el driver se emite DESPUÉS de
# un token ya fijado — racionalización a posteriori, telemetría que no cambia la nota. Al revés
# sería un micro-razonamiento encubierto, y eso es otro experimento (ver docs/prompts.md).
_PRESCORE_JSON = 'Respond ONLY in JSON: {"score": <number 0-100, whole number>}.'
_PRESCORE_JSON_DRIVER = (
    'Respond ONLY in JSON: {"score": <number 0-100, whole number>, '
    '"driver": "<3-8 words naming the single input that weighed most>"}.'
)

PRESCORE_SYSTEM = _SCORE_CORE + _PRESCORE_JSON


def _prescore_system() -> str:
    """El prompt del prescore, con o sin el campo `driver` según `settings.prescore_driver`."""
    return _SCORE_CORE + (_PRESCORE_JSON_DRIVER if settings.prescore_driver
                          else _PRESCORE_JSON)


def _prescore_prompt(data: NameData, macro_block: str,
                     medianas: dict[str, dict[str, float]] | None = None) -> str:
    news = "; ".join(_titulo(n) for n in data.news) if data.news else "none"
    name = f" ({data.name})" if data.name else ""
    return (
        f"Macro outlook: {macro_block}\n"
        f"{data.ticker}{name} — {data.sector}/{data.industry}\n"
        f"News: {news}\n"
        f"Fundamentals:\n{_con_mediana(data.fundamentals_text, data.sector, medianas)}\n"
        f"Technical: {data.technical_text or 'n/d'}\n"
        f"Earnings: {data.earnings_text or 'n/d'}\n"
        "1-100 score (JSON)."
    )


def prescore_one(
    llm: LLMProvider, data: NameData, macro_block: str, temperature: float = 1.0,
    top_p: float | None = 0.95, medianas: dict[str, dict[str, float]] | None = None,
) -> PrescoreResult:
    """Triaje de un ticker: best-effort 0 si falla. temperature=1.0 (DeepSeek para análisis).
    temperature/top_p mandados en todas etapas aunque reasoning los ignore."""
    raw = ""
    confidence: float | None = None
    # chat_logprobs: solo DeepSeekProvider (duck-typing, ver prescore_batch). Individual = 1
    # ticker por respuesta, así que aquí SÍ mapea limpio: la confianza es de ESE ticker.
    chat_fn = getattr(llm, "chat_logprobs", None)
    try:
        with ticker_ctx(data.ticker):
            system, user = _prescore_system(), _prescore_prompt(data, macro_block, medianas)
            if chat_fn is not None:
                raw, confidence = chat_fn(system, user, temperature=temperature, top_p=top_p)
                raw = raw or ""
            else:
                raw = llm.chat(system, user, temperature=temperature, top_p=top_p) or ""
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = max(0.0, min(100.0, round(float(obj.get("score", 0)))))
        if sc <= 0:
            return PrescoreResult(data.ticker, 0.0,
                                  error="SinNota: JSON válido sin score utilizable",
                                  raw=raw, confidence=confidence)
        # Sin aviso por llamada: viaja en `PrescoreResult.confidence` y el escaneo lo resume
        # agregado (ver `_log_funnel`). Una línea por ticker inundaba y Railway las descartaba.
        driver = str(obj.get("driver") or "").strip() or None
        return PrescoreResult(data.ticker, sc, confidence=confidence, driver=driver)
    except Exception as exc:
        logger.warning("Pre-score no parseable para %s (%s): %r", data.ticker, exc, raw[:400])
        return PrescoreResult(data.ticker, 0.0, error=f"{type(exc).__name__}: {exc}",
                              raw=raw, confidence=confidence)


# ---------------------------------------------------------------------------------------------
# Pre-score por LOTES — SOLO circuito OpenRouter (`llm_provider="openrouter"`, pruebas locales
# puntuales). Agrupa N tickers en una sola llamada.
# Medido en vivo: la sobrecarga fija por llamada (cola del proveedor detrás del
# alias, no generación — una sola empresa tardó de 2,5 a 49,5s) domina el reloj del pre-score
# puro (~3.000 llamadas, ~85% del tiempo de un escaneo). Agrupar de 20 en 20 la amortiza: ~150
# llamadas en vez de ~3.000, ~80-100s por lote limpio para 20 empresas.
# ---------------------------------------------------------------------------------------------

PRESCORE_BATCH_SYSTEM = (
    "You will be given SEVERAL companies and must judge each one independently. "
    + _SCORE_CORE +
    # Cláusula propia de este nivel (no la necesita la capa media, que juzga 1 ticker por
    # llamada): el riesgo medido de agrupar varios nombres en un mismo prompt es que el juicio
    # de uno "contamine" al siguiente (orden, comparación implícita) — se le pide
    # EXPLÍCITAMENTE que no lo haga.
    "Judge each company ONLY on its own fundamentals, valuation and news, weighed together. Do "
    "NOT compare or rank the companies against each other, and do not let one company's news or "
    "sector color your judgment of another. "
    'Respond ONLY in JSON: {"scores": [{"ticker": "<TICKER>", "score": <number 0-100, whole '
    'number>}, ...]}. Example (illustrative tickers, NOT real data) for THREE '
    "companies — respond the SAME way but for ALL companies listed below, one entry each, "
    'omitting none: {"scores": [{"ticker": "ABCD", "score": 68}, {"ticker": "WXYZ", '
    '"score": 91}, {"ticker": "QRST", "score": 34}]}.'
)


def _titulo(item: str) -> str:
    """Del titular enriquecido "título — resumen" que ahora trae `data.news`, se queda solo con
    el título: el triaje por lotes corre ~3.000 veces por escaneo y necesita quedarse barato, así
    que aquí NO viaja el resumen (eso es exclusivo de la capa media, que hace ~150 llamadas)."""
    return item.split(" — ", 1)[0]


def _prescore_batch_prompt(items: list[NameData], macro_block: str) -> str:
    partes = [f"Macro outlook: {macro_block}\n", "Companies (score each independently):\n"]
    for i, d in enumerate(items, 1):
        news = "; ".join(_titulo(n) for n in d.news) if d.news else "none"
        name = f" ({d.name})" if d.name else ""
        partes.append(
            f"{i}. {d.ticker}{name} — {d.sector}/{d.industry}\n"
            f"News: {news}\n"
            f"Fundamentals:\n{d.fundamentals_text}\n"
            f"Technical: {d.technical_text or 'n/d'}\n"
            # Dato del calendario, sin regla de qué hacer con él (misma decisión que en el
            # profundo y en la capa media): aprobado explícitamente como la única vía legítima
            # de enriquecer el triaje barato, sin meterle factores con nombre que induzcan sesgo.
            f"Earnings: {d.earnings_text or 'n/d'}\n"
        )
    return "\n".join(partes)


def _formato_degenerado(notas: list[float]) -> bool:
    """True si ≥90% son múltiplos de 5: indica que el lote colapsó pese al aviso."""
    if len(notas) < 5:
        return False
    multiplo_5 = sum(1 for n in notas if round(n) % 5 == 0)
    return multiplo_5 / len(notas) >= 0.9


# Umbral de aviso para `confidence` (probabilidad del token menos seguro del lote) — de momento
# sin calibrar con datos reales: se avisa bajo, para no generar ruido hasta ver la distribución
# real en producción y ajustar el corte.
_LOW_CONFIDENCE = 0.05


def prescore_batch(
    llm: LLMProvider, items: list[NameData], macro_block: str, temperature: float = 1.0,
    top_p: float | None = 0.95,
) -> dict[str, PrescoreResult]:
    """Prescore de un lote en una llamada. Reintento interno (hasta 3 total) por JSON roto/degenerado.
    Si un ticker ausente en respuesta válida, NO se reintenta lote entero."""
    wanted = {d.ticker for d in items}
    user = _prescore_batch_prompt(items, macro_block)
    raw = ""
    notas: dict[str, float] = {}
    confidence: float | None = None
    # chat_logprobs: solo DeepSeekProvider lo tiene (duck-typing, sin tocar el Protocol LLMProvider
    # para no romper FakeLLM/OpenRouter en tests). Sin él, confidence se queda en None.
    chat_fn = getattr(llm, "chat_logprobs", None)
    for intento in range(3):
        try:
            if chat_fn is not None:
                raw, confidence = chat_fn(PRESCORE_BATCH_SYSTEM, user, temperature=temperature,
                                          top_p=top_p)
                raw = raw or ""
            else:
                raw = llm.chat(PRESCORE_BATCH_SYSTEM, user, temperature=temperature,
                               top_p=top_p) or ""
            obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
            filas = obj.get("scores")
            if not isinstance(filas, list) or not filas:
                raise ValueError("sin 'scores' o lista vacía")
            notas = {}
            for fila in filas:
                t = str(fila.get("ticker", "")).strip().upper()
                if t not in wanted or t in notas:
                    continue
                try:
                    notas[t] = max(0.0, min(100.0, round(float(fila.get("score", 0)))))
                except (TypeError, ValueError):
                    notas[t] = 0.0
            if _formato_degenerado(list(notas.values())):
                # Medido en producción (dos escaneos reales, formato con decimales): reintentar el
                # lote no arregla el colapso de forma fiable, cada intento salía igual o peor. Se
                # acepta y se avisa en vez de perder los 20 nombres del lote por reintentar de más.
                # El desempate resultante por market cap es el mismo mecanismo que define el paper.
                logger.warning("Prescore por lote (%d empresas): formato degenerado (≥90%% "
                               "múltiplos de 5) — se acepta igual, no se reintenta", len(items))
            # La confianza viaja en cada `PrescoreResult`; el escaneo la resume (ver `_log_funnel`).
            break
        except Exception as exc:
            logger.warning("Prescore por lote (%d empresas) intento %d/3 falló: %s (%r)",
                           len(items), intento + 1, exc, raw[:400])
            notas = {}
    if not notas:
        return {t: PrescoreResult(t, 0.0, error="lote no parseable/degenerado tras 3 intentos",
                                  raw=raw, confidence=confidence) for t in wanted}

    out: dict[str, PrescoreResult] = {}
    for t in wanted:
        if t not in notas:
            out[t] = PrescoreResult(t, 0.0, error="ausente de la respuesta del lote",
                                    confidence=confidence)
        elif notas[t] <= 0:
            out[t] = PrescoreResult(t, 0.0, error="SinNota: score no utilizable en el lote",
                                    confidence=confidence)
        else:
            out[t] = PrescoreResult(t, notas[t], confidence=confidence)
    return out


def score(
    llm: LLMProvider, data: NameData, macro_block: str, prior_thesis: str | None = None,
    temperature: float = 1.0, top_p: float | None = 0.95,
    medianas: dict[str, dict[str, float]] | None = None,
) -> ScoreResult:
    """Puntúa un nombre. Best-effort: si el LLM falla/no parsea, score 0 (queda fuera), con
    `error`/`raw` para que el caller sepa POR QUÉ y decida si reintenta."""
    raw = ""
    try:
        with ticker_ctx(data.ticker):
            raw = llm.chat(SYSTEM, _user_prompt(data, macro_block, prior_thesis, medianas),
                           temperature=temperature, top_p=top_p) or ""
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = max(0.0, min(100.0, round(float(obj.get("score", 0)))))
        tp = obj.get("target_price")
        try:
            tp = float(tp) if tp is not None else None
        except (TypeError, ValueError):
            tp = None
        ua = obj.get("under_acquisition")
        # Solo un booleano de verdad cuenta: un "true" en texto o un 1 son respuestas que no
        # sabemos leer con seguridad, y aquí equivocarse cuesta una posición de la cartera.
        ua = ua if isinstance(ua, bool) else None
        # Score 0 = fallo de parseo. Sin esto, nombre cae sin rastro (pasó con empresas grandes).
        # Se marca error Y se guarda crudo para diagnóstico posterior.
        if sc <= 0:
            return ScoreResult(ticker=data.ticker, score=0.0, headline="", report="",
                               error="SinNota: JSON válido sin score utilizable",
                               raw=raw)
        return ScoreResult(
            ticker=data.ticker,
            score=sc,
            headline=str(obj.get("headline", "")).strip(),
            report=str(obj.get("report", "")).strip(),
            target_price=tp,
            under_acquisition=ua,
        )
    except Exception as exc:
        logger.warning("Scorer no parseable para %s (%s): %r", data.ticker, exc, raw[:400])
        return ScoreResult(ticker=data.ticker, score=0.0, headline="", report="",
                           error=f"{type(exc).__name__}: {exc}", raw=raw)
