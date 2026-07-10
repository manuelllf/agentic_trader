"""Lectura READ-ONLY de posiciones + balances reales de IBKR (no envía órdenes).

Uso (desde backend/):  uv run --system-certs python scripts/ibkr_positions.py
"""

from __future__ import annotations

import json
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from app.brokers import ibkr_web  # noqa: E402


def _try(label: str, fn):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        print(f"  ({label} falló: {exc})")
        return None


def main() -> int:
    broker = ibkr_web.IbkrWebBroker()
    c = broker._client  # noqa: SLF001
    acct = broker._account  # noqa: SLF001
    print(f"== Cuenta IBKR {acct} — posiciones y balances (read-only) ==\n")

    # --- Ledger / balances por divisa ---
    ledger = _try("ledger", lambda: c.get_ledger(acct).data)
    if ledger:
        print("BALANCES (por divisa):")
        for cur, row in ledger.items():
            if not isinstance(row, dict):
                continue
            print(f"  {cur}: cash={row.get('cashbalance')} "
                  f"nav={row.get('netliquidationvalue')} "
                  f"stockvalue={row.get('stockmarketvalue')}")
        print()

    # --- Posiciones ---
    positions = None
    for name, call in (
        ("positions", lambda: c.positions(acct).data),
        ("portfolio_positions", lambda: c.portfolio_positions(acct).data),
    ):
        positions = _try(name, call)
        if positions is not None:
            break

    print("POSICIONES:")
    if not positions:
        print("  (ninguna posición abierta, o sin datos)")
    else:
        for p in positions:
            if not isinstance(p, dict):
                print(f"  {p}")
                continue
            print(f"  {p.get('contractDesc') or p.get('ticker')}: "
                  f"qty={p.get('position')} "
                  f"mktPrice={p.get('mktPrice')} "
                  f"mktValue={p.get('mktValue')} "
                  f"avgCost={p.get('avgCost')} "
                  f"uPnL={p.get('unrealizedPnl')} "
                  f"({p.get('currency')})")
        print("\n--- RAW (JSON) ---")
        print(json.dumps(positions, indent=2, default=str)[:4000])
    return 0


if __name__ == "__main__":
    import os

    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
