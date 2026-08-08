"""Tests del lote de cambios de prompts (5-ago): clausula anti-sesgo también en el scorer
profundo, prescore con todos los titulares + nombre de empresa, y outlook macro sin tilt
sectorial en el texto que se inyecta en cada scoring. Sin red, sin LLM real.
"""

from __future__ import annotations

from app.agents.scorer import PRESCORE_SYSTEM, SYSTEM, _prescore_prompt, _user_prompt
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
    """Profundo y prescore deben decir lo MISMO sobre sector y tamaño: son dos jueces del mismo
    nombre, y si uno penaliza por sector y el otro no, el corte queda a medio criterio."""
    for texto in (SYSTEM, PRESCORE_SYSTEM):
        bajo = texto.lower()
        assert "sector" in bajo
        assert "size" in bajo


def test_ningun_juez_prohibe_mirar_los_tecnicos() -> None:
    """El paper no menciona los técnicos en su prompt (pasa medias móviles y rango de 52 semanas
    entre otros 90 campos y se calla). Prohibir que decidan era invención nuestra."""
    for texto in (SYSTEM, PRESCORE_SYSTEM):
        bajo = texto.lower()
        assert "never a decision rule" not in bajo
        assert "rsi" not in bajo


def test_los_dos_jueces_dicen_lo_mismo_del_movimiento_de_precio() -> None:
    """Frase SIMÉTRICA y sin dirección, idéntica en los dos jueces. Medido sobre los 49 finalistas
    del 4-ago: la versión anterior ("no subas ni bajes por el precio") hacía su trabajo real en la
    dirección de bajada — quitarla costaba 13,7 puntos a las castigadas y solo 5,5 a las calientes.
    Esa protección es la estrategia (retroceso de un nombre fuerte), así que vuelve; lo que no
    vuelve es la parte que impedía descontar lo ya subido."""
    frase = ("A price move is not by itself a verdict in either direction: a fall does not make "
             "a business weak, nor does a rally make it strong.")
    for texto in (SYSTEM, PRESCORE_SYSTEM):
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
    macro = {
        "regime": "neutral", "vix": 15.0, "outlook": "Texto del outlook.",
        "favored_sectors": ["Technology"], "avoided_sectors": ["Energy"],
    }
    bloque = macro_mod.outlook_prompt_block(macro)
    assert "tailwind" not in bloque.lower()
    assert "headwind" not in bloque.lower()
    assert "Texto del outlook." in bloque


def test_el_scoring_recibe_el_vix_pero_no_la_etiqueta_de_regimen() -> None:
    """El VIX es un DATO (el paper mete datos: noticias, eventos, previsión de tipos). La etiqueta
    risk-on/neutral/risk-off es una conclusión NUESTRA con un umbral discutible, y repetirla en
    ~3.000 prompts la vuelve premisa. Se sigue calculando y guardando; deja de viajar al scorer."""
    bloque = macro_mod.outlook_prompt_block(
        {"regime": "risk-on", "vix": 14.9, "outlook": "Texto."})
    assert "14.9" in bloque
    for etiqueta in ("risk-on", "risk-off", "neutral", "Regime"):
        assert etiqueta not in bloque


def test_el_macro_no_le_pide_al_modelo_el_regimen() -> None:
    """El régimen sale de VIX + SPY vs MA200 (determinista y gratis). Si el prompt vuelve a
    pedírselo al LLM, este puede pisar ese dato con su lectura: llegó a decir "neutral" con el
    VIX en 14,9, valor que la propia regla determinista no permite."""
    bajo = macro_mod._SYSTEM.lower()
    assert "risk-on" not in bajo
    assert '"regime"' not in bajo


def test_el_macro_no_pide_ni_admite_tilt_sectorial() -> None:
    """No basta con prohibirle escribir sectores en el texto: si se le PIDE que elija sectores
    favorecidos/evitados, piensa en clave sectorial y se le escapan al outlook — que sí viaja a
    las ~3.000 llamadas de scoring. Se quita la pregunta, no solo la respuesta."""
    bajo = macro_mod._SYSTEM.lower()
    assert "favored_sectors" not in bajo
    assert "avoided_sectors" not in bajo
    assert "do not name sectors" in bajo


def test_el_snapshot_no_manda_retornos_por_sector() -> None:
    """El snapshot no lleva ranking sectorial de ningún tipo: era el último canal por el que una
    lectura de sectores llegaba a las ~3.000 llamadas de scoring (el macro la escribía en su
    texto, y ese texto se inyecta en todas). El paper tampoco se lo da a su agente macro."""
    import inspect

    # Sin comentarios: el porqué del cambio SÍ nombra los ETFs al explicarlo.
    codigo = "\n".join(linea for linea in inspect.getsource(macro_mod).splitlines()
                       if not linea.strip().startswith("#"))
    for etf in ("XLK", "XLF", "XLV", "XLE"):
        assert etf not in codigo
    assert not hasattr(macro_mod, "_SECTOR_ETFS")


def test_prescore_prompt_incluye_todos_los_titulares_y_el_nombre() -> None:
    titulares = [f"Titular {i}" for i in range(5)]
    data = _name_data(name="Acme Corp", news=titulares)
    prompt = _prescore_prompt(data, "Regime: neutral (VIX 15.0).")
    assert "Acme Corp" in prompt
    for titular in titulares:
        assert titular in prompt


def test_una_respuesta_nula_no_tumba_el_escaneo() -> None:
    """OpenRouter puede devolver `content: null` en una respuesta por lo demás válida (visto el
    8-ago con v4-pro). Antes eso hacía que el propio `except` del scorer petara al recortar la
    respuesta cruda — y como el scoring corre en un ThreadPoolExecutor, esa excepción se llevaba
    por delante el escaneo ENTERO. Una llamada mala debe costar un nombre, no el escaneo."""
    from app.agents import scorer as scorer_mod

    class LLMNulo:
        def chat(self, system: str, user: str, *, temperature: float = 0.3):
            return None

    data = _name_data()
    r = scorer_mod.score(LLMNulo(), data, "VIX 15.0.")
    assert r.score == 0 and r.error                      # cae como fallo, no como excepción
    p = scorer_mod.prescore(LLMNulo(), data, "VIX 15.0.")
    assert p.score == 0.0 and p.error


def test_el_macro_va_al_prompt_en_ingles_y_a_la_web_en_espanol() -> None:
    """El outlook viaja a ~3.000 prompts escritos en inglés: meter ahí un párrafo en español era
    la única costura de idioma del sistema. El modelo escribe los dos en la MISMA llamada; el
    inglés va al scoring y el español a la web y a la traza."""
    assert '"outlook_en"' in macro_mod._SYSTEM and '"outlook_es"' in macro_mod._SYSTEM
    bloque = macro_mod.outlook_prompt_block(
        {"vix": 14.9, "outlook": "Texto en español.", "outlook_en": "Text in English."})
    assert "Text in English." in bloque
    assert "español" not in bloque
    # Sin inglés (escaneos viejos, tests) cae al español: mejor idioma raro que macro vacío.
    solo_es = macro_mod.outlook_prompt_block({"vix": 14.9, "outlook": "Solo español."})
    assert "Solo español." in solo_es


def test_el_objetivo_de_precio_va_al_mismo_horizonte_que_la_nota() -> None:
    """El objetivo era a 3 meses mientras la nota es a 1 y la cartera se rebalancea cada mes: el
    "potencial" de la web salía de un horizonte que no existía en la decisión."""
    assert "for the same one-month horizon as the score" in SYSTEM
    assert "3-month PRICE TARGET" not in SYSTEM
    # Del horizonte de los objetivos de analistas se enuncia el HECHO, no el método: sin la nota
    # puede copiar un objetivo a doce meses como si fuera a uno; con "do not copy" o con
    # "longer-horizon" a secas, sobrecorrige o hace una regla de tres.
    assert "which are published for longer horizons" in SYSTEM
    for instruccion in ("do not copy", "scale", "divide"):
        assert instruccion not in SYSTEM.lower()


def test_la_nota_dice_contra_que_se_mide() -> None:
    """"Potential investment value" es literal del Exhibit 1 y se queda; lo que se añade es el
    referente. El paper puntúa empresas DEL S&P 500, así que en su montaje absoluto y relativo son
    lo mismo —el pool ES el índice—; en un universo de ~3.000 nombres se separan, y la misma
    empresa opada salía 55 en una tirada y 88,63 en la siguiente (el resto se movía 4,7 de media).
    "Beat the S&P 500" es además vocabulario del propio paper (Exhibit 2E)."""
    assert "potential investment value" in SYSTEM
    assert "outperform the S&P 500 over that month" in SYSTEM
    # Es un referente, no una dirección: no dice hacia dónde inclinarse. Con límite de palabra —
    # "buy" a pelo casa con el "someone is buying THIS company" del guardarraíl de opas, que es un
    # uso legítimo y no una recomendación.
    import re

    for palabra in ("buy", "sell", "bullish", "bearish", "overweight"):
        assert not re.search(rf"\b{palabra}\b", SYSTEM.lower())


def test_los_dos_jueces_piden_dos_decimales_con_la_misma_redaccion() -> None:
    """Motivo MEDIDO, no estético: con nota entera, sobre los 49 finalistas del 4-ago la nota de
    corte del top-10 fue 78 con DIEZ nombres empatados para CINCO plazas — o sea, el desempate por
    market cap (que el paper prevé como caso raro) decidió media selección, y entraron los cinco
    mayores dejando fuera a las cinco pequeñas por tamaño y solo por tamaño. Con dos decimales el
    desempate pasó a repartir una plaza. Los dos jueces con la misma granularidad para que sus
    rankings sean comparables."""
    frase = ("Use exactly two decimal places, and let those decimals carry real precision rather "
             "than rounding to quarters or halves")
    for texto in (SYSTEM, PRESCORE_SYSTEM):
        assert frase in texto
    # SUAVE a propósito: prohibirle los cuartos ("never end in .25") endureció el prompt y produjo
    # 3 respuestas degeneradas de 49. Con esta redacción: 0 fallos y 100% con decimal real.
    for duro in ("never", "must not", "forbidden"):
        assert duro not in SYSTEM.lower()
    assert "one decimal" not in PRESCORE_SYSTEM.lower()


def test_la_nota_conserva_los_dos_decimales_al_parsear() -> None:
    """El guardarraíl del cambio: `score` era int y `int(round(...))` tiraba el decimal justo antes
    del corte, que es donde hace falta. Si alguien lo revierte, este test cae."""
    from app.agents import scorer as scorer_mod

    class LLMDecimal:
        def __init__(self, nota: str) -> None:
            self.nota = nota

        def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
            return ('{"report": "r", "headline": "h", "score": ' + self.nota
                    + ', "target_price": 10.0, "under_acquisition": false}')

    r = scorer_mod.score(LLMDecimal("78.37"), _name_data(), "VIX 15.0.")
    assert r.score == 78.37
    p = scorer_mod.prescore(LLMDecimal("84.61"), _name_data(), "VIX 15.0.")
    assert p.score == 84.61


def test_el_decimal_manda_sobre_el_market_cap_en_la_seleccion() -> None:
    """Lo que los decimales compran, en una línea: antes 78,40 y 78,37 eran los dos "78" y ganaba
    el más grande. El desempate por market cap sigue ahí (es del paper), pero vuelve a ser lo que
    debía ser — un caso raro, no el selector."""
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
    """Literal del Exhibit 1 ("Do not mention the word 'provided' instead use 'recent' or
    'latest'") y era la única línea del prompt del paper que nos faltaba."""
    assert "do not describe the data as 'provided'" in SYSTEM.lower()
    assert "recent or latest" in SYSTEM.lower()


def test_ningun_prompt_promete_un_outlook_sectorial() -> None:
    """"Macro & sector outlook" era un resto de cuando el macro traía tilt sectorial: hoy el macro
    tiene PROHIBIDO nombrar sectores, así que la etiqueta anunciaba algo que no llega y colaba la
    palabra "sector" como marco en cada llamada. El sector de ESTA empresa sigue en su línea."""
    from app.agents.constructor import _user_prompt as constructor_prompt

    scorer_user = _user_prompt(_name_data(), "VIX 15.0.", None)
    constructor_user = constructor_prompt("cartera", "candidatos", "VIX 15.0.")
    for prompt in (scorer_user, constructor_user):
        assert "sector outlook" not in prompt.lower()
        assert "Macro outlook:" in prompt
    assert "sector Technology" in scorer_user       # el de la empresa, que sí es del paper


def test_el_macro_mira_al_proximo_mes_y_a_los_aranceles() -> None:
    """Dos literales del Exhibit 2D que faltaban. "Pay special attention to the next month" importa
    porque TODO lo que decide el sistema es a un mes (nota, objetivo, rebalanceo) y el macro era el
    único eslabón que miraba a tres sin distinguir el tramo que decide. `tariffs` está en su tabla
    de previsiones junto a tipos e inflación: se pedían los dos primeros y no el tercero."""
    bajo = macro_mod._SYSTEM.lower()
    assert "pay special attention to the next month" in bajo
    assert "tariffs" in bajo
    assert "interest rates" in bajo and "inflation" in bajo


def test_el_macro_da_su_prevision_pero_comparada_con_el_mercado() -> None:
    """El 7-ago se quitó "give your own view" por sesgo; era paper (2D: "Not only what analysts and
    the market expect") y quitarla entera fue pasarse. Vuelve con las dos correcciones que le
    faltaban: acotada al PRONÓSTICO —no a qué partes del mercado favorecer, que sigue prohibido— y
    con el contrapeso que el paper sí tiene: *comparar* con lo que espera el mercado. Pedir un
    diferencial obliga a enunciar las dos cifras; pedir "tu opinión" a secas, no."""
    bajo = macro_mod._SYSTEM.lower()
    assert "not only what analysts and the market expect" in bajo
    assert "say where the two differ" in bajo
    # Y sigue sin poder hablar de sectores ni de qué favorecer: el motivo del cambio del 7-ago
    # sigue en pie, solo se acota el alcance de la opinión propia.
    assert "do not name sectors" in bajo
    assert "favour" in bajo and "would favour or avoid" in bajo


def test_el_scoring_recibe_los_niveles_de_mercado_como_dato() -> None:
    """El fallo que lo motivó (8-ago): el scorer puso un 78,43 a una minera de oro con la tesis
    "con el oro en máximos" **sin un solo dato de oro en su prompt** — el bloque macro no contenía
    la palabra gold, y el único dato de oro del sistema (que se quedaba en el agente macro) decía
    que caía un 7,7% a tres meses. El oro estaba a un 18% de su máximo. Con el 25% de la cartera
    encima. Lo que el modelo no recibe se lo inventa de memoria."""
    bloque = macro_mod.outlook_prompt_block({
        "vix": 14.9, "outlook_en": "Text.",
        "market_line": "Gold 4,341 (18% below 52w high, +5% 1m). Oil (WTI) 78.18 (31% below "
                       "52w high, +8% 1m)",
    })
    assert "Gold 4,341" in bloque and "18% below 52w high" in bloque
    assert "14.9" in bloque and "Text." in bloque
    # Son NIVELES y distancias, no adjetivos: nada de "fuerte", "débil", "sobrecomprado".
    for juicio in ("strong", "weak", "overbought", "oversold", "elevated", "cheap"):
        assert juicio not in bloque.lower()
    # Un escaneo viejo (sin la clave) tiene que dar el bloque EXACTAMENTE como antes.
    viejo = macro_mod.outlook_prompt_block({"vix": 14.9, "outlook_en": "Text."})
    assert viejo == "VIX 14.9.\nText."


def test_el_snapshot_usa_subyacentes_y_no_etfs() -> None:
    """Un NIVEL de GLD (398) no es el precio del oro (4.341): dárselo invita a la confusión que
    esto viene a evitar. Y en el petróleo el ETF ni acierta el porcentaje — USO daba -12,6% a 3m
    con el WTI en -17,5%, y 23% desde máximos cuando el real era 31% (erosión por roll). Ese
    -12,6% es el que vio el macro del test del 8-ago y le hizo escribir "la reciente caída del
    petróleo" con el barril subiendo un 8,5% en el mes."""
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
    """El modelo puede devolver JSON perfectamente formado y sin `score`. Antes eso salía con
    `error=None`: el reintento —que mira `error`— no se disparaba y el nombre desaparecía del
    ranking sin rastro. En la prueba del 8-ago se perdieron tres así, uno la mayor del universo.
    Un 0 en una escala de 1 a 100 solo puede ser un fallo."""
    from app.agents import scorer as scorer_mod

    class LLMSinNota:
        def __init__(self) -> None:
            self.veces = 0

        def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
            self.veces += 1
            return '{"report": "informe largo", "headline": "tesis", "target_price": 10.0}'

    llm = LLMSinNota()
    r = scorer_mod.score(llm, _name_data(), "VIX 15.0.")
    assert r.score == 0
    assert r.error and "SinNota" in r.error      # marcado: el caller reintentará
    assert r.raw                                  # y con la respuesta cruda para diagnosticarlo
