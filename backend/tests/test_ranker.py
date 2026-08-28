"""Ranker tests (scorer, constructor, watchlist, sampling) with fake LLM."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app import portfolio_service as portfolio
from app import scan_service
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

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
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


# ---- fecha de resultados (dato de contexto en los tres niveles, sin regla de qué hacer con él)

def test_earnings_text_fecha_ventana_y_pasado() -> None:
    """Earnings text labels dates/estimates correctly."""
    from app.screener import fundamentals as fund_mod

    hoy = datetime.now(UTC)
    en_10d = (hoy + timedelta(days=10)).timestamp()
    en_12d = (hoy + timedelta(days=12)).timestamp()

    txt = fund_mod._earnings_text(
        {"earningsTimestampStart": en_10d, "earningsTimestampEnd": en_10d})
    assert txt.startswith("next earnings report: ") and "unconfirmed" not in txt

    txt = fund_mod._earnings_text(
        {"earningsTimestampStart": en_10d, "earningsTimestampEnd": en_12d,
         "isEarningsDateEstimate": True})
    assert " to " in txt and "estimated (unconfirmed)" in txt

    hace_5d = (hoy - timedelta(days=5)).timestamp()
    assert fund_mod._earnings_text({"earningsTimestampStart": hace_5d}).startswith("last earnings")

    assert fund_mod._earnings_text({}) == ""


def test_earnings_entra_en_los_tres_niveles() -> None:
    """Earnings calendar in all three levels (mid, prescore_batch, scorer) as data."""
    data = _name()
    data.earnings_text = "next earnings report: 2026-08-12"
    assert "Earnings calendar: next earnings report: 2026-08-12" in (
        scorer_mod._user_prompt(data, "macro", None))
    assert "Earnings: next earnings report: 2026-08-12" in scorer_mod._mid_prompt(data, "macro")
    assert "Earnings: next earnings report: 2026-08-12" in (
        scorer_mod._prescore_batch_prompt([data], "macro"))

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
    res = constructor_mod.construct(FakeLLM(reply), "candidatos", "macro",
                                    max_positions=4, max_position_pct=35.0, valid_tickers=valid)
    assert len(res.positions) == 4                       # tope de 4
    assert all(p.weight_pct <= 35.0 for p in res.positions)  # tope 35%
    assert "ZZZ" not in {p.ticker for p in res.positions}    # anti-alucinación
    # 35+30+20+20 = 105 > 100 → renormaliza, cash 0.
    assert abs(sum(p.weight_pct for p in res.positions) - 100.0) < 0.1
    assert res.cash_pct == 0.0


def test_build_trades_lleva_high_52w_cuando_se_pasa(db) -> None:
    """La distancia al máximo se calcula en código (front/back), nunca la da el LLM."""
    construction = constructor_mod.ConstructionResult(
        cash_pct=0.0,
        positions=[constructor_mod.TargetPosition("AAA", 100.0, "t", "e", "r")],
    )
    items = portfolio.build_trades(db, construction, {}, {"AAA": "10.00"}, {}, {},
                                   high52_map={"AAA": 12.0})
    assert items[0]["high_52w"] == 12.0


def test_build_trades_high_52w_none_sin_mapa(db) -> None:
    """recheck/redeep no repiten el gather — sin `high52_map`, sale `None`, no revienta."""
    construction = constructor_mod.ConstructionResult(
        cash_pct=0.0,
        positions=[constructor_mod.TargetPosition("AAA", 100.0, "t", "e", "r")],
    )
    items = portfolio.build_trades(db, construction, {}, {"AAA": "10.00"}, {}, {})
    assert items[0]["high_52w"] is None


def test_constructor_bad_json_all_cash() -> None:
    res = constructor_mod.construct(FakeLLM("nope"), "c", "m", 4, 35.0, {"AAA"})
    assert res.positions == [] and res.cash_pct == 100.0


# ---- backfill del constructor: caído del todo o a medias, la UI tiene que enterarse ----

class _FakeSelected:
    def __init__(self, ticker: str) -> None:
        self.ticker = ticker
        self.headline = f"headline {ticker}"


def test_constructor_caido_del_todo_avisa_en_issues() -> None:
    res = constructor_mod.construct(FakeLLM("nope"), "c", "m", 4, 35.0,
                                    {"AAA", "BBB", "CCC"})
    selected = [_FakeSelected(t) for t in ("AAA", "BBB", "CCC")]
    res = portfolio.finalize_full_invest(res, selected, min_pos=3, max_pos=4, cap=35.0)
    assert len(res.positions) == 3  # relleno del todo por score, cero convicción del LLM

    issues: list[str] = []
    scan_service._flag_constructor_backfill(res, issues)
    assert len(issues) == 1
    assert "Constructor caído" in issues[0]


def test_constructor_a_medias_avisa_cuanto_relleno_hay() -> None:
    reply = ('{"cash_pct": 0, "positions": ['
             '{"ticker": "AAA", "weight_pct": 60, "thesis": "t", "edge": "e", "risk": "r"}'
             '], "summary": "s"}')
    res = constructor_mod.construct(FakeLLM(reply), "c", "m", 4, 35.0, {"AAA", "BBB", "CCC"})
    selected = [_FakeSelected(t) for t in ("AAA", "BBB", "CCC")]
    res = portfolio.finalize_full_invest(res, selected, min_pos=3, max_pos=4, cap=35.0)
    assert len(res.positions) == 3  # AAA del LLM + BBB/CCC de relleno

    issues: list[str] = []
    scan_service._flag_constructor_backfill(res, issues)
    assert len(issues) == 1
    assert "fondeó 1 de 3" in issues[0]


def test_constructor_sano_no_avisa() -> None:
    reply = ('{"cash_pct": 0, "positions": ['
             '{"ticker": "AAA", "weight_pct": 60, "thesis": "t", "edge": "e", "risk": "r"},'
             '{"ticker": "BBB", "weight_pct": 40, "thesis": "t", "edge": "e", "risk": "r"}'
             '], "summary": "s"}')
    res = constructor_mod.construct(FakeLLM(reply), "c", "m", 4, 35.0, {"AAA", "BBB"})
    selected = [_FakeSelected(t) for t in ("AAA", "BBB")]
    res = portfolio.finalize_full_invest(res, selected, min_pos=2, max_pos=4, cap=35.0)

    issues: list[str] = []
    scan_service._flag_constructor_backfill(res, issues)
    assert issues == []


def test_constructor_allows_ucits_instrument() -> None:
    # Un instrumento UCITS (símbolo con '.') sobrevive el filtro si está en valid_tickers.
    reply = ('{"cash_pct": 0, "positions": ['
             '{"ticker": "CSPX.L", "weight_pct": 40, "thesis": "t", "edge": "e", "risk": "r"},'
             '{"ticker": "AAA", "weight_pct": 30, "thesis": "t", "edge": "e", "risk": "r"}'
             '], "summary": "s"}')
    res = constructor_mod.construct(FakeLLM(reply), "candidatos", "macro",
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
    """Sample: always_include first, fills from universe, no duplicates."""
    monkeypatch.setattr(universe_mod, "build_universe", lambda: [f"U{i}" for i in range(500)])
    sample = universe_mod.sample_for_scan(["HELD1", "HELD2"], n=50)
    assert sample[:2] == ["HELD1", "HELD2"]
    assert len(sample) == 50
    assert len(set(sample)) == 50


def test_sample_dedups_always(monkeypatch) -> None:
    monkeypatch.setattr(universe_mod, "build_universe", lambda: ["U1", "U2", "U3"])
    sample = universe_mod.sample_for_scan(["AAA", "aaa", "AAA"], n=3)
    assert sample.count("AAA") == 1


def test_sample_rotates_without_repeat(monkeypatch) -> None:
    """Rotating windows cover universe without overlap; wraps at end."""
    monkeypatch.setattr(universe_mod, "build_universe", lambda: [f"U{i}" for i in range(10)])
    w0 = universe_mod.sample_for_scan([], n=4, offset=0)
    w1 = universe_mod.sample_for_scan([], n=4, offset=4)
    assert set(w0).isdisjoint(w1)
    w2 = universe_mod.sample_for_scan([], n=4, offset=8)
    assert w2 == ["U8", "U9", "U0", "U1"]
    assert set(w0) | set(w1) | set(w2) == {f"U{i}" for i in range(10)}


# ---- universo: liquidez en dólares y foto del cierre ----

def test_liquidez_se_mide_en_dolares_no_en_acciones(monkeypatch) -> None:
    """Dollar volume, not share count; prevents cheap-stock bias."""
    monkeypatch.setattr(universe_mod.settings, "universe_min_dollar_volume", 5_000_000)
    monkeypatch.setattr(universe_mod.settings, "universe_max_names", 2_600)
    filas = [
        ("CARO", 138.59, 299_570, 1e9, "Caro Inc. Common Stock"),      # $41,5M: líquido de verdad
        ("BARATO", 6.0, 300_000, 1e9, "Barato Inc. Common Stock"),     # $1,8M: no llega
        ("JUSTO", 10.0, 500_000, 1e9, "Justo Inc. Common Stock"),      # $5,0M exactos: entra
    ]
    assert universe_mod._liquidos(filas) == ["CARO", "JUSTO"]


def test_preferentes_fuera_adr_legitimo_dentro(monkeypatch) -> None:
    """El filtro por nombre saca preferentes/notas pero no toca ADRs legítimos."""
    monkeypatch.setattr(universe_mod.settings, "universe_min_dollar_volume", 1_000_000)
    monkeypatch.setattr(universe_mod.settings, "universe_max_names", 10)
    filas = [
        ("PREF", 50.0, 100_000, 1e9, "Foo Inc. Preferred Stock"),
        ("ADR", 50.0, 100_000, 1e9,
         "Bar Inc. American Depositary Shares (each representing 1 Common Share)"),
    ]
    assert universe_mod._liquidos(filas) == ["ADR"]


def test_el_tope_recorta_por_volumen_y_devuelve_alfabetico(monkeypatch) -> None:
    """Cap cuts by volume; returns alphabetical (stable for rotating window)."""
    monkeypatch.setattr(universe_mod.settings, "universe_min_dollar_volume", 1_000_000)
    monkeypatch.setattr(universe_mod.settings, "universe_max_names", 2)
    filas = [
        ("ZZZ", 10.0, 900_000, 1e9, "Zzz Inc. Common Stock"),   # $9M → el que más mueve, pero último alfabéticamente
        ("AAA", 10.0, 800_000, 1e9, "Aaa Inc. Common Stock"),   # $8M
        ("MMM", 10.0, 700_000, 1e9, "Mmm Inc. Common Stock"),   # $7M → se cae por el tope, no por iliquidez
    ]
    assert universe_mod._liquidos(filas) == ["AAA", "ZZZ"]


def test_el_informe_lleva_cuanto_recorto_el_tope(db, monkeypatch) -> None:
    """Report includes sobre_suelo; cap bite measured for alerts."""
    monkeypatch.setattr(universe_mod.settings, "universe_min_dollar_volume", 1_000_000)
    monkeypatch.setattr(universe_mod.settings, "universe_max_names", 2)
    monkeypatch.setattr(universe_mod, "_from_nasdaq", lambda: [
        ("AAA", 10.0, 900_000, 1e9, "Aaa Inc. Common Stock"),
        ("BBB", 10.0, 800_000, 1e9, "Bbb Inc. Common Stock"),
        ("CCC", 10.0, 700_000, 1e9, "Ccc Inc. Common Stock"),
    ])
    _symbols, info = universe_mod.universe_for_scan(db)
    assert info["size"] == 2 and info["sobre_suelo"] == 3


def test_foto_del_universo_se_guarda_y_se_relee(db, monkeypatch) -> None:
    """Universe snapshot closed-market; avoids intra-day volume bias."""
    monkeypatch.setattr(universe_mod, "_from_nasdaq", lambda: [
        ("AAA", 100.0, 1_000_000, 1e9, "Aaa Inc. Common Stock"),
        ("ILIQ", 1.0, 1_000, 1e9, "Iliq Inc. Common Stock"),
    ])

    assert universe_mod.refresh_snapshot(db) == 2

    def _no_llamar():
        raise AssertionError("con foto guardada no se debe llamar a NASDAQ")

    monkeypatch.setattr(universe_mod, "_from_nasdaq", _no_llamar)
    symbols, info = universe_mod.universe_for_scan(db)
    assert symbols == ["AAA"]                     # ILIQ no llega al mínimo en dólares
    assert info["fuente"] == "cierre" and info["dias"] == 0


def test_sin_foto_avisa_de_que_va_en_vivo(db, monkeypatch) -> None:
    """No snapshot: scans live; provenance marked in report."""
    monkeypatch.setattr(universe_mod, "_from_nasdaq",
                        lambda: [("AAA", 100.0, 1_000_000, 1e9, "Aaa Inc. Common Stock")])
    _symbols, info = universe_mod.universe_for_scan(db)
    assert info["fuente"] == "vivo"


def test_sin_foto_y_sin_nasdaq_cae_al_seed_marcado(db, monkeypatch) -> None:
    """No snapshot and NASDAQ down: fallback SEED always labeled."""
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
    return (scorer_mod.PrescoreResult(ticker, score),
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
    fin, _carriles = select_finalists(prescored, held=set(), watch=[], per_sector=2, cap=6)
    # top-2/sector = {T1,T2,E1,E2,H1} (5) + el resto por score hasta el tope (6) → +T3
    assert set(fin) == {"T1", "T2", "T3", "E1", "E2", "H1"}
    assert "T4" not in fin        # 4º de Tech: ni top-2 de su sector ni cabe en lo que queda


def test_select_finalists_cap_prioriza_los_carriles_garantizados() -> None:
    """Truncation: guaranteed lanes (position/watchlist/caps) before prescore groups."""
    from app.portfolio_service import select_finalists
    prescored = [_pn(f"N{i}", "Tech", 100 - i) for i in range(10)]  # N0 mejor … N9 peor
    fin, _carriles = select_finalists(prescored, held={"N9"}, watch=["N5"], per_sector=2, cap=3)
    assert len(fin) == 3                    # tope duro
    assert set(fin) == {"N9", "N5", "N0"}   # posición → watchlist → primer hueco al núcleo

    # With room: caps lane rescues highest market cap despite low prescore.
    prescored[8][1].market_cap = 9e12
    fin, _carriles = select_finalists(prescored, held=set(), watch=[], per_sector=2,
                                      cap=3, top_caps=1)
    assert "N8" in fin


# ---- traza de auditoría del embudo (diagnóstico) ----

def test_scan_audit_records_each_stage(db) -> None:
    """Audit trace records every stage and price for post-hoc performance."""
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
    assert rows["C"].price == 1.0


def test_scan_audit_es_historico_y_poda_lo_viejo(db, monkeypatch) -> None:
    """Scans accumulate traces; retention-aged records pruned."""
    from app import scan_audit
    from app.models import ScanAudit

    class _Constr:
        positions: list = []

    ahora = datetime.now(UTC)
    db.add(ScanAudit(scan_at=ahora - timedelta(days=scan_audit.RETENTION_DAYS + 1),
                     ticker="OLD", stage="prescore"))
    db.commit()

    # Fixed clocks for testing.
    for ticker, cuando in (("A", ahora - timedelta(days=7)), ("B", ahora)):
        monkeypatch.setattr(scan_audit, "_utcnow", lambda c=cuando: c)
        scan_audit.record(db, prescored=[_pn(ticker, "Tech", 90)], failed=[], finalists=[],
                          deep={}, selected=[], construction=_Constr())

    rows = db.query(ScanAudit).all()
    assert {r.ticker for r in rows} == {"A", "B"}      # los dos escaneos conviven
    assert "OLD" not in {r.ticker for r in rows}       # el de hace 91 días, podado
    assert db.query(ScanAudit.scan_at).distinct().count() == 2   # scan_at = id de escaneo


def test_scan_audit_registra_los_prescores_fallidos(db) -> None:
    """Failed prescore visible in audit; doesn't vanish silently."""
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
    """Failed deep score gets own stage; marks reached_deep=true for funnel."""
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
    """Full invest: 100% deployed, respects position cap."""
    from app.portfolio_service import _full_invest
    w = _full_invest([50.0, 30.0, 20.0], cap=35.0)
    assert abs(sum(w) - 100.0) < 0.01
    assert all(x <= 35.0 + 1e-6 for x in w)
    assert w[0] == 35.0


def test_full_invest_five_equal() -> None:
    from app.portfolio_service import _full_invest
    w = _full_invest([1, 1, 1, 1, 1], cap=35.0)
    assert abs(sum(w) - 100.0) < 0.01 and all(abs(x - 20.0) < 0.01 for x in w)


def test_select_finalists_rescata_mayores_caps() -> None:
    """Caps lane rescues top market-cap despite low prescore."""
    from app.portfolio_service import select_finalists
    prescored = [_pn("A", "Tech", 90), _pn("B", "Health", 80), _pn("MEGA", "Tech", 5)]
    prescored[0][1].market_cap = 1e9
    prescored[1][1].market_cap = 2e9
    prescored[2][1].market_cap = 3e12
    sin, _carriles = select_finalists(prescored, held=set(), watch=[], per_sector=1, cap=2)
    con, _carriles = select_finalists(prescored, held=set(), watch=[], per_sector=1, cap=2,
                                      top_caps=1)
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
    """Omitted reasons recorded for later criterion auditing."""
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
    res = constructor_mod.construct(FakeLLM(reply), "candidatos", "macro",
                                    1, 100.0, {"AAA", "BBB"})
    assert [(o.ticker, o.reason) for o in res.omitted] == [("BBB", "Menor recorrido al objetivo.")]


def test_constructor_sin_omitidos_no_revienta() -> None:
    """Missing omitted field is graceful; telemetry, not contract."""
    reply = json.dumps({"cash_pct": 0, "omitted": None, "summary": "s",
                        "positions": [{"ticker": "AAA", "weight_pct": 100,
                                       "thesis": "t", "edge": "e", "risk": "r"}]})
    res = constructor_mod.construct(FakeLLM(reply), "c", "m", 1, 100.0, {"AAA"})
    assert res.omitted == [] and len(res.positions) == 1
