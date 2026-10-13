from app.agents.scorer import PrescoreResult
from app.models import ScanAudit
from app.portfolio_service import de_filtro_tecnico
from app.screener.fundamentals import NameData


def _fila(ticker: str) -> tuple[PrescoreResult, NameData]:
    return (
        PrescoreResult(ticker=ticker, score=50),
        NameData(
            ticker=ticker, sector="", industry="", price=None,
            fundamentals_text="", technical_text="",
        ),
    )


def test_conserva_orden_de_entrada():
    prescored = [_fila(ticker) for ticker in ("ZZZ", "AAA", "MMM")]

    resultado = de_filtro_tecnico(prescored, {"MMM", "ZZZ"}, {"AAA"})

    assert resultado == prescored
    assert all(fila is original for fila, original in zip(resultado, prescored, strict=True))


def test_siempre_entra_sin_pasar_tecnicos():
    fila = _fila("ABIERTA")

    assert de_filtro_tecnico([fila], {"OTRA"}, {"ABIERTA"}) == [fila]


def test_excluye_ticker_fuera_de_ambos_conjuntos():
    prescored = [_fila("TECNICA"), _fila("FUERA"), _fila("PERSONAL")]

    assert de_filtro_tecnico(prescored, {"TECNICA"}, {"PERSONAL"}) == [
        prescored[0], prescored[2],
    ]


def test_conjuntos_vacios_devuelven_lista_vacia():
    assert de_filtro_tecnico([_fila("AAA")], set(), set()) == []


def test_todos_tecnicos_devuelven_lista_identica():
    prescored = [_fila(ticker) for ticker in ("ZZZ", "AAA", "MMM")]

    assert de_filtro_tecnico(prescored, {p.ticker for p, _ in prescored}, set()) == prescored


def test_scan_audit_tiene_columna_pasa_filtro_tecnico():
    assert "pasa_filtro_tecnico" in ScanAudit.__table__.c
    assert ScanAudit.__table__.c.pasa_filtro_tecnico.nullable
