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


MID_SYSTEM = (
    "You are the SECOND-OPINION triage of an equity research pipeline, reviewing companies that "
    "a cheaper first pass already ranked highly. Your score answers ONE question: how likely is "
    "it that a rigorous deep fundamental analysis would find this company attractive for the next "
    "month? Weigh fundamentals, valuation and news TOGETHER. Do not raise "
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
        f"{data.ticker}{name} — {data.sector}/{data.industry}. Macro: {macro_block}\n"
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
    """Respuesta cruda para el diagnóstico de un fallo: principio Y final.

    El principio dice si el modelo devolvió prosa en vez de JSON; el FINAL dice si se cortó a
    medias, que es la sospecha principal cuando un informe largo no parsea. Quedarse solo con
    la cabecera deja fuera justo la prueba que hace falta.
    """
    if len(raw) <= _RAW_MAX:
        return raw
    mitad = _RAW_MAX // 2
    return f"{raw[:mitad]}\n…[recortado {len(raw) - _RAW_MAX} chars]…\n{raw[-mitad:]}"


def mid_prescore(
    llm: LLMProvider, data: NameData, macro_block: str, temperature: float = 0.4,
) -> PrescoreResult:
    """Segunda opinión de la capa media (modelo mejor que el triaje barato, 1 ticker por
    llamada). Best-effort: 0 si falla, con `error`/`raw` para que el caller sepa POR QUÉ
    (transporte vs JSON roto) y decida si reintenta."""
    raw = ""
    try:
        raw = llm.chat(MID_SYSTEM, _mid_prompt(data, macro_block),
                       temperature=temperature) or ""
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = max(0.0, min(100.0, round(float(obj.get("score", 0)), 2)))
        # Mismo guardarraíl que `score()` (ver su comentario): en una escala de 1 a 100, un 0
        # SOLO puede ser un fallo de parseo (JSON válido sin la clave, o con nota 0). Sin esto
        # `error` quedaba en None y el nombre desaparecía del embudo entero sin retry ni rastro
        # — medido en un escaneo real: 118 de 3.000 nombres así, ninguno en `failed` ni en
        # `pre_errors`, invisibles en la auditoría.
        if sc <= 0:
            return PrescoreResult(data.ticker, 0.0,
                                  error="SinNota: JSON válido sin score utilizable",
                                  raw=_recorte(raw))
        return PrescoreResult(data.ticker, sc)
    except Exception as exc:
        logger.warning("Capa media no parseable para %s (%s): %r", data.ticker, exc, raw[:400])
        return PrescoreResult(data.ticker, 0.0, error=f"{type(exc).__name__}: {exc}",
                              raw=_recorte(raw))


# ---------------------------------------------------------------------------------------------
# Pre-score por LOTES — triaje barato del universo, agrupando N tickers en una sola llamada.
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
    "sector color your judgment of another. Do not raise or lower a score merely because of a "
    "company's sector or its size; ask whether the news changes the earnings power or the "
    "valuation case. A price move is not by itself a verdict in either direction: a fall does "
    "not make a business weak, nor does a rally make it strong. Calibrate the scale: 90+ "
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
    """True si ≥90% de las notas de un lote comparten el mismo patrón de UN SOLO decimal
    (segundo decimal en cero) — estadísticamente casi imposible por azar si son notas de dos
    decimales genuinas e independientes (≈10^-20 para 20/20). Medido en vivo: pasó en
    1 de 2 lotes de prueba (20/20 con un solo decimal), justo el apelmazamiento que la migración
    a dos decimales se hizo para evitar. Con menos de 5 notas el argumento estadístico no aplica."""
    if len(notas) < 5:
        return False
    un_decimal = sum(1 for n in notas if round(n * 100) % 10 == 0)
    return un_decimal / len(notas) >= 0.9


def prescore_batch(
    llm: LLMProvider, items: list[NameData], macro_block: str, temperature: float = 0.4,
) -> dict[str, PrescoreResult]:
    """Prescore de un LOTE en una sola llamada. Devuelve {ticker: PrescoreResult}.

    A diferencia de `mid_prescore()`/`score()`, el reintento vive AQUÍ DENTRO (hasta 2 extra, 3
    intentos totales — mismo criterio que el resto) en vez de en el caller: la decisión de
    reintentar depende de mirar el LOTE entero (JSON roto, tickers ausentes, formato degenerado),
    no del error de un ticker suelto, así que no encaja en el patrón externo
    `for _ in range(2): if not r.error: break` que usan las otras dos funciones. Si un ticker
    concreto falta en una respuesta por lo demás válida, NO se reintenta el lote completo —
    tirar 19 notas buenas por 1 ausente sale más caro que dejar esa sola con error.
    """
    wanted = {d.ticker for d in items}
    user = _prescore_batch_prompt(items, macro_block)
    raw = ""
    notas: dict[str, float] = {}
    for intento in range(3):
        try:
            raw = llm.chat(PRESCORE_BATCH_SYSTEM, user, temperature=temperature) or ""
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
            break
        except Exception as exc:
            logger.warning("Prescore por lote (%d empresas) intento %d/3 falló: %s (%r)",
                           len(items), intento + 1, exc, raw[:400])
            notas = {}
    if not notas:
        return {t: PrescoreResult(t, 0.0, error="lote no parseable/degenerado tras 3 intentos",
                                  raw=_recorte(raw)) for t in wanted}

    out: dict[str, PrescoreResult] = {}
    for t in wanted:
        if t not in notas:
            out[t] = PrescoreResult(t, 0.0, error="ausente de la respuesta del lote")
        elif notas[t] <= 0:
            out[t] = PrescoreResult(t, 0.0, error="SinNota: score no utilizable en el lote")
        else:
            out[t] = PrescoreResult(t, notas[t])
    return out


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
