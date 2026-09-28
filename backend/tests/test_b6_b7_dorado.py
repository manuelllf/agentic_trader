"""Test dorado de B6+B7 fase 1 (docs/liguilla/cambios-bbdd.md): el texto de fundamentales que ve
el LLM (`_fundamentals_text`) no cambia aunque `foto_guardar` deje de escribir las 11 claves
repetidas (B6) y aunque también escriba `metricas`/`titulares` (B7 fase 1, doble escritura).

Contra el Postgres de pruebas real (se salta sin `LIGA_TEST_DATABASE_URL`): la foto de verdad
tiene jsonb/text[] y claves repetidas de yfinance que SQLite no reproduce fielmente, y el objetivo
es la foto tal cual está en local, no datos inventados (ver `docs/liguilla/cambios-bbdd.md` §2 y
la regla de "no fake data").

Todo el test corre en UNA transacción externa que se revierte al salir (`_sesion_revertible`):
ni siquiera los `db.commit()` de dentro de `foto_guardar` sobreviven -- el patrón estándar de
SQLAlchemy para escribir de verdad contra una BD real sin dejar rastro (SAVEPOINT que se
reabre tras cada commit, rollback de la transacción externa al final)."""

from __future__ import annotations

import os
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas en la metadata)
from app.models import (
    Foto,
    FundamentalsSnapshot,
    FundamentalsSnapshotMetric,
    FundamentalsSnapshotNews,
)
from app.screener import fundamentals as fund_mod
from app.screener.fundamentals import NameData

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

MIN_EMPRESAS = 50


@contextmanager
def _sesion_revertible():
    """Sesión sobre una transacción externa que SIEMPRE se revierte al salir, aunque el código
    bajo prueba llame a `db.commit()` (como `foto_guardar`) -- ver docstring del módulo."""
    engine = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    conexion = engine.connect()
    externa = conexion.begin()
    fabrica = sessionmaker(bind=conexion)
    sesion = fabrica()
    anidada = conexion.begin_nested()

    @event.listens_for(sesion, "after_transaction_end")
    def _reabrir_savepoint(sess, trans):  # noqa: ANN001, ARG001
        nonlocal anidada
        if not anidada.is_active:
            anidada = conexion.begin_nested()

    try:
        yield sesion
    finally:
        sesion.close()
        externa.rollback()
        conexion.close()
        engine.dispose()


def _crudas_viejas(db, snapshot_id: int) -> dict:  # noqa: ANN001
    """Las claves tal cual quedaron en la tabla vieja de ESTA fila -- incluidas las 11 de B6,
    porque estas filas se capturaron con el código de ANTES de B6."""
    return {m.clave: (m.valor_num if m.valor_num is not None else m.valor_texto)
           for m in db.query(FundamentalsSnapshotMetric)
           .filter(FundamentalsSnapshotMetric.fundamentals_snapshot_id == snapshot_id).all()}


def _titulares_viejos(db, snapshot_id: int) -> list[str]:  # noqa: ANN001
    return [n.texto for n in db.query(FundamentalsSnapshotNews)
           .filter(FundamentalsSnapshotNews.fundamentals_snapshot_id == snapshot_id)
           .order_by(FundamentalsSnapshotNews.posicion).all()]


def _muestra(db) -> list[FundamentalsSnapshot]:  # noqa: ANN001
    """Hasta 80 snapshots recientes con al menos una métrica cruda (no fotos sueltas vacías de
    otros tests) -- de tickers distintos a poder ser, para que la muestra sea representativa."""
    return (db.query(FundamentalsSnapshot)
           .join(FundamentalsSnapshotMetric,
                 FundamentalsSnapshotMetric.fundamentals_snapshot_id == FundamentalsSnapshot.id)
           .distinct()
           .order_by(FundamentalsSnapshot.captured_at.desc())
           .limit(80).all())


def test_texto_del_prompt_identico_antes_y_despues_de_b6_b7() -> None:
    with _sesion_revertible() as db:
        filas = _muestra(db)
        tickers = {f.ticker for f in filas}
        assert len(tickers) >= MIN_EMPRESAS, (
            f"Solo {len(tickers)} empresas distintas en la muestra de la BD de pruebas local "
            f"(hacen falta >= {MIN_EMPRESAS}) -- captura más fotos en liga-pg antes de correr "
            "esto.")

        # Foto sintética para colgar las filas "después" (foto_id es FK obligatoria en las filas
        # nuevas de este código, aunque las viejas puedan tener NULL).
        foto = Foto(alcance="nasdaq", estado="cortada")
        from datetime import UTC, datetime
        foto.fin = datetime.now(UTC)
        db.add(foto)
        db.flush()

        diffs: list[str] = []
        for fila in filas:
            crudas = _crudas_viejas(db, fila.id)
            titulares = _titulares_viejos(db, fila.id)

            # "Antes": el texto tal cual sale HOY de la tabla vieja, sin pasar por ningún código
            # nuevo (ni `foto_guardar` ni `_reponer_claves_repetidas`).
            antes = fund_mod._fundamentals_text({**crudas, "currentPrice": fila.price}, db=db)

            # "Después": una captura de mentira con LA MISMA info cruda que ya existía (como si
            # `gather()` la acabara de traer completa, con sus 11 repetidas incluidas) se guarda
            # con el `foto_guardar` NUEVO (que las filtra) y se relee con `foto_reciente`
            # NUEVO (que las repone) -- el camino real que corre cada escaneo.
            datos = NameData(
                ticker=fila.ticker, sector=fila.sector or "n/d", industry=fila.industry or "n/d",
                price=fila.price, fundamentals_text="", technical_text="",
                market_cap=fila.market_cap, news=titulares, earnings_text=fila.earnings_text or "",
                name=fila.name or "", pe_trailing=fila.pe_trailing, pe_forward=fila.pe_forward,
                high_52w=fila.high_52w, low_52w=fila.low_52w, currency=fila.currency,
                fundamentales_crudos=crudas,
            )
            fund_mod.foto_guardar(db, fila.ticker, datos, foto_id=foto.id)
            releida = fund_mod.foto_reciente(db, fila.ticker, ttl_h=float("inf"))
            assert releida is not None and releida.foto_id == foto.id

            if releida.fundamentals_text != antes:
                diffs.append(f"{fila.ticker} (snapshot {fila.id}): texto distinto")

        assert not diffs, f"{len(diffs)} empresa(s) con texto distinto: {diffs[:10]}"
