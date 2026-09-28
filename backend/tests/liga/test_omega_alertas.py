"""Qué señales de la sala cuentan como alerta de llegada para Omega de la casa (solo lectura de
`momentum_senales`). Contra el Postgres de pruebas: todo se deshace al final."""

from __future__ import annotations

import os
from datetime import date

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.liga.procesos import omega

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

_INSERT = text("""
    insert into momentum_senales (ticker, sector, tipo, entry_date, entry_price, ref_label,
        ref_price, caida_pct, estado, resuelta, exit_date, created_at)
    values (:t, 'Industrials', 'suelo', :e, 50, 'max', 70, 30, :estado, :res, :x, :c)""")


def test_solo_cuentan_las_alertas_que_de_verdad_llegan_ese_dia() -> None:
    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    with Session(motor) as db:
        try:
            filas = [
                # Llega hoy y sigue viva: cuenta.
                ("ZQVIVA", "2026-10-06", "nueva", False, None, "2026-10-06 15:00+00"),
                # Llega hoy y se resuelve después: fue una alerta ese día, cuenta.
                ("ZQRAPI", "2026-10-06", "nueva", True, "2026-10-09", "2026-10-06 15:00+00"),
                # Histórica insertada hoy ya resuelta (ticker incorporado tarde): no cuenta.
                ("ZQVIEJA", "2026-07-01", "nueva", True, "2026-08-12", "2026-10-06 15:00+00"),
                # Descartada por el filtro manual: no cuenta.
                ("ZQDESC", "2026-10-06", "descartada", False, None, "2026-10-06 15:00+00"),
            ]
            for t, e, estado, res, x, c in filas:
                db.execute(_INSERT, {"t": t, "e": e, "estado": estado, "res": res, "x": x,
                                     "c": c})
            alertas = omega.alertas(db, date(2026, 10, 6), date(2026, 10, 6),
                                    capitalizacion=lambda _t: None)
            assert sorted(a.ticker for a in alertas) == ["ZQRAPI", "ZQVIVA"]
        finally:
            db.rollback()
    motor.dispose()
