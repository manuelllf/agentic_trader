"""Imprime el embudo del ÚLTIMO escaneo desde la tabla `scan_audit` (diagnóstico del rediseño).

Uso (desde la carpeta backend):
    uv run python scripts/scan_funnel.py

Muestra, por sector, cuántos nombres se pre-scorearon, cuántos llegaron al profundo y cuántos se
seleccionaron/quedaron en cartera — para ver de un vistazo que el corte ya no colapsa en un solo
sector. Read-only: no toca nada.
"""

from __future__ import annotations

from collections import Counter

from app import models  # noqa: F401  (registra las tablas en la metadata)
from app.db import SessionLocal
from app.models import ScanAudit


def main() -> None:
    db = SessionLocal()
    try:
        rows = db.query(ScanAudit).all()
        if not rows:
            print("No hay traza de auditoría todavía (lanza un escaneo primero).")
            return

        pre = Counter(r.sector for r in rows if r.prescore is not None)
        deep = Counter(r.sector for r in rows if r.reached_deep)
        sel = Counter(r.sector for r in rows if r.selected)
        fund = Counter(r.sector for r in rows if r.funded)
        sin_datos = sum(1 for r in rows if r.stage == "datos")

        print(f"Escaneo {rows[0].scan_at:%Y-%m-%d %H:%M} · {sum(pre.values())} pre-scoreados · "
              f"{sum(deep.values())} al profundo · {sum(sel.values())} seleccionados · "
              f"{sum(fund.values())} en cartera · {sin_datos} sin datos\n")
        print(f"{'Sector':<26}{'pre':>6}{'deep':>6}{'sel':>5}{'cart':>6}")
        print("-" * 49)
        for sector in sorted(pre, key=lambda s: -pre[s]):
            print(f"{sector:<26}{pre[sector]:>6}{deep.get(sector, 0):>6}"
                  f"{sel.get(sector, 0):>5}{fund.get(sector, 0):>6}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
