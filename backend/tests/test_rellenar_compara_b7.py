"""B7 fase 1 (docs/liguilla/cambios-bbdd.md): `scripts/rellenar_b7.py` y `scripts/compara_b7.py`
contra el Postgres de pruebas real (se salta sin `LIGA_TEST_DATABASE_URL` -- necesitan jsonb/text[]
de verdad). Cubre lo que el test dorado (`test_b6_b7_dorado.py`) no toca: relleno + comparación
sobre snapshots YA EXISTENTES en local, y que `rellenar_b7` es idempotente (no reprocesa lo ya
hecho ni se cuelga con un snapshot sin ninguna métrica cruda -- ver el docstring de `rellenar()`).

Misma transacción-que-se-revierte que el test dorado: nada de esto deja rastro en la BD."""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas en la metadata)
from app.models import Foto, FundamentalsSnapshot, FundamentalsSnapshotMetric

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

N_SNAPSHOTS = 3


@contextmanager
def _sesion_revertible():
    """Ver `test_b6_b7_dorado.py`: mismo patrón SAVEPOINT + rollback de la transacción externa."""
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


def _foto_con_snapshots_existentes(db, n: int = N_SNAPSHOTS) -> int:  # noqa: ANN001
    """Cuelga `n` snapshots YA capturados (con métricas de verdad, de fotos antiguas) de una
    foto sintética -- reasigna `foto_id` en vez de inventar filas nuevas, para probar contra
    datos reales de local (regla de "no fake data")."""
    ids = [r[0] for r in db.query(FundamentalsSnapshot.id)
          .join(FundamentalsSnapshotMetric,
                FundamentalsSnapshotMetric.fundamentals_snapshot_id == FundamentalsSnapshot.id)
          .distinct().order_by(FundamentalsSnapshot.id.desc()).limit(n).all()]
    assert len(ids) == n, f"Hacen falta >= {n} snapshots con métricas en la BD de pruebas local."
    foto = Foto(alcance="nasdaq", estado="cortada", fin=datetime.now(UTC))
    db.add(foto)
    db.flush()
    db.query(FundamentalsSnapshot).filter(FundamentalsSnapshot.id.in_(ids)).update(
        {"foto_id": foto.id}, synchronize_session=False)
    db.commit()
    return foto.id


def test_rellenar_deja_metricas_y_titulares_iguales_a_la_tabla_vieja() -> None:
    import scripts.compara_b7 as compara
    import scripts.rellenar_b7 as rellenar_mod

    with _sesion_revertible() as db:
        foto_id = _foto_con_snapshots_existentes(db)

        filas = db.query(FundamentalsSnapshot).filter(FundamentalsSnapshot.foto_id == foto_id).all()
        assert all(f.metricas is None for f in filas)   # todavía sin rellenar

        n = rellenar_mod.rellenar(db, foto_id, lote=2)   # lote < N_SNAPSHOTS: fuerza 2 vueltas
        assert n == N_SNAPSHOTS

        problemas = []
        for fila in db.query(FundamentalsSnapshot).filter(
                FundamentalsSnapshot.foto_id == foto_id).all():
            viejo_m, viejo_t = compara._viejo(db, fila.id)
            problemas += compara._comparar(fila.ticker, viejo_m, viejo_t,
                                           fila.metricas, fila.titulares)
        assert problemas == []   # compara_b7 sobre una foto ya rellena: sin diferencias


def test_rellenar_no_se_cuelga_con_metricas_vacias_y_sigue_siendo_idempotente() -> None:
    """El caso que provocó el bucle infinito real: un snapshot con CERO filas crudas guarda
    `metricas = NULL` (mismo criterio que `foto_guardar`). El cursor por `id` (no por "sigue
    NULL") hace que una corrida SIEMPRE termine -- para este caso concreto puede reprocesar el
    mismo snapshot vacío en corridas sucesivas (no hay forma de distinguir "vacío sin tocar" de
    "vacío ya comprobado" sin una columna centinela aparte), pero el resultado converge: sigue
    NULL, nunca se corrompe ni se duplica nada. El snapshot con datos de verdad, en cambio, SÍ
    se salta en la segunda corrida -- es la parte que de verdad importa."""
    import scripts.rellenar_b7 as rellenar_mod

    with _sesion_revertible() as db:
        foto = Foto(alcance="nasdaq", estado="cortada", fin=datetime.now(UTC))
        db.add(foto)
        db.flush()
        con_datos_id = _foto_con_snapshots_existentes(db, n=1)
        vacio = FundamentalsSnapshot(ticker="ZZZZ_VACIO", foto_id=foto.id)
        db.add(vacio)
        db.commit()
        # Las dos fotos comparten ventana de `id` para que un solo `rellenar()` por foto baste.
        con_datos = db.query(FundamentalsSnapshot).filter(
            FundamentalsSnapshot.foto_id == con_datos_id).one()

        n1_datos = rellenar_mod.rellenar(db, con_datos_id, lote=500)
        n1_vacio = rellenar_mod.rellenar(db, foto.id, lote=500)
        assert n1_datos == 1 and n1_vacio == 1
        db.refresh(con_datos)
        db.refresh(vacio)
        assert con_datos.metricas is not None
        assert vacio.metricas is None   # cero claves crudas es válido, no es "sin procesar"

        n2_datos = rellenar_mod.rellenar(db, con_datos_id, lote=500)
        n2_vacio = rellenar_mod.rellenar(db, foto.id, lote=500)
        assert n2_datos == 0            # el que sí tenía datos: NO se vuelve a tocar
        assert n2_vacio in (0, 1)       # el vacío: puede repetirse, nunca se cuelga ni corrompe
        db.refresh(vacio)
        assert vacio.metricas is None
