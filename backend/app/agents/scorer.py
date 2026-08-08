"""Scorer por nombre (método whitepaper DeepSeek, Exhibit 1).

Una llamada razonada (V4-Pro) por empresa: escribe un Investment Report (noticias, financials,
valoración, outlook) e INTERPRETA (no repite) → devuelve un Score 1,00-100,00 (dos decimales,
ver `SYSTEM`) para el próximo mes, medido contra el S&P 500. Los técnicos van como contexto más.
Para nombres en cartera/watchlist se le inyecta la tesis previa ("la última vez opinaste X —
¿qué ha cambiado?").

Prompt en inglés (ahorra tokens); el informe y la tesis los devuelve en español.
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
    "specific company. Do not raise or lower the score merely because of the company's sector or "
    "its market size - ask whether the news and figures change the earnings power or the "
    "valuation case. Company size and liquidity remain legitimate risk considerations; by "
    "themselves they are not a reason for a higher or a lower score. "
    # Esta frase sustituye a dos que había antes: "no subas ni bajes por un movimiento
    # reciente del precio EN CUALQUIER DIRECCIÓN" y "los técnicos son CONTEXTO, nunca regla de
    # decisión". Se quitaron y se MIDIÓ el efecto sobre 49 finalistas reales: con el
    # modelo grande, las castigadas (RSI≤45) perdían 13,7 puntos de media y las calientes solo
    # 5,5 — es decir, el trabajo real de aquella cláusula lo hacía en la dirección de BAJADA,
    # protegiendo a las caídas de que se las penalizara por haber caído. Eso es justo lo que
    # busca la estrategia (retroceso de un nombre fuerte), así que la protección vuelve; lo que
    # no vuelve es la parte que impedía descontar lo ya subido ni la prohibición sobre los
    # técnicos, que el paper tampoco tiene. Sin dirección: no dice qué hacer, dice qué NO es
    # una conclusión por sí sola.
    "A price move is not by itself a verdict in either direction: a fall does not make a "
    "business weak, nor does a rally make it strong. "
    # "potential investment value" es literal del Exhibit 1 y se queda. Lo que se añade es contra
    # QUÉ se mide, y no es un adorno: el paper puntúa empresas DEL S&P 500, así que en su montaje
    # ordenar por valor absoluto y ordenar por valor relativo al índice son la misma operación —el
    # pool ES el índice—. Nuestro universo son ~3.000 nombres de 300M a 3B, donde las dos lecturas
    # se separan: una opada con un +1,4% garantizado es buen "investment value" en absoluto y malo
    # en relativo, y por eso la misma empresa salía 55 en una tirada y 88,63 en la siguiente
    # (movimiento medio del resto: 4,7 puntos). "Beat the S&P 500" es además vocabulario del propio
    # paper (Exhibit 2E). No añade una dirección: dice contra qué se compara.
    "Then assign a "
    "score from 1.00 to 100.00 for the potential investment value over the next month "
    "(100 = best): rank how likely this company is to outperform the S&P 500 over that month. "
    # DOS DECIMALES. Motivo medido, no estético: con nota entera, sobre 49 finalistas reales
    # la nota de corte del top-10 fue 78 con DIEZ nombres empatados en ella para CINCO
    # plazas. Es decir, el desempate por market cap —que el paper prevé como caso raro— decidió la
    # mitad del top-10, y se llevó a los cinco mayores (GOOGL, MSFT, TSM, AVGO, HIG) dejando fuera
    # a las cinco pequeñas por tamaño y solo por tamaño. Un filtro de large caps silencioso en un
    # sistema cuya estrategia son small/mid asimétricas. Con dos decimales el desempate pasó a
    # repartir 1 plaza. El "carry real precision" está SUAVIZADO a propósito: prohibirle los
    # cuartos endureció el prompt y produjo 3 respuestas degeneradas; así dio 38 notas distintas
    # de 49, 100% con decimal real y 0 fallos.
    "Use exactly two decimal places, and let those decimals carry real precision rather than "
    "rounding to quarters or halves - e.g. 71.38, 84.61. "
    # El objetivo era a TRES meses mientras la nota es a uno y la cartera se rebalancea cada mes:
    # el "potencial" que se enseñaba en la web era de un horizonte que no existía en la decisión.
    # Ahora los tres coinciden. (El precio objetivo no lo pide el paper: es añadido nuestro, y
    # solo alimenta la pantalla — ni la selección ni los pesos lo miran.)
    # Del horizonte de los objetivos de analistas se enuncia el HECHO y no el método. "Do not
    # copy them" sobrecorregía y "those are longer-horizon" invitaba a la regla de tres (dividir
    # un +20% a doce meses entre doce y llamarlo análisis). Callarlo del todo tiene el riesgo
    # opuesto: que copie un objetivo a doce meses como si fuera a uno e infle el potencial que
    # se enseña en la web. Se dice qué son y se le deja decidir.
    "ALSO give your own approximate PRICE TARGET for the same one-month horizon as the score (a "
    "single number in the stock's trading currency), informed by the fundamentals and the analyst "
    "targets provided, which are published for longer horizons. If the news show "
    "the company is under a definitive cash acquisition offer, use the offer terms exactly as "
    "reported (do not derive per-share figures yourself) and do not set the price target above "
    "the cash offer price. "
    # `under_acquisition` se le pregunta EXPLÍCITAMENTE en vez de deducirlo del texto del informe:
    # buscar "adquisición" en la prosa no distingue quién compra de quién es comprado (una
    # aseguradora que ADQUIRÍA una unidad de negocio salía marcada igual que la empresa opada).
    # Medido con el caso real: el modelo acierta las dos direcciones cuando se le pregunta.
    "ALSO state whether THIS company is itself the TARGET of a definitive acquisition offer "
    "(someone is buying THIS company). It is false when this company is the one ACQUIRING "
    "another business. "
    'Respond ONLY in JSON: {"report": "...", "headline": "one-sentence thesis", '
    '"score": <number 1.00-100.00, two decimal places>, "target_price": <number>, '
    '"under_acquisition": <true|false>}. '
    "Write report and headline in Spanish."
)


PRESCORE_SYSTEM = (
    "You are the first-pass TRIAGE of an equity research pipeline. Your score answers ONE "
    "question: how likely is it that a rigorous deep fundamental analysis would find this company "
    "attractive for the next month? Weigh fundamentals, valuation and news TOGETHER. Do not raise "
    "or lower the score merely because of the company's sector or its size; ask whether the news "
    "changes the earnings power or the valuation case. "
    # La MISMA frase que el profundo, y por el mismo motivo (ver allí el detalle de lo medido):
    # son dos jueces del mismo nombre y si miden distinto, el corte de finalistas queda a medio
    # criterio. Lo que NO vuelve aquí tampoco es la prohibición sobre los técnicos.
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
    # El `headline` se pedía y NO lo consumía nadie: ni scan_service, ni la traza, ni la
    # watchlist (que solo acepta scores profundos), ni la web. Eran ~20 tokens de salida y un
    # cambio de idioma por llamada, en ~3.000 llamadas por escaneo y otra vez en la capa media.
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
        f"Company: {data.ticker} — sector {data.sector} / {data.industry}.\n"
        # "Macro & SECTOR outlook" era un resto de cuando el macro traía tilt sectorial: ahora el
        # prompt del macro le PROHÍBE nombrar sectores, así que la etiqueta prometía algo que no
        # existe y colaba la palabra "sector" como marco en cada llamada. El sector de ESTA empresa
        # sigue arriba, que es donde el paper lo pone.
        f"Macro outlook:\n{macro_block}\n\n"
        f"Latest fundamentals:\n{data.fundamentals_text}\n\n"
        f"Technical context: {data.technical_text or 'n/d'}\n"
        # Fecha de resultados como dato más del contexto, SIN regla de qué hacer con ella
        # (decisión pública del post de AXS: dato sí, instrucción no). Solo en el profundo.
        f"Earnings calendar: {data.earnings_text or 'n/d'}\n\n"
        f"Recent news:\n{news}\n"
        f"{prior}\n"
        "Write the investment report (JSON) and the 1.00-100.00 score."
    )


def _prescore_prompt(data: NameData, macro_block: str) -> str:
    # Todos los titulares, no solo los 3 primeros: el prescore decide quién llega al análisis
    # caro viendo un tercio de las noticias. En un escaneo real dio 100/100 a un nombre —el
    # único ≥90 de 2.594— y el profundo le puso 48 en cuanto vio la noticia que lo hundía (venta
    # de acciones por directivos), fuera del top-3. El triaje no es un profundo barato: es otro juez.
    news = "; ".join(data.news) if data.news else "none"
    name = f" ({data.name})" if data.name else ""
    # Las noticias van ANTES de los ~50 fundamentales, no detrás: el propio SYSTEM dice que se
    # pesen "TOGETHER", y quedaban enterradas tras cincuenta líneas de números.
    return (
        f"{data.ticker}{name} — {data.sector}/{data.industry}. Macro: {macro_block}\n"
        f"News: {news}\n"
        f"Fundamentals:\n{data.fundamentals_text}\n"
        f"Technical: {data.technical_text or 'n/d'}\n"
        "1.00-100.00 score (JSON)."
    )


_RAW_MAX = 1500          # se persiste en ScanRun.failures: unas decenas de KB al mes, nada


def _recorte(raw: str) -> str:
    """Respuesta cruda para el diagnóstico de un fallo: principio Y final.

    El principio dice si el modelo devolvió prosa en vez de JSON; el FINAL dice si se cortó a
    medias, que es la sospecha principal cuando un informe largo no parsea. Quedarse solo con
    la cabecera deja fuera justo la prueba que hace falta.
    """
    if len(raw) <= _RAW_MAX:
        return raw
    mitad = _RAW_MAX // 2
    return f"{raw[:mitad]}\n…[recortado {len(raw) - _RAW_MAX} chars]…\n{raw[-mitad:]}"


def prescore(llm: LLMProvider, data: NameData, macro_block: str, temperature: float = 0.4) -> PrescoreResult:
    """Ranking de primera pasada (modelo rápido/barato). Best-effort: 0 si falla, con `error`/
    `raw` para que el caller sepa POR QUÉ (transporte vs JSON roto) y decida si reintenta."""
    raw = ""
    try:
        raw = llm.chat(PRESCORE_SYSTEM, _prescore_prompt(data, macro_block),
                       temperature=temperature) or ""
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = max(0.0, min(100.0, round(float(obj.get("score", 0)), 2)))
        return PrescoreResult(data.ticker, sc)
    except Exception as exc:
        logger.warning("Prescore no parseable para %s (%s): %r", data.ticker, exc, raw[:400])
        return PrescoreResult(data.ticker, 0.0, error=f"{type(exc).__name__}: {exc}",
                              raw=_recorte(raw))


def score(
    llm: LLMProvider, data: NameData, macro_block: str, prior_thesis: str | None = None,
    temperature: float = 0.6,
) -> ScoreResult:
    """Puntúa un nombre. Best-effort: si el LLM falla/no parsea, score 0 (queda fuera), con
    `error`/`raw` para que el caller sepa POR QUÉ y decida si reintenta."""
    raw = ""
    try:
        raw = llm.chat(SYSTEM, _user_prompt(data, macro_block, prior_thesis),
                       temperature=temperature) or ""
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
        # Un 0 en una escala de 1 a 100 SOLO puede ser un fallo: el modelo devolvió JSON válido
        # sin nota (o con nota 0). Antes eso salía con `error=None`, así que el reintento —que
        # mira `error`— no se disparaba y el nombre se caía del ranking sin dejar rastro: tres
        # nombres se perdieron así en una prueba real, uno de ellos la mayor del universo.
        # Se marca como error Y se guarda la respuesta cruda, que es lo único que permite saber
        # después qué contestó de verdad.
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
