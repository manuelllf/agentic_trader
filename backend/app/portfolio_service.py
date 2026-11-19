"""Matemática de cartera (sin LLM, sin escrituras en BD).

La parte determinista del método: dado lo que el escaneo ya puntuó y lo que el constructor
propuso, aquí se decide QUÉ entra (selección fiel al paper), CUÁNTO pesa (100% invertido con
tope por posición) y CÓMO se traduce a trades (diff objetivo vs actual con aritmética Decimal
exacta). El LLM nunca toca dinero: todo lo de este módulo es código puro y testeable.

Lo usa `app.scan_service` desde sus tres pipelines (escaneo, recheck, redeep).
"""

from __future__ import annotations

from decimal import Decimal



ZERO = Decimal("0")










def prescored_lambda(prescored: list, tecnicos: set[str] | None) -> list:
    """Conserva en orden los técnicos de Lambda; sin `tecnicos`, todos."""
    return [fila for fila in prescored if tecnicos is None or fila[0].ticker in tecnicos]


def de_filtro_tecnico(prescored: list, tecnicos: set[str], siempre: set[str]) -> list:
    """Conserva en orden los técnicos y los tickers que Alpha debe seguir siempre."""
    return [fila for fila in prescored if fila[0].ticker in tecnicos or fila[0].ticker in siempre]


def cartera_jev(prescored: list, excluir: set[str], n: int, max_por_industria: int) -> list:
    """Cartera mecánica de Jev: los `n` mejores por nota del prescore, con como mucho
    `max_por_industria` por industria. Pesos iguales; sin industria conocida no entra.

    `prescored` = [(PrescoreResult, NameData)]; `excluir` = opadas según el profundo.
    Desempate: confianza de Jev, luego market cap.
    """
    orden = sorted(prescored, key=lambda x: (-x[0].score, -(x[0].confidence or 0.0),
                                             -(x[1].market_cap or 0.0)))
    por_industria: dict[str, int] = {}
    out: list = []
    for p, d in orden:
        industria = (d.industry or "").strip()
        if p.ticker in excluir or not industria or industria.lower() == "n/d":
            continue
        if por_industria.get(industria, 0) >= max_por_industria:
            continue
        por_industria[industria] = por_industria.get(industria, 0) + 1
        out.append((p, d))
        if len(out) == n:
            break
    return out












