"""Tests del ranker fundamental (scorer, constructor, watchlist, muestreo) con LLM falso."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app import watchlist as wl
from app.agents import constructor as constructor_mod
from app.agents import scorer as scorer_mod
from app.db import Base
from app.models import Watchlist
from app.screener import universe as universe_mod
from app.screener.fundamentals import NameData


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


class FakeLLM:
    def __init__(self, reply: str) -> None:
        self._reply = reply

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        return self._reply


def _name(ticker: str = "AAA") -> NameData:
    return NameData(ticker=ticker, sector="Technology", industry="Software",
                    price=100.0, fundamentals_text="- P/E: 20", technical_text="RSI 55", news=[])


# ---- scorer ----

def test_scorer_parses_and_clamps() -> None:
    llm = FakeLLM('{"report": "informe", "headline": "tesis fuerte", "score": 88}')
    r = scorer_mod.score(llm, _name(), "macro n/d")
    assert r.score == 88 and r.headline == "tesis fuerte" and r.report == "informe"

    over = FakeLLM('{"report": "x", "headline": "y", "score": 150}')
    assert scorer_mod.score(over, _name(), "m").score == 100  # recorta a 100


def test_scorer_bad_json_is_zero() -> None:
    r = scorer_mod.score(FakeLLM("no soy json"), _name(), "m")
    assert r.score == 0  # queda fuera del embudo


# ---- fecha de resultados (dato del contexto del profundo; decisión pública: dato sí, regla no)

def test_earnings_text_fecha_ventana_y_pasado() -> None:
    from app.screener import fundamentals as fund_mod

    hoy = datetime.now(UTC)
    en_10d = (hoy + timedelta(days=10)).timestamp()
    en_12d = (hoy + timedelta(days=12)).timestamp()

    # Fecha única confirmada y futura.
    txt = fund_mod._earnings_text(
        {"earningsTimestampStart": en_10d, "earningsTimestampEnd": en_10d})
    assert txt.startswith("next earnings report: ") and "unconfirmed" not in txt

    # Ventana estimada → se declara la estimación, no se vende como confirmada.
    txt = fund_mod._earnings_text(
        {"earningsTimestampStart": en_10d, "earningsTimestampEnd": en_12d,
         "isEarningsDateEstimate": True})
    assert " to " in txt and "estimated (unconfirmed)" in txt

    # Recién publicados (yfinance tarda días en apuntar al siguiente trimestre): se etiqueta
    # como "last" en vez de ocultarse — que acaba de reportar también es dato.
    hace_5d = (hoy - timedelta(days=5)).timestamp()
    assert fund_mod._earnings_text({"earningsTimestampStart": hace_5d}).startswith("last earnings")

    assert fund_mod._earnings_text({}) == ""           # sin dato → el prompt pinta n/d


def test_earnings_entra_al_profundo_y_no_al_prescore() -> None:
    data = _name()
    data.earnings_text = "next earnings report: 2026-08-12"
    assert "Earnings calendar: next earnings report: 2026-08-12" in (
        scorer_mod._user_prompt(data, "macro", None))
    assert "Earnings calendar" not in scorer_mod._prescore_prompt(data, "macro")

    data.earnings_text = ""
    assert "Earnings calendar: n/d" in scorer_mod._user_prompt(data, "macro", None)


# ---- constructor ----

def test_constructor_enforces_rules() -> None:
    reply = (
        '{"cash_pct": 0, "positions": ['
        '{"ticker": "AAA", "weight_pct": 60, "thesis": "t", "edge": "e", "risk": "r"},'  # >35 → 35
        '{"ticker": "BBB", "weight_pct": 30, "thesis": "t", "edge": "e", "risk": "r"},'
        '{"ticker": "CCC", "weight_pct": 20, "thesis": "t", "edge": "e", "risk": "r"},'
        '{"ticker": "DDD", "weight_pct": 20, "thesis": "t", "edge": "e", "risk": "r"},'
        '{"ticker": "EEE", "weight_pct": 20, "thesis": "t", "edge": "e", "risk": "r"},'  # 5ª → fuera (max 4)
        '{"ticker": "ZZZ", "weight_pct": 10, "thesis": "t", "edge": "e", "risk": "r"}'   # no puntuada → fuera
        '], "summary": "s"}'
    )
    valid = {"AAA", "BBB", "CCC", "DDD", "EEE"}  # ZZZ no está
    res = constructor_mod.construct(FakeLLM(reply), "cartera", "candidatos", "macro",
                                    max_positions=4, max_position_pct=35.0, valid_tickers=valid)
    assert len(res.positions) == 4                       # tope de 4
    assert all(p.weight_pct <= 35.0 for p in res.positions)  # tope 35%
    assert "ZZZ" not in {p.ticker for p in res.positions}    # anti-alucinación
    # 35+30+20+20 = 105 > 100 → renormaliza, cash 0.
    assert abs(sum(p.weight_pct for p in res.positions) - 100.0) < 0.1
    assert res.cash_pct == 0.0


def test_constructor_bad_json_all_cash() -> None:
    res = constructor_mod.construct(FakeLLM("nope"), "c", "c", "m", 4, 35.0, {"AAA"})
    assert res.positions == [] and res.cash_pct == 100.0


def test_constructor_allows_ucits_instrument() -> None:
    # Un instrumento UCITS (símbolo con '.') sobrevive el filtro si está en valid_tickers.
    reply = ('{"cash_pct": 0, "positions": ['
             '{"ticker": "CSPX.L", "weight_pct": 40, "thesis": "t", "edge": "e", "risk": "r"},'
             '{"ticker": "AAA", "weight_pct": 30, "thesis": "t", "edge": "e", "risk": "r"}'
             '], "summary": "s"}')
    res = constructor_mod.construct(FakeLLM(reply), "cartera", "candidatos", "macro",
                                    max_positions=5, max_position_pct=35.0,
                                    valid_tickers={"AAA", "CSPX.L"})
    assert {"CSPX.L", "AAA"} == {p.ticker for p in res.positions}


# ---- instrumentos UCITS (menú opcional para el constructor) ----

def test_instruments_prompt_block(monkeypatch) -> None:
    from app import instruments
    monkeypatch.setattr(instruments, "ALLOWLIST", {"CSPX.L": "S&P 500 UCITS", "IB01.L": "T-bills"})
    assert instruments.prompt_block({}) == ""                       # nada disponible → sin bloque
    block = instruments.prompt_block({"CSPX.L": 800.0})
    assert "CSPX.L" in block and "S&P 500 UCITS" in block and "IB01.L" not in block


# ---- watchlist ----

def test_watchlist_entry_and_eviction(db) -> None:
    wl.update(db, [("AAA", 90, "alta conviccion"), ("BBB", 50, "flojo")])
    assert wl.tickers(db) == ["AAA"]                       # solo >=85 entra
    assert wl.thesis_for(db, "AAA") == "alta conviccion"

    wl.update(db, [("AAA", 65, "cayo")])                   # <70 → sale
    assert wl.tickers(db) == []


def test_watchlist_staleness(db) -> None:
    old = datetime.now(UTC) - timedelta(days=40)
    db.add(Watchlist(ticker="OLD", score=88, thesis="t", first_seen=old, last_seen=old, last_high=old))
    db.commit()
    wl.update(db, [("OLD", 78, "sigue ok")])  # 78: sobre evict pero bajo entry → last_high NO se refresca
    assert wl.tickers(db) == []               # caduca por antigüedad (>28d sin puntuar alto)


def test_watchlist_cap(db, monkeypatch) -> None:
    monkeypatch.setattr(wl.settings, "watchlist_max", 3)
    scored = [(f"T{i}", 85 + i, f"t{i}") for i in range(10)]  # 10 nombres >=85
    wl.update(db, scored)
    rows = db.scalars(select(Watchlist)).all()
    assert len(rows) == 3                                   # capado
    assert min(r.score for r in rows) == 92                # se quedan los de mayor score (94,93,92)


# ---- muestreo ----

def test_sample_includes_always_and_fills(monkeypatch) -> None:
    monkeypatch.setattr(universe_mod, "build_universe", lambda: [f"U{i}" for i in range(500)])
    sample = universe_mod.sample_for_scan(["HELD1", "HELD2"], n=50)
    assert sample[:2] == ["HELD1", "HELD2"]                 # posiciones/watchlist siempre primero
    assert len(sample) == 50
    assert len(set(sample)) == 50                           # sin duplicados


def test_sample_dedups_always(monkeypatch) -> None:
    monkeypatch.setattr(universe_mod, "build_universe", lambda: ["U1", "U2", "U3"])
    sample = universe_mod.sample_for_scan(["AAA", "aaa", "AAA"], n=3)
    assert sample.count("AAA") == 1


def test_sample_rotates_without_repeat(monkeypatch) -> None:
    monkeypatch.setattr(universe_mod, "build_universe", lambda: [f"U{i}" for i in range(10)])
    w0 = universe_mod.sample_for_scan([], n=4, offset=0)
    w1 = universe_mod.sample_for_scan([], n=4, offset=4)
    assert set(w0).isdisjoint(w1)                        # semanas consecutivas no repiten
    w2 = universe_mod.sample_for_scan([], n=4, offset=8)
    assert w2 == ["U8", "U9", "U0", "U1"]                # envuelve al final del universo
    assert set(w0) | set(w1) | set(w2) == {f"U{i}" for i in range(10)}  # 3 ventanas tejen el universo


# ---- universo: liquidez en dólares y foto del cierre ----

def test_liquidez_se_mide_en_dolares_no_en_acciones(monkeypatch) -> None:
    """Contar acciones castiga a los caros: PLMR mueve $41M al día y se quedaba fuera por no
    llegar a 300k acciones, mientras un valor de $6 con 300k acciones ($1,8M) sí entraba."""
    monkeypatch.setattr(universe_mod.settings, "universe_min_dollar_volume", 5_000_000)
    monkeypatch.setattr(universe_mod.settings, "universe_max_names", 2_600)
    filas = [
        ("CARO", 138.59, 299_570),      # $41,5M al día: líquido de verdad, pocas acciones
        ("BARATO", 6.0, 300_000),       # $1,8M al día: pasaba el corte de acciones y no debía
        ("JUSTO", 10.0, 500_000),       # $5,0M exactos: entra
    ]
    assert universe_mod._liquidos(filas) == ["CARO", "JUSTO"]


def test_el_tope_recorta_por_volumen_y_devuelve_alfabetico(monkeypatch) -> None:
    """El suelo solo deja el tamaño del universo (y el coste, que es 1 llamada de Flash por
    nombre) a merced de lo movida que estuviera la sesión fotografiada. Con tope, se escanean
    los N de más dinero negociado y el resto espera — pero la lista sale ALFABÉTICA, porque la
    ventana rotatoria necesita un orden estable entre escaneos."""
    monkeypatch.setattr(universe_mod.settings, "universe_min_dollar_volume", 1_000_000)
    monkeypatch.setattr(universe_mod.settings, "universe_max_names", 2)
    filas = [
        ("ZZZ", 10.0, 900_000),         # $9M   → el que más mueve, pero último alfabéticamente
        ("AAA", 10.0, 800_000),         # $8M
        ("MMM", 10.0, 700_000),         # $7M   → se cae por el tope, no por iliquidez
    ]
    assert universe_mod._liquidos(filas) == ["AAA", "ZZZ"]


def test_el_informe_lleva_cuanto_recorto_el_tope(db, monkeypatch) -> None:
    """`sobre_suelo` > `size` = el tope recortó. El número viaja SIEMPRE en el informe; el aviso
    de incidencia solo salta si el recorte es grande (ver `scan_service`), porque un recorte
    pequeño es el funcionamiento normal y no una avería."""
    monkeypatch.setattr(universe_mod.settings, "universe_min_dollar_volume", 1_000_000)
    monkeypatch.setattr(universe_mod.settings, "universe_max_names", 2)
    monkeypatch.setattr(universe_mod, "_from_nasdaq", lambda: [
        ("AAA", 10.0, 900_000), ("BBB", 10.0, 800_000), ("CCC", 10.0, 700_000),
    ])
    _symbols, info = universe_mod.universe_for_scan(db)
    assert info["size"] == 2 and info["sobre_suelo"] == 3


def test_foto_del_universo_se_guarda_y_se_relee(db, monkeypatch) -> None:
    """El universo se fotografía con la bolsa cerrada y los escaneos leen esa foto: el `volume`
    de NASDAQ es el ACUMULADO DE LA SESIÓN, así que pedirlo a media mañana daba un mercado
    recortado (426 nombres el 21-jul en vez de ~2.600) y sesgado hacia lo que se movía ese día."""
    monkeypatch.setattr(universe_mod, "_from_nasdaq",
                        lambda: [("AAA", 100.0, 1_000_000), ("ILIQ", 1.0, 1_000)])

    assert universe_mod.refresh_snapshot(db) == 2

    def _no_llamar():
        raise AssertionError("con foto guardada no se debe llamar a NASDAQ")

    monkeypatch.setattr(universe_mod, "_from_nasdaq", _no_llamar)
    symbols, info = universe_mod.universe_for_scan(db)
    assert symbols == ["AAA"]                     # ILIQ no llega al mínimo en dólares
    assert info["fuente"] == "cierre" and info["dias"] == 0


def test_sin_foto_avisa_de_que_va_en_vivo(db, monkeypatch) -> None:
    """Sin foto se sigue escaneando (en vivo), pero la procedencia viaja al informe para que un
    universo recortado no pase por normal."""
    monkeypatch.setattr(universe_mod, "_from_nasdaq", lambda: [("AAA", 100.0, 1_000_000)])
    _symbols, info = universe_mod.universe_for_scan(db)
    assert info["fuente"] == "vivo"


def test_sin_foto_y_sin_nasdaq_cae_al_seed_marcado(db, monkeypatch) -> None:
    """Último recurso: el SEED de emergencia, SIEMPRE etiquetado (el escaneo lo usa para
    abortar en vez de puntuar 40 nombres como si fueran el mercado)."""
    def _falla():
        raise RuntimeError("NASDAQ no responde")

    monkeypatch.setattr(universe_mod, "_from_nasdaq", _falla)
    symbols, info = universe_mod.universe_for_scan(db)
    assert info["fuente"] == "seed" and symbols == list(universe_mod._SEED_FALLBACK)


# ---- selección fiel al paper (top-N por score, desempate por market cap) ----

class _Row:
    def __init__(self, ticker: str, score: int) -> None:
        self.ticker, self.score = ticker, score


def test_select_top_n_by_score_then_marketcap() -> None:
    from app.portfolio_service import select_top
    rows = [_Row("A", 80), _Row("B", 90), _Row("C", 90), _Row("D", 70)]
    mcap = {"A": 5e9, "B": 3e9, "C": 8e9, "D": 20e9}
    sel = select_top(rows, mcap, floor=0, n=2)
    # empate a 90 entre B y C → desempata market cap: C (8B) antes que B (3B)
    assert [r.ticker for r in sel] == ["C", "B"]


def test_select_respects_floor_when_set() -> None:
    from app.portfolio_service import select_top
    rows = [_Row("A", 80), _Row("B", 60)]
    assert [r.ticker for r in select_top(rows, {}, floor=72, n=4)] == ["A"]   # B cae por el suelo
    assert [r.ticker for r in select_top(rows, {}, floor=0, n=4)] == ["A", "B"]  # sin suelo, ambos


# ---- corte de finalistas estratificado (amplitud por sector + tope duro) ----

def _pn(ticker: str, sector: str, score: float):
    """(PrescoreResult, NameData) para armar un ranking de prueba."""
    return (scorer_mod.PrescoreResult(ticker, score, ""),
            NameData(ticker=ticker, sector=sector, industry="x", price=1.0,
                     fundamentals_text="", technical_text="", news=[]))


def test_select_finalists_stratifies_by_sector() -> None:
    from app.portfolio_service import select_finalists
    # Tech copa la cabeza del ranking; Energy y Health quedan muy por debajo en score global.
    prescored = [
        _pn("T1", "Tech", 99), _pn("T2", "Tech", 98), _pn("T3", "Tech", 97), _pn("T4", "Tech", 96),
        _pn("E1", "Energy", 60), _pn("E2", "Energy", 59),
        _pn("H1", "Health", 40),
    ]
    fin, _carriles = select_finalists(prescored, held=set(), watch=[], per_sector=2, global_n=3,
                                      cap=35)
    # top-2/sector = {T1,T2,E1,E2,H1} ∪ top-3 global = {T1,T2,T3} → +T3
    assert set(fin) == {"T1", "T2", "T3", "E1", "E2", "H1"}
    assert "T4" not in fin        # 4º de Tech: ni top-2 de su sector ni top-3 global


def test_select_finalists_cap_prioriza_los_carriles_garantizados() -> None:
    """Al truncar, los carriles GARANTIZADOS (posición → watchlist → caps) van por delante de
    los grupos del pre-score de esta semana: la watchlist es señal ya validada por el modelo
    caro y las caps son la promesa de que Flash no veta a los grandes. Hasta el 4-ago el orden
    era el inverso y la watchlist caía primero justo en los mensuales, donde el tope muerde."""
    from app.portfolio_service import select_finalists
    prescored = [_pn(f"N{i}", "Tech", 100 - i) for i in range(10)]  # N0 mejor … N9 peor
    fin, _carriles = select_finalists(prescored, held={"N9"}, watch=["N5"], per_sector=2,
                                      global_n=2, cap=3)
    assert len(fin) == 3                    # tope duro
    assert set(fin) == {"N9", "N5", "N0"}   # posición → watchlist → primer hueco al núcleo

    # Con sitio, entran todos los grupos; el carril de caps rescata al de mayor capitalización
    # aunque su pre-score sea el peor (aquí N8, que sin carril quedaría fuera con global_n=2).
    prescored[8][1].market_cap = 9e12
    fin, _carriles = select_finalists(prescored, held=set(), watch=[], per_sector=2, global_n=2,
                                      cap=3, top_caps=1)
    assert "N8" in fin                      # el gigante entra por caps, no por pre-score


# ---- traza de auditoría del embudo (diagnóstico) ----

def test_scan_audit_records_each_stage(db) -> None:
    from app import scan_audit
    from app.agents.scorer import ScoreResult
    from app.models import ScanAudit

    class _Pos:
        def __init__(self, ticker: str, weight: float) -> None:
            self.ticker, self.weight_pct = ticker, weight

    class _Constr:
        positions = [_Pos("A", 100.0)]

    prescored = [_pn("A", "Tech", 90), _pn("B", "Energy", 80), _pn("C", "Health", 70)]
    deep = {"A": ScoreResult("A", 88, "h", "r"), "B": ScoreResult("B", 60, "h", "r")}
    scan_audit.record(db, prescored=prescored, failed=["X"], finalists=["A", "B"],
                      deep=deep, selected=[ScoreResult("A", 88, "h", "r")], construction=_Constr())

    rows = {r.ticker: r for r in db.query(ScanAudit).all()}
    assert rows["A"].stage == "cartera" and rows["A"].funded and rows["A"].weight_pct == 100.0
    assert rows["B"].stage == "finalista" and rows["B"].reached_deep and not rows["B"].selected
    assert rows["C"].stage == "prescore" and not rows["C"].reached_deep
    assert rows["X"].stage == "datos" and rows["X"].prescore is None
    # El precio del día: sin él no se puede medir DESPUÉS qué hicieron las descartadas.
    assert rows["C"].price == 1.0


def test_scan_audit_es_historico_y_poda_lo_viejo(db, monkeypatch) -> None:
    """Cada escaneo AÑADE su traza (antes borraba la anterior: cada escaneo destruía la
    evidencia del previo) y solo se cae lo que pasa de la retención."""
    from app import scan_audit
    from app.models import ScanAudit

    class _Constr:
        positions: list = []

    ahora = datetime.now(UTC)
    db.add(ScanAudit(scan_at=ahora - timedelta(days=scan_audit.RETENTION_DAYS + 1),
                     ticker="OLD", stage="prescore"))
    db.commit()

    # Relojes fijos (en Windows dos llamadas seguidas caen en el mismo tick de ~15 ms).
    for ticker, cuando in (("A", ahora - timedelta(days=7)), ("B", ahora)):
        monkeypatch.setattr(scan_audit, "_utcnow", lambda c=cuando: c)
        scan_audit.record(db, prescored=[_pn(ticker, "Tech", 90)], failed=[], finalists=[],
                          deep={}, selected=[], construction=_Constr())

    rows = db.query(ScanAudit).all()
    assert {r.ticker for r in rows} == {"A", "B"}      # los dos escaneos conviven
    assert "OLD" not in {r.ticker for r in rows}       # el de hace 91 días, podado
    assert db.query(ScanAudit.scan_at).distinct().count() == 2   # scan_at = id de escaneo


def test_scan_audit_registra_los_prescores_fallidos(db) -> None:
    """Un pre-score que no parsea desaparecía del embudo sin rastro (ni en failed, ni en la
    auditoría, ni en el ranking): ahora queda con su etapa propia."""
    from app import scan_audit
    from app.models import ScanAudit

    class _Constr:
        positions: list = []

    scan_audit.record(db, prescored=[_pn("A", "Tech", 90)], failed=[], finalists=[], deep={},
                      selected=[], construction=_Constr(), pre_errors=[_pn("E", "Energy", 0)])

    row = db.query(ScanAudit).filter(ScanAudit.ticker == "E").one()
    assert row.stage == "prescore_error"
    assert row.prescore is None            # no hubo puntuación: hubo fallo (no cuenta como pre)
    assert row.sector == "Energy"


def test_scan_audit_registra_los_profundos_ilegibles(db) -> None:
    """Un informe profundo no parseable quedaba como "finalista" cualquiera: en dos meses no se
    podía contar cuántas veces falló un mismo ticker (MS/CNC solo eran un aviso del informe).
    Ahora tiene etapa propia, conserva que SÍ llegó al profundo, y el embudo lo cuenta."""
    from app import scan_audit
    from app.agents.scorer import ScoreResult
    from app.models import ScanAudit

    class _Constr:
        positions: list = []

    prescored = [_pn("A", "Tech", 90), _pn("MS", "Financial", 85)]
    scan_audit.record(db, prescored=prescored, failed=[], finalists=["A", "MS"],
                      deep={"A": ScoreResult("A", 88, "h", "r")}, selected=[],
                      construction=_Constr(), deep_errors=["MS"])

    row = db.query(ScanAudit).filter(ScanAudit.ticker == "MS").one()
    assert row.stage == "deep_error"
    assert row.reached_deep is True        # llegó al profundo; falló AHÍ, no antes
    assert row.deep_score is None          # no hay score que guardar: no parseó

    f = scan_audit.funnel(db, limit=1)[0]
    assert f["deep_error"] == 1
    assert f["deep"] == 2                  # ambos cuentan como llegados al profundo


# ---- 100% invertido (water-filling con tope por posición) ----

def test_full_invest_sums_to_100_and_respects_cap() -> None:
    from app.portfolio_service import _full_invest
    # el LLM da 50/30/20 pero el tope es 35 → clava el 50 y reparte
    w = _full_invest([50.0, 30.0, 20.0], cap=35.0)
    assert abs(sum(w) - 100.0) < 0.01           # 100% invertido
    assert all(x <= 35.0 + 1e-6 for x in w)     # ninguno pasa el tope
    assert w[0] == 35.0                          # el mayor queda clavado al tope


def test_full_invest_five_equal() -> None:
    from app.portfolio_service import _full_invest
    w = _full_invest([1, 1, 1, 1, 1], cap=35.0)
    assert abs(sum(w) - 100.0) < 0.01 and all(abs(x - 20.0) < 0.01 for x in w)


def test_select_finalists_rescata_mayores_caps() -> None:
    from app.portfolio_service import select_finalists
    # MEGA prescorea fatal, pero es la mayor cap → el carril de rescate la mete al profundo.
    prescored = [_pn("A", "Tech", 90), _pn("B", "Health", 80), _pn("MEGA", "Tech", 5)]
    prescored[0][1].market_cap = 1e9
    prescored[1][1].market_cap = 2e9
    prescored[2][1].market_cap = 3e12
    sin, _carriles = select_finalists(prescored, held=set(), watch=[], per_sector=1, global_n=1,
                                      cap=10)
    con, _carriles = select_finalists(prescored, held=set(), watch=[], per_sector=1, global_n=1,
                                      cap=10, top_caps=1)
    assert "MEGA" not in sin
    assert "MEGA" in con


def test_norm_symbol_clases_y_preferentes() -> None:
    from app.screener.universe import _norm_symbol
    assert _norm_symbol("AAPL") == "AAPL"
    assert _norm_symbol("BRK/B") == "BRK-B"      # clase con barra → formato yfinance
    assert _norm_symbol("WRB^H") is None         # preferente/serie
    assert _norm_symbol("XYZ/WS") is None        # warrant (dos letras tras la barra)
    assert _norm_symbol("") is None


def test_watchlist_drop_saca_posiciones(db) -> None:
    wl.update(db, [("AAA", 90, "t"), ("BBB", 88, "t")])
    wl.drop(db, {"AAA"})
    assert wl.tickers(db) == ["BBB"]


# ---- omitidos del constructor (telemetría, nunca vuelve al prompt) -----------

def test_constructor_registra_por_que_dejo_fuera_a_los_demas() -> None:
    """Fondear 5 de 10 obliga a dejar 5 fuera; guardar el motivo permite distinguir DESPUÉS
    criterio de pattern-matching. Se filtra igual que las posiciones: fuera los tickers que no
    estaban entre los candidatos y fuera los que sí se fondearon (el modelo a veces los repite)."""
    reply = json.dumps({
        "cash_pct": 0,
        "positions": [{"ticker": "AAA", "weight_pct": 100, "thesis": "t", "edge": "e", "risk": "r"}],
        "omitted": [
            {"ticker": "BBB", "reason": "Menor recorrido al objetivo."},
            {"ticker": "AAA", "reason": "contradictorio: AAA sí se fondeó"},
            {"ticker": "ZZZ", "reason": "alucinado: no estaba entre los candidatos"},
        ],
        "summary": "s",
    })
    res = constructor_mod.construct(FakeLLM(reply), "cartera", "candidatos", "macro",
                                    1, 100.0, {"AAA", "BBB"})
    assert [(o.ticker, o.reason) for o in res.omitted] == [("BBB", "Menor recorrido al objetivo.")]


def test_constructor_sin_omitidos_no_revienta() -> None:
    """Un modelo que no devuelva la lista (o la devuelva nula) no debe tirar la construcción:
    los omitidos son telemetría, no parte del contrato de la cartera."""
    reply = json.dumps({"cash_pct": 0, "omitted": None, "summary": "s",
                        "positions": [{"ticker": "AAA", "weight_pct": 100,
                                       "thesis": "t", "edge": "e", "risk": "r"}]})
    res = constructor_mod.construct(FakeLLM(reply), "c", "c", "m", 1, 100.0, {"AAA"})
    assert res.omitted == [] and len(res.positions) == 1
