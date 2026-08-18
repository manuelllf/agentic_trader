"""Migración de scan_audit/scores: columnas nuevas sobre un esquema VIEJO ya poblado.

Monta a mano una DB con las tablas tal como eran antes de entry_lane/had_prior_thesis/
news_used/target_raw/target_flagged, corre `_migrate_books` y comprueba que las columnas
aparecen, que los datos previos sobreviven, y que la migración es idempotente (correrla dos
veces no rompe nada).
"""

from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

from app.db import _migrate_books


def _cols(engine, table: str) -> set[str]:
    with engine.connect() as conn:
        return {c["name"] for c in inspect(conn).get_columns(table)}


def test_migracion_anade_columnas_y_conserva_datos(tmp_path):
    db_path = tmp_path / "vieja.db"
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.begin() as conn:
        conn.execute(text(
            """
            CREATE TABLE scan_audit (
                id INTEGER PRIMARY KEY,
                scan_at DATETIME,
                ticker VARCHAR(16),
                sector VARCHAR(48),
                prescore FLOAT,
                price FLOAT,
                reached_deep BOOLEAN,
                deep_score INTEGER,
                selected BOOLEAN,
                funded BOOLEAN,
                decide BOOLEAN,
                weight_pct FLOAT,
                stage VARCHAR(16)
            )
            """
        ))
        conn.execute(text(
            """
            CREATE TABLE scores (
                id INTEGER PRIMARY KEY,
                created_at DATETIME,
                ticker VARCHAR(16),
                sector VARCHAR(48),
                score INTEGER,
                headline VARCHAR,
                report VARCHAR,
                price FLOAT,
                market_cap FLOAT,
                target_price FLOAT,
                held BOOLEAN,
                on_watchlist BOOLEAN
            )
            """
        ))
        conn.execute(text(
            "INSERT INTO scan_audit (id, ticker, sector, stage) "
            "VALUES (1, 'ABC', 'Tech', 'selected')"
        ))
        conn.execute(text(
            "INSERT INTO scores (id, ticker, score, held) VALUES (1, 'ABC', 77, 1)"
        ))

    with engine.connect() as conn:
        _migrate_books(conn)

    sa_cols = _cols(engine, "scan_audit")
    sc_cols = _cols(engine, "scores")
    assert "entry_lane" in sa_cols
    assert "had_prior_thesis" not in sa_cols   # retirada: ya no se crea en DBs nuevas
    assert {"news_used", "target_raw", "target_flagged"} <= sc_cols

    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT ticker, sector, stage, entry_lane FROM scan_audit WHERE id=1"
        )).one()
        assert row.ticker == "ABC"
        assert row.sector == "Tech"
        assert row.stage == "selected"
        assert row.entry_lane is None

        row2 = conn.execute(text(
            "SELECT ticker, score, held, news_used, target_raw, target_flagged "
            "FROM scores WHERE id=1"
        )).one()
        assert row2.ticker == "ABC"
        assert row2.score == 77
        assert row2.held == 1
        assert row2.news_used is None
        assert row2.target_raw is None
        assert row2.target_flagged == 0

    # Idempotente: correrla otra vez no debe fallar ni duplicar columnas.
    with engine.connect() as conn:
        _migrate_books(conn)

    assert _cols(engine, "scan_audit") == sa_cols
    assert _cols(engine, "scores") == sc_cols

    # La nota con dos decimales sobre el esquema VIEJO (columna declarada INTEGER): en SQLite la
    # afinidad INTEGER solo convierte lo que quepa sin pérdida, así que 78,37 se guarda tal cual y
    # no hay nada que migrar. Es exactamente por esto que `_migrate_score_decimal` no hace nada
    # aquí — y por lo que en Postgres SÍ tiene que hacer algo (ver el test de abajo).
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO scores (id, ticker, score) VALUES (2, 'DEC', 78.37)"))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT score FROM scores WHERE id=2")).scalar() == 78.37


def test_las_columnas_de_nota_son_reales_en_el_orm() -> None:
    """Guardarraíl del cambio a dos decimales, y el más importante de los dos.

    En Postgres (producción) insertar 78,37 en una columna INTEGER **no falla**: redondea a 78 en
    silencio. Si alguien devuelve cualquiera de estas cuatro columnas a Integer, el despliegue
    arrancaría bien, los tests de prompts seguirían verdes y las notas volverían a apelmazarse sin
    un solo error en los logs. Este test es lo único que lo cazaría.
    """
    from sqlalchemy import Float

    from app.db import _COLUMNAS_NOTA
    from app.models import Approval, ScanAudit, Score, Watchlist

    tablas = {m.__tablename__: m for m in (Score, Watchlist, ScanAudit, Approval)}
    assert set(_COLUMNAS_NOTA) == {
        ("scores", "score"), ("watchlist", "score"),
        ("scan_audit", "deep_score"), ("approvals", "score"),
    }
    for tabla, columna in _COLUMNAS_NOTA:
        tipo = tablas[tabla].__table__.c[columna].type
        assert isinstance(tipo, Float), f"{tabla}.{columna} debe ser Float, es {tipo!r}"
