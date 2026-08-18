"""Scorer por nombre (método whitepaper DeepSeek, Exhibit 1).

Una llamada razonada por empresa: informe (noticias, financials, valoración, outlook) e
INTERPRETA → score 1.00-100.00 contra el S&P 500. Prompt en inglés; salida en español.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.llm.base import LLMProvider
from app.screener.fundamentals import NameData

logger = logging.getLogger(__name__)

SYSTEM = (
    "You are a financial expert with stock-recommendation experience. You provide an investment "
    "score (1-100) for the NEXT MONTH for a company, based on its financial data and news. Speak "
    "in the third person; do not mention credentials; do not speak directly to investors nor "
    "recommend actions; do not recommend alternatives. Write a short investment report with "
    "sections: recent news, financials, valuation, and economic outlook affecting the firm. "
    "INTERPRET the news, do not just repeat it. Do not describe the data as 'provided': call it "
    "recent or latest. The macro outlook is background context "
    "about the environment the firm operates in; weigh it as you judge appropriate for this "
    "specific company. "
    # Medido sobre 49 finalistas: sin esta frase las castigadas (RSI≤45) perdían 13,7 puntos de
    # media y las calientes 5,5 — protege a las caídas de que se las penalice por haber caído.
    "A price move is not by itself a verdict in either direction: a fall does not make a "
    "business weak, nor does a rally make it strong. "
    # Anti-sesgo explícito quitado: universo no es S&P 500, divergen absoluto y relativo.
    # "Beat the S&P 500" fija referencia, no dirección.
    "Then assign a "
    "score from 1.00 to 100.00 for the potential investment value over the next month "
    "(100 = best): rank how likely this company is to outperform the S&P 500 over that month. "
    # Dos decimales evitan que market cap decida a mitad del ranking (repartía 1 plaza antes de esto).
    # No se prohíben cuartos explícitamente (produciría respuestas degeneradas).
    "Use exactly two decimal places, and let those decimals carry real precision rather than "
    "rounding to quarters or halves - e.g. 71.38, 84.61. "
    # Horizonte de nota, precio objetivo y rebalanceo deben coincidir (un mes). "12-18 month"
    # para los objetivos de analistas evita que target_price copie su consenso, sin decir "no copies", que sobrecorregía.
    "ALSO give your own approximate PRICE TARGET for the same one-month horizon as the score (a "
    "single number in the stock's trading currency), informed by the fundamentals and the analyst "
    "targets provided, which are typically published for a 12-18 month horizon - a much longer "
    "call than the one-month target you are making here. If the news show "
    "the company is under a definitive cash acquisition offer, use the offer terms exactly as "
    "reported (do not derive per-share figures yourself) and do not set the price target above "
    "the cash offer price. "
    # under_acquisition preguntada explícitamente, no deducida: el modelo diferencia
    # quién compra de quién es comprado cuando se le pregunta.
    "ALSO state whether THIS company is itself the TARGET of a definitive acquisition offer "
    "(someone is buying THIS company). It is false when this company is the one ACQUIRING "
    "another business. "
    'Respond ONLY in JSON: {"report": "...", "headline": "one-sentence thesis", '
    '"score": <number 1.00-100.00, two decimal places>, "target_price": <number>, '
    '"under_acquisition": <true|false>}. '
    "Write report and headline in Spanish."
)


MID_SYSTEM = (
    "You are the SECOND-OPINION triage of an equity research pipeline, reviewing companies that "
    "a cheaper first pass already ranked highly. Your score answers ONE question: how likely is "
    "it that a rigorous deep fundamental analysis would find this company attractive for the next "
    "month? Weigh fundamentals, valuation and news TOGETHER. "
    # Misma frase que el profundo y por el mismo motivo: los dos jueces del mismo nombre deben
    # llevar la misma config, o el corte de finalistas queda a medio criterio.
    "A price move is not by itself a verdict in either direction: a fall does not make a "
    "business weak, nor does a rally make it strong. "
    "Calibrate the scale: 90+ exceptional (rare), 75-89 strong candidate for deep review, 50-74 "
    # Pasa de UNO a DOS decimales, misma redacción que el profundo. Aquí el empate cuesta
    # más que allí: son ~3.000 nombres compitiendo por ~50 plazas de finalista, y el carril global
    # del corte va por orden de esta nota. El desempate también es por market cap, así que un
    # empate ancho en la frontera es otra vez tamaño decidiendo. Los dos jueces con la misma
    # granularidad, además, hacen comparables sus dos rankings.
    "unremarkable, <50 weak. Use exactly two decimal places, and let those decimals carry real "
    "precision rather than rounding to quarters or halves - e.g. 71.38, 84.61. "
    # Headline se omite: no se consume (scan_service, traza, watchlist, web). ~20 tokens de salida sin uso.
    'Respond ONLY in JSON: {"score": <number 0-100, two decimal places>}.'
)


@dataclass
class PrescoreResult:
    ticker: str
    score: float
    # error/raw: solo si falló. `error` distingue transporte (429, timeout…) de un JSON roto;
    # `raw` guarda ~300 chars de la respuesta cruda. El caller decide si reintenta con `error`.
    error: str | None = None
    raw: str | None = None
    # Probabilidad del token menos seguro del LOTE (no por ticker: no hay forma barata de mapear
    # cada nota a sus tokens dentro de un JSON de 20 entradas). None si el proveedor no expone
    # logprobs (FakeLLM en tests, OpenRouter).
    confidence: float | None = None


@dataclass
class ScoreResult:
    ticker: str
    # float, no int: la nota lleva dos decimales (ver `SYSTEM`). Redondearla a entero aquí volvería
    # a apelmazar el ranking justo antes del corte, que es el problema que los decimales resuelven.
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


def _user_prompt(data: NameData, macro_block: str, prior_thesis: str | None) -> str:
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
        f"Latest fundamentals:\n{data.fundamentals_text}\n\n"
        f"Technical context: {data.technical_text or 'n/d'}\n"
        # Fecha de resultados como dato más del contexto, SIN regla de qué hacer con ella
        # (decisión pública del post de AXS: dato sí, instrucción no). Solo en el profundo.
        f"Earnings calendar: {data.earnings_text or 'n/d'}\n\n"
        f"Recent news:\n{news}\n"
        f"{prior}\n"
        "Write the investment report (JSON) and the 1.00-100.00 score."
    )


def _mid_prompt(data: NameData, macro_block: str) -> str:
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
        f"Fundamentals:\n{data.fundamentals_text}\n"
        f"Technical: {data.technical_text or 'n/d'}\n"
        # Igual que en el lote barato (ver `_prescore_batch_prompt`): dato del calendario, sin
        # regla de qué hacer con él.
        f"Earnings: {data.earnings_text or 'n/d'}\n"
        "1.00-100.00 score (JSON)."
    )


_RAW_MAX = 1500          # se persiste en ScanRun.failures: unas decenas de KB al mes, nada


def _recorte(raw: str) -> str:
    """Respuesta truncada para diagnóstico: principio (prosa vs JSON) y final (corte a medias)."""
    if len(raw) <= _RAW_MAX:
        return raw
    mitad = _RAW_MAX // 2
    return f"{raw[:mitad]}\n…[recortado {len(raw) - _RAW_MAX} chars]…\n{raw[-mitad:]}"


def mid_prescore(
    llm: LLMProvider, data: NameData, macro_block: str, temperature: float = 1.0,
    top_p: float | None = 0.95,
) -> PrescoreResult:
    """Segunda opinión: best-effort 0 si falla, con error/raw para decidir reintento."""
    raw = ""
    try:
        raw = llm.chat(MID_SYSTEM, _mid_prompt(data, macro_block),
                       temperature=temperature, top_p=top_p) or ""
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = max(0.0, min(100.0, round(float(obj.get("score", 0)), 2)))
        # Score 0 en escala 1-100 = fallo de parseo. Sin esto, nombres caen sin rastro.
        # Medido: 118/3.000 invisibles sin este guardarraíl.
        if sc <= 0:
            return PrescoreResult(data.ticker, 0.0,
                                  error="SinNota: JSON válido sin score utilizable",
                                  raw=_recorte(raw))
        return PrescoreResult(data.ticker, sc)
    except Exception as exc:
        logger.warning("Capa media no parseable para %s (%s): %r", data.ticker, exc, raw[:400])
        return PrescoreResult(data.ticker, 0.0, error=f"{type(exc).__name__}: {exc}",
                              raw=_recorte(raw))


# Pre-score INDIVIDUAL — triaje rápido del universo, 1 llamada/ticker (fiel al paper).
# Macro va siempre delante para maximizar hit de caché de prefijo DeepSeek.

PRESCORE_SYSTEM = (
    "You are the first-pass TRIAGE of an equity research pipeline. For the company given, "
    "answer ONE question: how likely is it that a rigorous deep fundamental analysis would find "
    "this company attractive for the next month? Weigh fundamentals, valuation and news "
    "TOGETHER. "
    # Misma frase en las cinco etapas: si los jueces del mismo nombre miden distinto, el corte
    # de finalistas queda a medio criterio.
    "A price move is not by itself a verdict in either direction: a fall does not make a "
    "business weak, nor does a rally make it strong. "
    "Calibrate the scale: 90+ exceptional (rare), 75-89 strong "
    "candidate for deep review, 50-74 unremarkable, <50 weak. Use exactly two decimal places, "
    "and let those decimals carry real precision rather than rounding to quarters or halves - "
    'e.g. 71.38, 84.61. Respond ONLY in JSON: {"score": <number 0-100, two decimal places>}.'
)


def _prescore_prompt(data: NameData, macro_block: str) -> str:
    news = "; ".join(_titulo(n) for n in data.news) if data.news else "none"
    name = f" ({data.name})" if data.name else ""
    return (
        f"Macro outlook: {macro_block}\n"
        f"{data.ticker}{name} — {data.sector}/{data.industry}\n"
        f"News: {news}\n"
        f"Fundamentals:\n{data.fundamentals_text}\n"
        f"Technical: {data.technical_text or 'n/d'}\n"
        f"Earnings: {data.earnings_text or 'n/d'}\n"
        "1.00-100.00 score (JSON)."
    )


def prescore_one(
    llm: LLMProvider, data: NameData, macro_block: str, temperature: float = 1.0,
    top_p: float | None = 0.95,
) -> PrescoreResult:
    """Triaje de un ticker: best-effort 0 si falla. temperature=1.0 (DeepSeek para análisis).
    temperature/top_p mandados en todas etapas aunque reasoning los ignore."""
    raw = ""
    confidence: float | None = None
    # chat_logprobs: solo DeepSeekProvider (duck-typing, ver prescore_batch). Individual = 1
    # ticker por respuesta, así que aquí SÍ mapea limpio: la confianza es de ESE ticker.
    chat_fn = getattr(llm, "chat_logprobs", None)
    try:
        if chat_fn is not None:
            raw, confidence = chat_fn(PRESCORE_SYSTEM, _prescore_prompt(data, macro_block),
                                      temperature=temperature, top_p=top_p)
            raw = raw or ""
        else:
            raw = llm.chat(PRESCORE_SYSTEM, _prescore_prompt(data, macro_block),
                           temperature=temperature, top_p=top_p) or ""
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = max(0.0, min(100.0, round(float(obj.get("score", 0)), 2)))
        if sc <= 0:
            return PrescoreResult(data.ticker, 0.0,
                                  error="SinNota: JSON válido sin score utilizable",
                                  raw=_recorte(raw), confidence=confidence)
        # Sin aviso por llamada: viaja en `PrescoreResult.confidence` y el escaneo lo resume
        # agregado (ver `_log_funnel`). Una línea por ticker inundaba y Railway las descartaba.
        return PrescoreResult(data.ticker, sc, confidence=confidence)
    except Exception as exc:
        logger.warning("Pre-score no parseable para %s (%s): %r", data.ticker, exc, raw[:400])
        return PrescoreResult(data.ticker, 0.0, error=f"{type(exc).__name__}: {exc}",
                              raw=_recorte(raw), confidence=confidence)


# ---------------------------------------------------------------------------------------------
# Pre-score por LOTES — SOLO circuito OpenRouter (`llm_provider="openrouter"`, pruebas locales
# puntuales). Agrupa N tickers en una sola llamada.
# Medido en vivo: la sobrecarga fija por llamada (cola del proveedor detrás del
# alias, no generación — una sola empresa tardó de 2,5 a 49,5s) domina el reloj del pre-score
# puro (~3.000 llamadas, ~85% del tiempo de un escaneo). Agrupar de 20 en 20 la amortiza: ~150
# llamadas en vez de ~3.000, ~80-100s por lote limpio para 20 empresas.
# ---------------------------------------------------------------------------------------------

PRESCORE_BATCH_SYSTEM = (
    "You are the first-pass TRIAGE of an equity research pipeline. You will be given SEVERAL "
    "companies. For EACH one, INDEPENDENTLY, answer ONE question: how likely is it that a "
    "rigorous deep fundamental analysis would find this company attractive for the next month? "
    # Cláusula propia de este nivel (no la necesita la capa media, que juzga 1 ticker por
    # llamada): el riesgo medido de agrupar varios nombres en un mismo prompt es que el juicio
    # de uno "contamine" al siguiente (orden, comparación implícita) — se le pide
    # EXPLÍCITAMENTE que no lo haga.
    "Judge each company ONLY on its own fundamentals, valuation and news, weighed together. Do "
    "NOT compare or rank the companies against each other, and do not let one company's news or "
    "sector color your judgment of another. "
    # Misma frase que el resto del scoring (ver `SYSTEM`) — este nivel solo corre con OpenRouter
    # local, pero se mantiene consistente con producción.
    "A price move is not by itself a verdict in either direction: a fall does not make a "
    "business weak, nor does a rally make it strong. "
    "Calibrate the scale: 90+ "
    "exceptional (rare), 75-89 strong candidate for deep review, 50-74 unremarkable, <50 weak. "
    "Use exactly two decimal places, and let those decimals carry real precision rather than "
    "rounding to quarters or halves - e.g. 71.38, 84.61. "
    'Respond ONLY in JSON: {"scores": [{"ticker": "<TICKER>", "score": <number 0-100, two '
    'decimal places>}, ...]}. Example (illustrative tickers, NOT real data) for THREE '
    "companies — respond the SAME way but for ALL companies listed below, one entry each, "
    'omitting none: {"scores": [{"ticker": "ABCD", "score": 68.47}, {"ticker": "WXYZ", '
    '"score": 91.02}, {"ticker": "QRST", "score": 34.19}]}.'
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
    """True si ≥90% comparten un solo decimal (segundo en cero): indica lote degenerado."""
    if len(notas) < 5:
        return False
    un_decimal = sum(1 for n in notas if round(n * 100) % 10 == 0)
    return un_decimal / len(notas) >= 0.9


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
                    notas[t] = max(0.0, min(100.0, round(float(fila.get("score", 0)), 2)))
                except (TypeError, ValueError):
                    notas[t] = 0.0
            if _formato_degenerado(list(notas.values())):
                # Medido en producción (dos escaneos reales): reintentar el lote NO arregla el
                # formato de forma fiable — un mismo lote pasó de un decimal (intento
                # 1) a un decimal otra vez (intento 2) a CERO decimales (intento 3), cada vez
                # peor. El coste de reintentar (hasta ×3 llamadas) no compraba nada, y cuando los
                # 3 intentos fallaban se perdían los 20 nombres enteros — peor que aceptar la
                # nota con menos precisión. Se acepta y se avisa; ya no se descarta ni reintenta
                # solo por esto. El desempate más grosero en el corte de finalistas (por market
                # cap) es el mismo mecanismo que el paper ya prevé como caso raro.
                logger.warning("Prescore por lote (%d empresas): formato degenerado (≥90%% con "
                               "un solo decimal) — se acepta igual, no se reintenta", len(items))
            # La confianza viaja en cada `PrescoreResult`; el escaneo la resume (ver `_log_funnel`).
            break
        except Exception as exc:
            logger.warning("Prescore por lote (%d empresas) intento %d/3 falló: %s (%r)",
                           len(items), intento + 1, exc, raw[:400])
            notas = {}
    if not notas:
        return {t: PrescoreResult(t, 0.0, error="lote no parseable/degenerado tras 3 intentos",
                                  raw=_recorte(raw), confidence=confidence) for t in wanted}

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
) -> ScoreResult:
    """Puntúa un nombre. Best-effort: si el LLM falla/no parsea, score 0 (queda fuera), con
    `error`/`raw` para que el caller sepa POR QUÉ y decida si reintenta."""
    raw = ""
    try:
        raw = llm.chat(SYSTEM, _user_prompt(data, macro_block, prior_thesis),
                       temperature=temperature, top_p=top_p) or ""
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = max(0.0, min(100.0, round(float(obj.get("score", 0)), 2)))
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
                               raw=_recorte(raw))
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
                           error=f"{type(exc).__name__}: {exc}", raw=_recorte(raw))
