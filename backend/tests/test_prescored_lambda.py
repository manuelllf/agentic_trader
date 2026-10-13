from app.agents.scorer import PrescoreResult
from app.portfolio_service import prescored_lambda
from app.screener.fundamentals import NameData


def _fila(ticker: str, score: float = 50) -> tuple[PrescoreResult, NameData]:
    return (PrescoreResult(ticker=ticker, score=score), NameData(
        ticker=ticker, sector="", industry="", price=None,
        fundamentals_text="", technical_text=""))


def test_lambda_solo_elige_tecnicos():
    filas = [_fila("FUERA", 99), _fila("DENTRO", 60)]
    assert prescored_lambda(filas, {"DENTRO"}) == [filas[1]]


def test_cartera_personal_compite_como_cualquier_empresa():
    filas = [_fila(t, s) for t, s in (("MSFT", 80), ("HUMA", 40), ("ASTS", 30))]
    assert prescored_lambda(filas, {p.ticker for p, _ in filas}) == filas


def test_bitcoin_no_entra_aunque_tenga_mejor_nota():
    filas = [_fila("BTC-USD", 100), _fila("AAA", 50)]
    assert prescored_lambda(filas, {"AAA"}) == [filas[1]]


def test_sin_tecnicos_conserva_todas():
    filas = [_fila(t) for t in ("ZZZ", "MSFT", "AAA", "BTC-USD")]
    assert prescored_lambda(filas, None) == filas


def test_todos_tecnicos_conservan_lista_orden_y_tuplas():
    filas = [_fila(t) for t in ("ZZZ", "AAA", "MMM")]
    resultado = prescored_lambda(filas, {p.ticker for p, _ in filas})
    assert resultado == filas
    assert all(a is b for a, b in zip(resultado, filas, strict=True))


def test_tecnicos_vacios_no_elige_nadie():
    assert prescored_lambda([_fila("AAA")], set()) == []
