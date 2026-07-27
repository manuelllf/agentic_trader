"""Imprime el embudo de un escaneo desde la tabla histórica `scan_audit` (diagnóstico).

Uso (desde la carpeta backend):
    uv run python scripts/scan_funnel.py            # el último escaneo
    uv run python scripts/scan_funnel.py --lista    # qué escaneos hay guardados
    uv run python scripts/scan_funnel.py 2026-07-21 # el escaneo de ese día

Muestra, por sector, cuántos nombres se pre-scorearon, cuántos llegaron al profundo y cuántos se
seleccionaron/quedaron en cartera — para ver de un vistazo que el corte ya no colapsa en un solo
sector. Read-only: no toca nada.
"""

from __future__ import annotations

import sys
from collections import Counter

from sqlalchemy import func

from app import models  # noqa: F401  (registra las tablas en la metadata)
from app.db import SessionLocal
from app.models import ScanAudit


def _escaneos(db) -> list:  # noqa: ANN001
    """Las fechas de los escaneos guardados, de más reciente a más antiguo."""
    rows = db.query(ScanAudit.scan_at, func.count(ScanAudit.id)).group_by(ScanAudit.scan_at).all()
    return sorted(rows, key=lambda r: r[0], reverse=True)


def main() -> None:
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    db = SessionLocal()
    try:
        escaneos = _escaneos(db)
        if not escaneos:
            print("No hay traza de auditoría todavía (lanza un escaneo primero).")
            return

        if arg == "--lista":
            print(f"{len(escaneos)} escaneo(s) guardado(s):")
            for at, n in escaneos:
                print(f"  {at:%Y-%m-%d %H:%M}  ·  {n} filas")
            return

        at = (next((a for a, _n in escaneos if f"{a:%Y-%m-%d}" == arg), None) if arg
              else escaneos[0][0])
        if at is None:
            print(f"No hay ningún escaneo del {arg}. Prueba con --lista.")
            return

        rows = db.query(ScanAudit).filter(ScanAudit.scan_at == at).all()
        pre = Counter(r.sector for r in rows if r.prescore is not None)
        deep = Counter(r.sector for r in rows if r.reached_deep)
        sel = Counter(r.sector for r in rows if r.selected)
        fund = Counter(r.sector for r in rows if r.funded)
        sin_datos = sum(1 for r in rows if r.stage == "datos")
        pre_error = sum(1 for r in rows if r.stage == "prescore_error")

        print(f"Escaneo {at:%Y-%m-%d %H:%M} · {sum(pre.values())} pre-scoreados · "
              f"{sum(deep.values())} al profundo · {sum(sel.values())} seleccionados · "
              f"{sum(fund.values())} en cartera · {sin_datos} sin datos · "
              f"{pre_error} pre-scores fallidos\n")
        print(f"{'Sector':<26}{'pre':>6}{'deep':>6}{'sel':>5}{'cart':>6}")
        print("-" * 49)
        for sector in sorted(pre, key=lambda s: -pre[s]):
            print(f"{sector:<26}{pre[sector]:>6}{deep.get(sector, 0):>6}"
                  f"{sel.get(sector, 0):>5}{fund.get(sector, 0):>6}")
        if len(escaneos) > 1:
            print(f"\n({len(escaneos)} escaneos guardados — `--lista` para verlos)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
