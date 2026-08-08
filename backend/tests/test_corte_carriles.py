"""Corte de finalistas: desempate por market cap, sector n/d sin plaza y carriles de entrada."""

from __future__ import annotations

from app.agents import scorer as scorer_mod
from app.portfolio_service import select_finalists
from app.screener.fundamentals import NameData


def _pn(ticker: str, sector: str, score: float, market_cap: float = 0.0):
    """(PrescoreResult, NameData) para armar un ranking de prueba."""
    return (scorer_mod.PrescoreResult(ticker, score),
            NameData(ticker=ticker, sector=sector, industry="x", price=1.0, market_cap=market_cap,
                     fundamentals_text="", technical_text="", news=[]))


def test_empate_de_score_lo_gana_la_mayor_capitalizacion() -> None:
    # A y B empatan a 84.5; B tiene más cap → B debe colarse en el hueco que A perdería.
    prescored = [_pn("A", "Tech", 84.5, market_cap=1e9), _pn("B", "Tech", 84.5, market_cap=9e9),
                 _pn("C", "Tech", 90.0, market_cap=1.0)]
    fin, carriles = select_finalists(prescored, held=set(), watch=[], per_sector=1,
                                     global_n=2, cap=2)
    assert set(fin) == {"C", "B"}   # top-2 global tras el desempate: C (score) y B (mayor cap)
    assert "A" not in fin


def test_sector_desconocido_no_recibe_plaza_garantizada() -> None:
    prescored = [
        _pn("N1", "n/d", 95.0), _pn("N2", "n/d", 94.0),   # sin sector: no ganan carril propio
        _pn("T1", "Tech", 50.0),
    ]
    fin, carriles = select_finalists(prescored, held=set(), watch=[], per_sector=5,
                                     global_n=0, cap=10)
    # sin carril "sector" ni "global" (global_n=0), N1/N2 no entran por ningún carril garantizado
    assert "N1" not in fin and "N2" not in fin
    assert "T1" in fin and carriles["T1"] == "sector"


def test_carriles_de_entrada_son_correctos_y_sin_duplicados() -> None:
    prescored = [_pn(f"N{i}", "Tech", 100 - i) for i in range(6)]
    prescored[4][1].market_cap = 9e12   # N4: peor score pero gigante → carril caps
    fin, carriles = select_finalists(prescored, held={"N5"}, watch=["N3"], per_sector=1,
                                     global_n=2, cap=10, top_caps=1)
    assert len(fin) == len(set(fin))    # cada ticker aparece una sola vez
    assert carriles["N5"] == "posicion"
    assert carriles["N3"] == "watchlist"
    assert carriles["N4"] == "caps"
    assert carriles["N0"] == "sector"   # mejor de Tech por pre-score


def test_mid_scores_manda_en_el_carril_global() -> None:
    prescored = [_pn(f"N{i}", "Tech", 100 - i) for i in range(5)]  # N0 mejor por pre-score
    # el modelo mejor invierte el orden: N4 pasa a ser el mejor de la segunda opinión.
    mid_scores = {"N4": 99.0, "N3": 90.0}
    fin, carriles = select_finalists(prescored, held=set(), watch=[], per_sector=0,
                                     global_n=2, cap=10, mid_scores=mid_scores)
    assert set(fin) == {"N4", "N3"}     # el global sale de mid_scores, no del prescore
    assert carriles["N4"] == "global" and carriles["N3"] == "global"
