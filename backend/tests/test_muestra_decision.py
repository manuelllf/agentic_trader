from app.scan_service import muestra_de_decision


def test_siempre_primero_y_sin_duplicados():
    assert muestra_de_decision(["BTC-USD", "AAA", "AAA"], ["ZZZ", "AAA", "ZZZ", "MMM"]) == [
        "BTC-USD", "AAA", "ZZZ", "MMM"]


def test_siempre_entra_aunque_no_sea_elegible():
    assert muestra_de_decision(["HELD", "BTC-USD"], ["AAA"]) == ["HELD", "BTC-USD", "AAA"]


def test_listas_vacias_y_entradas_sin_mutar():
    siempre, elegibles = ["AAA", "AAA"], ["ZZZ", "AAA"]
    muestra_de_decision(siempre, elegibles)
    assert siempre == ["AAA", "AAA"] and elegibles == ["ZZZ", "AAA"]
    assert muestra_de_decision([], []) == []
