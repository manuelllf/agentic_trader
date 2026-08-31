"""Tests para neutralidad de prompts (anti-sesgo en scorer, prescore con noticias/nombre).

Sin red, sin LLM real."""

from __future__ import annotations

from app.agents.scorer import (
    MID_SYSTEM,
    PRESCORE_BATCH_SYSTEM,
    PRESCORE_SYSTEM,
    SYSTEM,
    _mid_prompt,
    _user_prompt,
)
from app import portfolio_service as portfolio
from app.screener import macro as macro_mod
from app.screener.fundamentals import NameData


def _name_data(**kwargs) -> NameData:
    base = dict(
        ticker="AAA", sector="Technology", industry="Software", price=10.0,
        fundamentals_text="- EPS: 1.0", technical_text="price $10",
    )
    base.update(kwargs)
    return NameData(**base)


def test_los_dos_jueces_cubren_sector_y_tamano() -> None:
    """Anti-bias clause removed from all scoring levels (not in paper, our precaution)."""
    for texto in (SYSTEM, MID_SYSTEM, PRESCORE_SYSTEM, PRESCORE_BATCH_SYSTEM):
        assert "do not raise or lower" not in texto.lower()


def test_ningun_juez_prohibe_mirar_los_tecnicos() -> None:
    """Paper passes technical data (MA, 52w range) but never prescribes its use."""
    for texto in (SYSTEM, MID_SYSTEM):
        bajo = texto.lower()
        assert "never a decision rule" not in bajo
        assert "rsi" not in bajo


def test_las_cinco_etapas_dicen_lo_mismo_del_movimiento_de_precio() -> None:
    """Price-move clause in ALL five prompts; measured to protect fallen names."""
    from app.agents.constructor import SYSTEM as CONSTRUCTOR_SYSTEM

    frase = ("A price move is not by itself a verdict in either direction: a fall does not make "
             "a business weak, nor does a rally make it strong.")
    for texto in (SYSTEM, MID_SYSTEM, PRESCORE_SYSTEM, PRESCORE_BATCH_SYSTEM,
                  CONSTRUCTOR_SYSTEM):
        assert frase in texto
    # Sin dirección: nada que diga qué HACER con el movimiento, solo qué no concluir.
    for palabra in ("penalise", "penalize", "discount the score", "reduce the score"):
        assert palabra not in SYSTEM.lower()


def test_clausula_nueva_del_profundo_sin_palabras_direccionales() -> None:
    """Misma regla que test_macro_memory.py: cero palabras que empujen la tesis en una dirección."""
    bajo = SYSTEM.lower()
    for palabra in ("confirm", "maintain", "consistent", "revise", "prefer", "avoid"):
        assert palabra not in bajo


def test_outlook_prompt_block_sin_tailwind_headwind_con_outlook() -> None:
    """Outlook block excludes directional labels (tailwind/headwind)."""
    macro = {
        "regime": "neutral", "vix": 15.0, "outlook": "Texto del outlook.",
        "favored_sectors": ["Technology"], "avoided_sectors": ["Energy"],
    }
    bloque = macro_mod.outlook_prompt_block(macro)
    assert "tailwind" not in bloque.lower()
    assert "headwind" not in bloque.lower()
    assert "Texto del outlook." in bloque


def test_el_scoring_recibe_el_vix_pero_no_la_etiqueta_de_regimen() -> None:
    """VIX is data; regime label is our conclusion, not sent to scorer."""
    bloque = macro_mod.outlook_prompt_block(
        {"regime": "risk-on", "vix": 14.9, "outlook": "Texto."})
    assert "14.9" in bloque
    for etiqueta in ("risk-on", "risk-off", "neutral", "Regime"):
        assert etiqueta not in bloque


def test_el_macro_no_le_pide_al_modelo_el_regimen() -> None:
    """Regime is deterministic (VIX + MA200); not asked of model."""
    bajo = macro_mod._SYSTEM.lower()
    assert "risk-on" not in bajo
    assert '"regime"' not in bajo


def test_el_macro_no_pide_ni_admite_tilt_sectorial() -> None:
    """Removes sector question, not just response; blocks sectoral thinking."""
    bajo = macro_mod._SYSTEM.lower()
    assert "favored_sectors" not in bajo
    assert "avoided_sectors" not in bajo
    assert "do not name sectors" in bajo


def test_el_snapshot_no_manda_retornos_por_sector() -> None:
    """Snapshot excludes sector rankings; blocks last channel for sectoral bias."""
    import inspect

    # Sin comentarios: el porqué del cambio SÍ nombra los ETFs al explicarlo.
    codigo = "\n".join(linea for linea in inspect.getsource(macro_mod).splitlines()
                       if not linea.strip().startswith("#"))
    for etf in ("XLK", "XLF", "XLV", "XLE"):
        assert etf not in codigo
    assert not hasattr(macro_mod, "_SECTOR_ETFS")


def test_mid_prompt_incluye_todos_los_titulares_y_el_nombre() -> None:
    titulares = [f"Titular {i}" for i in range(5)]
    data = _name_data(name="Acme Corp", news=titulares)
    prompt = _mid_prompt(data, "Regime: neutral (VIX 15.0).")
    assert "Acme Corp" in prompt
    for titular in titulares:
        assert titular in prompt


def test_una_respuesta_nula_no_tumba_el_escaneo() -> None:
    """Null content in LLM response; one ticker fails, not entire scan."""
    from app.agents import scorer as scorer_mod

    class LLMNulo:
        def chat(self, system: str, user: str, *, temperature: float = 0.3,
                top_p: float | None = None):
            return None

    data = _name_data()
    r = scorer_mod.score(LLMNulo(), data, "VIX 15.0.")
    assert r.score == 0 and r.error                      # cae como fallo, no como excepción
    p = scorer_mod.mid_prescore(LLMNulo(), data, "VIX 15.0.")
    assert p.score == 0.0 and p.error


def test_el_macro_va_al_prompt_en_ingles_y_a_la_web_en_espanol() -> None:
    """Outlook in English to scorer; Spanish version for web/trace."""
    assert '"outlook_en"' in macro_mod._SYSTEM and '"outlook_es"' in macro_mod._SYSTEM
    bloque = macro_mod.outlook_prompt_block(
        {"vix": 14.9, "outlook": "Texto en español.", "outlook_en": "Text in English."})
    assert "Text in English." in bloque
    assert "español" not in bloque
    # Sin inglés (escaneos viejos, tests) cae al español: mejor idioma raro que macro vacío.
    solo_es = macro_mod.outlook_prompt_block({"vix": 14.9, "outlook": "Solo español."})
    assert "Solo español." in solo_es


def test_el_profundo_ya_no_pide_precio_objetivo() -> None:
    """target_price sin respaldo en el paper — quitado del todo (28-ago)."""
    assert "PRICE TARGET" not in SYSTEM
    assert "target_price" not in SYSTEM
    assert "analyst" not in SYSTEM.lower()


def test_la_nota_dice_contra_que_se_mide() -> None:
    """Score = literal del Exhibit 1 (potential investment value), sin S&P 500 ni dirección."""
    assert "potential investment value" in SYSTEM
    # "Beat the S&P 500" es del Exhibit 2E (constructor), no del Exhibit 1 — el profundo ya
    # no lo lleva (28-ago, verificado contra el PDF del paper).
    assert "S&P 500" not in SYSTEM
    # Es un referente, no una dirección: no dice hacia dónde inclinarse. Con límite de palabra —
    # "buy" a pelo casa con el "someone is buying THIS company" del guardarraíl de opas, que es un
    # uso legítimo y no una recomendación.
    import re

    for palabra in ("buy", "sell", "bullish", "bearish", "overweight"):
        assert not re.search(rf"\b{palabra}\b", SYSTEM.lower())


def test_beat_sp500_solo_vive_en_el_constructor() -> None:
    """Exhibit 2E lo pide para la cartera, Exhibit 1 no lo pide para el score individual."""
    from app.agents.constructor import SYSTEM as CONSTRUCTOR_SYSTEM

    assert "S&P 500" not in SYSTEM
    assert "S&P 500" not in MID_SYSTEM
    assert "S&P 500" not in PRESCORE_SYSTEM
    assert "S&P 500" in CONSTRUCTOR_SYSTEM


def test_prescore_y_capa_media_hacen_la_misma_pregunta() -> None:
    """Sin driver, PRESCORE_SYSTEM y MID_SYSTEM son literalmente el mismo texto — la única
    diferencia real entre las dos etapas es el modelo, no la pregunta."""
    assert PRESCORE_SYSTEM == MID_SYSTEM


def test_los_dos_jueces_piden_nota_entera_con_la_misma_redaccion() -> None:
    """Whole number score, sin ejemplos; los decimales eran precisión de mentira. El aviso de
    "no colapses en múltiplos de 5" se quitó después -- se convirtió en ruido de formato que el
    modelo resolvía al final en vez de dejar que el análisis decidiera (auditoría escaneo 54)."""
    frase = "Give the score as a whole number."
    for texto in (SYSTEM, MID_SYSTEM):
        assert frase in texto
    assert "multiple of five" not in SYSTEM.lower()
    for duro in ("never", "must not", "forbidden"):
        assert duro not in SYSTEM.lower()
    assert "decimal" not in SYSTEM.lower()
    assert "decimal" not in MID_SYSTEM.lower()


def test_la_nota_se_redondea_a_entero_al_parsear() -> None:
    """El modelo puede seguir devolviendo un decimal (no lo pedimos, pero puede colarse);
    se redondea a entero al parsear, no se guarda tal cual."""
    from app.agents import scorer as scorer_mod

    class LLMDecimal:
        def __init__(self, nota: str) -> None:
            self.nota = nota

        def chat(self, system: str, user: str, *, temperature: float = 0.3,
                top_p: float | None = None) -> str:
            return ('{"report": "r", "headline": "h", "score": ' + self.nota
                    + ', "target_price": 10.0, "under_acquisition": false}')

    r = scorer_mod.score(LLMDecimal("78.37"), _name_data(), "VIX 15.0.")
    assert r.score == 78.0
    p = scorer_mod.mid_prescore(LLMDecimal("84.61"), _name_data(), "VIX 15.0.")
    assert p.score == 85.0


def test_el_decimal_manda_sobre_el_market_cap_en_la_seleccion() -> None:
    """Decimal precision takes priority; market-cap tiebreaker per paper."""
    from app.portfolio_service import select_top

    class Fila:
        def __init__(self, ticker: str, score: float) -> None:
            self.ticker, self.score = ticker, score

    filas = [Fila("PEQUE", 78.40), Fila("GIGANTE", 78.37)]
    mcap = {"PEQUE": 1e9, "GIGANTE": 3e12}
    assert [r.ticker for r in select_top(filas, mcap, 0, 1)] == ["PEQUE"]
    # Con la nota igual, el desempate por tamaño sigue vigente (fiel al paper).
    empate = [Fila("PEQUE", 78.40), Fila("GIGANTE", 78.40)]
    assert [r.ticker for r in select_top(empate, mcap, 0, 1)] == ["GIGANTE"]


def test_el_scorer_no_llama_provided_a_los_datos() -> None:
    """Paper Exhibit 1: use 'recent/latest', not 'provided'."""
    assert "do not describe the data as 'provided'" in SYSTEM.lower()
    assert "recent or latest" in SYSTEM.lower()


def test_ningun_prompt_promete_un_outlook_sectorial() -> None:
    """No "sector outlook" label; individual company sectors still appear."""
    from app.agents.constructor import _user_prompt as constructor_prompt

    scorer_user = _user_prompt(_name_data(), "VIX 15.0.", None)
    constructor_user = constructor_prompt("candidatos", "VIX 15.0.")
    for prompt in (scorer_user, constructor_user):
        assert "sector outlook" not in prompt.lower()
        assert "Macro outlook:" in prompt
    assert "sector Technology" in scorer_user       # el de la empresa, que sí es del paper


def test_el_macro_mira_al_proximo_mes_y_a_los_aranceles() -> None:
    """Paper Exhibit 2D: one-month focus; includes tariffs forecasting."""
    bajo = macro_mod._SYSTEM.lower()
    assert "pay special attention to the next month" in bajo
    assert "tariffs" in bajo
    assert "interest rates" in bajo and "inflation" in bajo


def test_el_macro_da_su_prevision_pero_comparada_con_el_mercado() -> None:
    """Model opinion on forecasts vs. market expectations (not sector favoring). "Say where they
    differ" pasó a "compare + if they match, say they match": obliga a enunciar las dos cifras
    en vez de un diferencial suelto, y a no inventar la del mercado si no está en los datos."""
    bajo = macro_mod._SYSTEM.lower()
    assert "not only what analysts and the market expect" in bajo
    assert "compare your forecasts with the market" in bajo
    assert "write 'unknown'" in bajo
    # Sigue sin poder hablar de sectores ni de qué favorecer: solo se acota el alcance de la
    # opinión propia.
    assert "do not name sectors" in bajo
    assert "favour" in bajo and "would favour or avoid" in bajo


def test_el_scoring_recibe_los_niveles_de_mercado_como_dato() -> None:
    """Market levels (not ETF proxies) sent to scorer; prevents hallucination."""
    bloque = macro_mod.outlook_prompt_block({
        "vix": 14.9, "outlook_en": "Text.",
        "market_line": "Gold 4,341 (+5% 1m). Oil (WTI) 78.18 (+8% 1m)",
    })
    assert "Gold 4,341" in bloque
    assert "14.9" in bloque and "Text." in bloque
    # Son NIVELES, no adjetivos ni distancia a máximos (eso es momentum, no dato de régimen).
    for juicio in ("strong", "weak", "overbought", "oversold", "elevated", "cheap",
                  "below 52w high", "del máximo de 52s"):
        assert juicio not in bloque.lower()
    # Un escaneo viejo (sin la clave) tiene que dar el bloque EXACTAMENTE como antes.
    viejo = macro_mod.outlook_prompt_block({"vix": 14.9, "outlook_en": "Text."})
    assert viejo == "VIX 14.9.\nText."


def test_el_snapshot_usa_subyacentes_y_no_etfs() -> None:
    """Futures (GC=F, CL=F) not ETF proxies (GLD, USO); avoids roll errors."""
    import inspect

    codigo = "\n".join(linea for linea in inspect.getsource(macro_mod._snapshot_text).splitlines()
                       if not linea.strip().startswith("#"))
    for subyacente in ("GC=F", "CL=F", "DX-Y.NYB"):
        assert subyacente in codigo
    for proxy in ('"GLD"', '"USO"', '"UUP"'):
        assert proxy not in codigo
    # HYG se queda (no hay índice de crédito gratis) pero SIN nivel y etiquetado como ETF.
    assert "HYG ETF" in codigo


def test_un_json_valido_sin_nota_cuenta_como_fallo_y_se_reintenta() -> None:
    """Valid JSON without score is a retry trigger; prevents silent dropouts."""
    from app.agents import scorer as scorer_mod

    class LLMSinNota:
        def __init__(self) -> None:
            self.veces = 0

        def chat(self, system: str, user: str, *, temperature: float = 0.3,
                top_p: float | None = None) -> str:
            self.veces += 1
            return '{"report": "informe largo", "headline": "tesis", "target_price": 10.0}'

    llm = LLMSinNota()
    r = scorer_mod.score(llm, _name_data(), "VIX 15.0.")
    assert r.score == 0
    assert r.error and "SinNota" in r.error      # marcado: el caller reintentará
    assert r.raw                                  # y con la respuesta cruda para diagnosticarlo


def test_candidates_text_no_ancla_al_orden_de_score() -> None:
    """Sin score en el texto y con el orden barajado — medido que con score-primero-y-ordenado
    el constructor colapsaba a fondear el top-N literal."""
    from dataclasses import dataclass

    @dataclass
    class R:
        ticker: str
        score: float
        report: str

    seleccionados = [R(f"TK{i}", 90.0 - i, f"informe {i}") for i in range(8)]
    sectores = {r.ticker: "Technology" for r in seleccionados}
    texto = portfolio.candidates_text(seleccionados, sectores, {})

    bloques = texto.split("\n\n")
    assert len(bloques) == len(seleccionados)
    orden_presentado = [b.split(" ", 1)[0] for b in bloques]
    assert orden_presentado != [r.ticker for r in seleccionados]  # no es el orden de score
    for r in seleccionados:
        assert str(r.score) not in texto  # el score no viaja al constructor

    # Reproducible: misma entrada, mismo orden.
    otro = portfolio.candidates_text(list(seleccionados), sectores, {})
    assert otro == texto
