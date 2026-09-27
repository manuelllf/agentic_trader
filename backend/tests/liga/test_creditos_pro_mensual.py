"""Créditos Pro del mes (plan §16): sin importe en `liga.ajustes` no da nada, y repetirlo con el
mismo `jornada_id` no duplica el movimiento (la idempotencia la da `cargar_creditos`). Contra el
Postgres de pruebas; se salta sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import os
import uuid

import pytest

psycopg = pytest.importorskip("psycopg")

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.liga import gestion  # noqa: E402

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def fabrica():
    engine = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    conn = engine.connect()
    trans = conn.begin()

    def nueva() -> Session:
        return Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False)

    try:
        yield nueva
    finally:
        trans.rollback()
        conn.close()
        engine.dispose()


def _usuario(db: Session, pro: bool) -> uuid.UUID:
    uid = uuid.uuid4()
    db.execute(text("insert into auth.users (id, email) values (:i, :e)"),
              {"i": uid, "e": f"{uid.hex[:12]}@prueba.local"})
    if pro:
        db.execute(text(
            "insert into liga.planes_usuario (usuario_id, plan, origen) "
            "values (:u, 'pro', 'admin')"), {"u": uid})
    return uid


def test_sin_importe_definido_no_da_nada(fabrica) -> None:  # noqa: ANN001
    db = fabrica()
    _usuario(db, pro=True)
    r = gestion.dar_creditos_pro_mensual(db, jornada_id=1, actor=None)
    assert r == {"dado": False, "motivo": "sin importe definido en liga.ajustes"}
    assert db.execute(text(
        "select count(*) from liga.creditos_movimientos")).scalar() == 0


def test_es_idempotente_por_jornada_y_solo_da_a_quien_es_pro(fabrica) -> None:  # noqa: ANN001
    db = fabrica()
    pro = _usuario(db, pro=True)
    gratis = _usuario(db, pro=False)
    db.execute(text(
        "insert into liga.ajustes (clave, valor) values ('creditos.pro_mensual', '2.5')"))

    r1 = gestion.dar_creditos_pro_mensual(db, jornada_id=42, actor=None)
    assert r1 == {"dado": True, "usuarios": 1, "importe": "2.5"}
    r2 = gestion.dar_creditos_pro_mensual(db, jornada_id=42, actor=None)
    assert r2 == {"dado": True, "usuarios": 1, "importe": "2.5"}

    saldo_pro = db.execute(text(
        "select coalesce(sum(importe), 0) from liga.creditos_movimientos where usuario_id = :u"),
        {"u": pro}).scalar()
    assert saldo_pro == 2.5
    saldo_gratis = db.execute(text(
        "select coalesce(sum(importe), 0) from liga.creditos_movimientos where usuario_id = :u"),
        {"u": gratis}).scalar()
    assert saldo_gratis == 0

    # Otra jornada sí es un movimiento nuevo (la clave de idempotencia es por jornada).
    gestion.dar_creditos_pro_mensual(db, jornada_id=43, actor=None)
    total = db.execute(text(
        "select count(*) from liga.creditos_movimientos where usuario_id = :u"), {"u": pro}
                       ).scalar()
    assert total == 2
