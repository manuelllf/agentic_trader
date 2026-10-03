"""Ownership, batching, portfolio comparison, and review cursors against test Postgres only."""

from __future__ import annotations

import os
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

EMISOR = "https://proyecto.supabase.co"
RECETA = {
    "reglas": [], "excluidas": [], "pregunta": None,
    "pesos": {"negocio": 50, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 0},
    "n_empresas": 5, "reparto": "igual", "max_por_sector": 0,
}


@pytest.fixture
def api(monkeypatch):  # noqa: ANN001, ANN201
    psycopg = pytest.importorskip("psycopg")
    import jwt
    from cryptography.hazmat.primitives.asymmetric import ec
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db
    from app.liga import auth
    from app.liga import db as liga_db
    from app.liga.rutas import router

    key = ec.generate_private_key(ec.SECP256R1())

    class JWKS:
        def get_signing_key_from_jwt(self, _token):  # noqa: ANN001, ANN202
            return type("SigningKey", (), {"key": key.public_key()})()

    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: JWKS())
    engine = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(liga_db, "SessionLocal", factory)
    monkeypatch.setattr(app_db, "SessionLocal", factory)

    def headers(uid: str) -> dict[str, str]:
        now = int(time.time())
        claims = {"sub": uid, "aud": "authenticated", "role": "authenticated",
                  "iss": EMISOR + "/auth/v1", "exp": now + 3600, "iat": now, "aal": "aal1"}
        token = jwt.encode(claims, key, algorithm="ES256")
        return {"Authorization": f"Bearer {token}"}

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    cx = psycopg.connect(URL, autocommit=True)
    created_users: list[uuid.UUID] = []
    created_seasons: list[int] = []
    created_strategies: list[uuid.UUID] = []
    statements: list[str] = []

    def user() -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email) values (%s, %s)",
                   (uid, f"{uid.hex[:12]}@prueba.local"))
        created_users.append(uid)
        return str(uid)

    def strategy(uid: str, name: str) -> tuple[str, int]:
        response = client.post("/liga/estrategias", json={
            "nombre": name,
            "escudo": {"forma": "escudo", "dibujo": "liso",
                       "color1": "#0B6E68", "color2": "#FFFFFF"},
        }, headers=headers(uid))
        assert response.status_code == 201, response.text
        eid = response.json()["id"]
        created_strategies.append(uuid.UUID(eid))
        response = client.post(f"/liga/estrategias/{eid}/receta", json=RECETA,
                               headers=headers(uid))
        assert response.status_code == 201, response.text
        return eid, response.json()["id"]

    def rounds(eid: str, recipe_id: int, tickers: list[str], *, with_results: bool = True
               ) -> list[int]:
        season_id = cx.execute(
            "insert into liga.temporadas (nombre, n_jornadas, cuenta, estado) "
            "values ('Seguimiento test', 12, true, 'cerrada') returning id"
        ).fetchone()[0]
        created_seasons.append(season_id)
        ids: list[int] = []
        for index, ticker in enumerate(tickers, start=1):
            base = date.today() - timedelta(days=(len(tickers) - index + 1) * 30)
            jid = cx.execute(
                "insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin, "
                "cierre_inscripcion, estado, sp_rentabilidad) "
                "values (%s, %s, %s, %s, %s, %s, 'cerrada', 2) returning id",
                (season_id, index, base, base + timedelta(days=1), base + timedelta(days=30),
                 datetime.now(UTC) - timedelta(days=30 * (len(tickers) - index + 1))),
            ).fetchone()[0]
            inscripcion_id = cx.execute(
                "insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, estado) "
                "values (%s, %s, %s, 'cerrada') returning id", (jid, eid, recipe_id),
            ).fetchone()[0]
            cx.execute("insert into liga.posiciones (inscripcion_id, ticker, peso) "
                       "values (%s, %s, 50)", (inscripcion_id, ticker))
            if with_results:
                cx.execute("insert into liga.resultados (inscripcion_id, rentabilidad, puntos) "
                           "values (%s, %s, 3)", (inscripcion_id, index * 1.5))
            ids.append(inscripcion_id)
        return ids

    def count_summary_queries(_conn, _cursor, statement, _parameters, _context, _many):
        if "liga.estrategias" in statement and "select" in statement.lower():
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", count_summary_queries)
    try:
        yield client, headers, user, strategy, rounds, cx, statements
    finally:
        event.remove(engine, "before_cursor_execute", count_summary_queries)
        cx.execute("set session_replication_role = replica")
        for season_id in created_seasons:
            cx.execute("delete from liga.inscripciones where jornada_id in "
                       "(select id from liga.jornadas where temporada_id = %s)", (season_id,))
            cx.execute("delete from liga.jornadas where temporada_id = %s", (season_id,))
            cx.execute("delete from liga.temporadas where id = %s", (season_id,))
        cx.execute("set session_replication_role = origin")
        for uid in created_users:
            cx.execute("delete from liga.estrategias_revisadas where usuario_id = %s", (uid,))
        for eid in created_strategies:
            cx.execute("delete from liga.estrategias where id = %s", (eid,))
            cx.execute("delete from liga.recetas where estrategia_id = %s", (eid,))
        for uid in created_users:
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        engine.dispose()


def test_summary_is_owned_batched_and_compares_latest_two_portfolios(api) -> None:  # noqa: ANN001
    client, headers, user, strategy, rounds, _cx, statements = api
    owner, other = user(), user()
    eid, recipe_id = strategy(owner, "Mi cartera")
    other_id, _ = strategy(other, "Estrategia ajena")
    ids = rounds(eid, recipe_id, ["AAA", "BBB", "CCC"])
    statements.clear()

    response = client.get("/liga/seguimiento", headers=headers(owner))
    assert response.status_code == 200, response.text
    rows = response.json()
    assert [row["estrategia_id"] for row in rows] == [eid]
    row = rows[0]
    assert row["ultima_inscripcion_id"] == ids[-1]
    assert row["ultimo_resultado_inscripcion_id"] == ids[-1]
    assert row["primera_revision"] is True
    assert Decimal(row["resultado"]["rentabilidad"]) == Decimal("4.5000")
    assert Decimal(row["resultado"]["sp500"]) == Decimal("2")
    assert row["acumulado"]["periodos"] == 3
    assert Decimal(row["acumulado"]["rentabilidad"]) == Decimal("9.2495")
    assert Decimal(row["acumulado"]["sp500"]) == Decimal("6.1208")
    assert Decimal(row["acumulado"]["diferencia_pp"]) == Decimal("3.1287")
    assert row["acumulado"]["incompleta"] is False
    assert row["cambio_cartera"]["jornada_anterior_id"] < row["cambio_cartera"]["jornada_actual_id"]
    assert row["cambio_cartera"]["tickers_anteriores"] == ["BBB"]
    assert row["cambio_cartera"]["tickers_actuales"] == ["CCC"]
    assert row["cambio_cartera"]["entradas"] == ["CCC"]
    assert row["cambio_cartera"]["salidas"] == ["BBB"]
    # All three rounds are summarized in one database query, rather than per-strategy queries.
    assert len(statements) == 1

    other_rows = client.get("/liga/seguimiento", headers=headers(other)).json()
    assert [row["estrategia_id"] for row in other_rows] == [other_id]


def test_review_ack_is_owner_scoped_and_monotonic(api) -> None:  # noqa: ANN001
    client, headers, user, strategy, rounds, _cx, _statements = api
    owner = user()
    eid, recipe_id = strategy(owner, "Mi estrategia")
    second_id, second_recipe = strategy(owner, "Otra mía")
    ids = rounds(eid, recipe_id, ["AAA", "BBB"])
    foreign_strategy_ids = rounds(second_id, second_recipe, ["DDD"])

    # A forged cursor from a different strategy is rejected without writing a partial marker.
    forged = client.post("/liga/seguimiento/revisado", headers=headers(owner), json={
        "items": [{"estrategia_id": eid, "inscripcion_id": foreign_strategy_ids[0],
                   "resultado_inscripcion_id": ids[-1]}],
    })
    assert forged.status_code == 404, forged.text
    before_ack = client.get("/liga/seguimiento", headers=headers(owner)).json()
    first_row = next(row for row in before_ack if row["estrategia_id"] == eid)
    assert first_row["primera_revision"] is True

    ack = {"estrategia_id": eid, "inscripcion_id": ids[-1],
           "resultado_inscripcion_id": ids[-1]}
    response = client.post("/liga/seguimiento/revisado", headers=headers(owner),
                           json={"items": [ack]})
    assert response.status_code == 200, response.text
    assert response.json() == {"actualizadas": 1}

    stale = {**ack, "inscripcion_id": ids[0], "resultado_inscripcion_id": ids[0]}
    response = client.post("/liga/seguimiento/revisado", headers=headers(owner),
                           json={"items": [stale]})
    assert response.status_code == 200, response.text
    row = next(r for r in client.get("/liga/seguimiento", headers=headers(owner)).json()
               if r["estrategia_id"] == eid)
    assert row["primera_revision"] is False
    assert row["resultado_nuevo"] is False
    assert row["ultima_revision_inscripcion_id"] == ids[-1]
    assert row["ultima_revision_resultado_inscripcion_id"] == ids[-1]


def test_changes_since_review_use_seen_portfolio_not_just_previous_round(api) -> None:  # noqa: ANN001
    client, headers, user, strategy, rounds, _cx, statements = api
    owner = user()
    eid, recipe_id = strategy(owner, "Seguimiento completo")
    ids = rounds(eid, recipe_id, ["AAA", "BBB", "CCC"])
    cursor = {"estrategia_id": eid, "inscripcion_id": ids[0],
              "resultado_inscripcion_id": ids[0]}
    ack = client.post("/liga/seguimiento/revisado", headers=headers(owner),
                      json={"items": [cursor]})
    assert ack.status_code == 200, ack.text
    statements.clear()
    row = client.get("/liga/seguimiento", headers=headers(owner)).json()[0]
    assert len(statements) == 1
    assert row["cambio_cartera"]["salidas"] == ["BBB"]
    assert row["cambio_desde_revision"]["salidas"] == ["AAA"]
    assert row["cambio_desde_revision"]["entradas"] == ["CCC"]
    assert row["cambio_desde_revision"]["nueva_desde_revision"] is True

    ack = client.post("/liga/seguimiento/revisado", headers=headers(owner), json={
        "items": [{**cursor, "inscripcion_id": ids[-1], "resultado_inscripcion_id": ids[-1]}],
    })
    assert ack.status_code == 200, ack.text
    row = client.get("/liga/seguimiento", headers=headers(owner)).json()[0]
    assert row["cambio_desde_revision"]["entradas"] == []
    assert row["cambio_desde_revision"]["salidas"] == []
    assert row["cambio_desde_revision"]["nueva_desde_revision"] is False
