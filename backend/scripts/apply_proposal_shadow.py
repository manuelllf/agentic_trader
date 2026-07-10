"""Materializa la ÚLTIMA propuesta en el LIBRO SOMBRA (simulado, sin dinero real).

Ejecuta un record_buy por cada item 'comprar' a su precio y acciones de la propuesta, para
poder trackear rentabilidad vs S&P desde la entrada. Solo toca book=shadow. Reversible.

Uso (desde backend/):  uv run --system-certs python scripts/apply_proposal_shadow.py
"""

from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.ledger import service as ledger  # noqa: E402
from app.models import BOOK_SHADOW, Proposal  # noqa: E402


def main() -> int:
    db = SessionLocal()
    prop = db.execute(select(Proposal).order_by(Proposal.id.desc())).scalars().first()
    if prop is None:
        print("No hay ninguna propuesta en la BD.")
        return 1

    buys = [it for it in (prop.items or []) if it.get("action") == "comprar"]
    if not buys:
        print("La última propuesta no tiene compras.")
        return 1

    existing = {p.ticker for p in ledger.open_positions(db, book=BOOK_SHADOW)}
    print(f"Propuesta #{prop.id} — {len(buys)} compras a materializar en SOMBRA.")
    print(f"Caja sombra disponible: {ledger.available_cash(db, BOOK_SHADOW)}\n")

    done = 0
    for it in buys:
        tkr = it["ticker"]
        if tkr in existing:
            print(f"  {tkr}: ya en cartera sombra, salto.")
            continue
        qty = it.get("target_shares") or it.get("delta_shares")
        px = it.get("price")
        if not qty or not px:
            print(f"  {tkr}: sin qty/price en la propuesta, salto.")
            continue
        try:
            ledger.record_buy(db, tkr, qty, px, order_ref=f"shadow-prop{prop.id}",
                              book=BOOK_SHADOW)
            print(f"  {tkr}: compra {qty} @ {px}  (peso {it.get('target_weight_pct')}%)  OK")
            done += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  {tkr}: FALLÓ -> {exc}")

    snap = ledger.snapshot(db, book=BOOK_SHADOW)
    print(f"\n{done} posiciones abiertas en sombra.")
    print(f"Caja restante: {snap.cash} | valor posiciones (a coste): {snap.positions_value} "
          f"| equity: {snap.equity}")
    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
