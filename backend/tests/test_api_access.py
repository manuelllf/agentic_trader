"""Tests del reparto público/protegido de la API y del teaser `/overview` de la portada.

Monta una app FastAPI mínima con los mismos dos routers que `main.py` (sin lifespan: nada de
scheduler ni init_db real) para poder golpear los endpoints con `TestClient` sobre una BD en
memoria, igual que el resto de tests usa una sesión SQLite `:memory:`.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth
from app import models  # noqa: F401  (registra las tablas)
from app.api.routes import public_router, router
from app.db import Base, get_db

PASSWORD = "clave-test-portada-1"


@pytest.fixture
def db():
    # StaticPool: TestClient ejecuta el endpoint en un hilo del threadpool de FastAPI; sin esto,
    # cada hilo abriría su PROPIA base ":memory:" vacía (una conexión = una BD en SQLite memoria).
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db, monkeypatch, tmp_path):
    monkeypatch.setattr(auth.settings, "app_password", PASSWORD)
    # Aísla la ruta de la memoria vectorial en un tmp: /admin/seed-memory escribe a fichero,
    # jamás debe tocar el agent_memory.db real durante los tests.
    monkeypatch.setattr(auth.settings, "memory_db_path", str(tmp_path / "mem.db"))
    # /macro llamaría a yfinance; en tests no hay red — régimen determinista de mentira.
    monkeypatch.setattr(
        "app.screener.macro.get_macro_regime",
        lambda: {"regime": "neutral", "spy_above_ma200": True, "vix": 15.0},
    )
    # /fx también iría a yfinance — cambio fijo de mentira (los tests que necesiten precios
    # concretos re-monkeypatchean live_prices por encima).
    monkeypatch.setattr("app.tracking.live_prices", lambda _t: {"EURUSD=X": 1.09})
    # /admin/universe-snapshot llamaría a NASDAQ; en tests no hay red — foto fija de mentira
    # (los tests que necesiten un resultado concreto re-monkeypatchean por encima).
    monkeypatch.setattr(
        "app.screener.universe.refresh_snapshot_and_report",
        lambda db: {"at": "2026-07-28T20:30:00+00:00", "size": 123},
    )
    app = FastAPI()
    app.include_router(public_router)
    app.include_router(router, dependencies=[Depends(auth.require_auth)])
    # El mismo handler 422 de la app real: el eco de inf/nan debe sanearse también aquí.
    from fastapi.exceptions import RequestValidationError

    from app.main import _validation_422
    app.add_exception_handler(RequestValidationError, _validation_422)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def token(client) -> str:
    # `client` ya fijó APP_PASSWORD vía monkeypatch antes de que esto se ejecute.
    return auth.login(PASSWORD)


# ---- reparto público / protegido --------------------------------------------

PUBLIC_GET_PATHS = [
    "/overview", "/ledger", "/performance", "/macro", "/config", "/demo/status",
    "/history", "/history?book=real", "/scan/report", "/scan/funnel", "/scan/outcomes",
]


def test_public_endpoints_respond_without_token(client) -> None:
    """Ninguno de los públicos debe exigir sesión (auth activa con APP_PASSWORD puesta)."""
    for path in PUBLIC_GET_PATHS:
        res = client.get(path)
        assert res.status_code != 401, f"{path} no debería exigir token (dio {res.status_code})"


PROTECTED_CALLS = [
    ("post", "/demo/run", None),
    ("post", "/ledger/allocate", {"amount": 100}),
    ("post", "/proposal/execute", None),
    ("post", "/proposal/execute/AAA", None),
    ("get", "/real", None),
    ("get", "/approvals", None),
    ("get", "/personal", None),
    ("get", "/push/key", None),
    ("get", "/scores", None),
    ("get", "/proposal", None),
    ("get", "/watchlist", None),
    ("post", "/admin/seed", {"version": 1, "tables": {"meta": [{"key": "x", "value": "y"}]}}),
    ("post", "/admin/seed-memory", {"anything": True}),
    ("get", "/admin/memory-status", None),
    ("post", "/admin/universe-snapshot", None),
    ("get", "/fx", None),
]


def _call(client, method: str, path: str, body: dict | None, headers: dict | None = None):
    kwargs: dict = {"headers": headers} if headers else {}
    if method == "post":
        kwargs["json"] = body
    return getattr(client, method)(path, **kwargs)


def test_protected_endpoints_reject_without_token(client) -> None:
    for method, path, body in PROTECTED_CALLS:
        res = _call(client, method, path, body)
        assert res.status_code == 401, f"{method.upper()} {path} debería exigir token"


def test_scan_report_shape(client, token, db) -> None:
    """Sin informe → {"report": null}; con informe en Meta → lo devuelve tal cual."""
    from app.models import Meta

    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/scan/report", headers=headers).json() == {"report": None}

    db.merge(Meta(key="last_scan_report",
                  value='{"mode": "observatorio", "error": null, "issues": []}'))
    db.commit()
    rep = client.get("/scan/report", headers=headers).json()["report"]
    assert rep["mode"] == "observatorio" and rep["issues"] == []


def test_protected_endpoints_work_with_token(client, token) -> None:
    """Con token válido, cada protegido pasa la autenticación (deja de dar 401)."""
    headers = {"Authorization": f"Bearer {token}"}
    for method, path, body in PROTECTED_CALLS:
        res = _call(client, method, path, body, headers)
        assert res.status_code != 401, f"{method.upper()} {path} con token dio 401"
    # Los de solo-lectura, sin dependencias externas (BD vacía), deben ir limpios a 200.
    assert client.get("/real", headers=headers).status_code == 200
    assert client.get("/approvals", headers=headers).status_code == 200
    assert client.get("/personal", headers=headers).status_code == 200
    assert client.get("/push/key", headers=headers).status_code == 200
    assert client.get("/scores", headers=headers).status_code == 200
    assert client.get("/proposal", headers=headers).status_code == 200
    assert client.get("/watchlist", headers=headers).status_code == 200
    assert client.post("/ledger/allocate", json={"amount": 100}, headers=headers).status_code == 200


# ---- /overview ----------------------------------------------------------------

def test_overview_shape_empty_db(client) -> None:
    """BD vacía: la portada no debe reventar, todo en null/0 y sin exigir sesión."""
    res = client.get("/overview")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"shadow", "real"}
    assert set(body["shadow"].keys()) == {"return_pct", "spy_pct", "alpha_pct", "since", "positions"}
    assert body["shadow"]["return_pct"] is None
    assert body["shadow"]["since"] is None
    assert body["shadow"]["positions"] == 0
    assert body["real"] == {"unrealized_pct": None}


def test_overview_real_side_only_unrealized_pct(db, client, monkeypatch) -> None:
    """El lado `real` NUNCA debe llevar importes, tickers ni nº de posiciones — solo el %."""
    from app import tracking
    from app.ledger import service as ledger
    from app.models import BOOK_REAL

    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"HIG": 120.0})
    ledger.allocate(db, 1000, book=BOOK_REAL)
    ledger.record_buy(db, "HIG", 5, 100, "seed", book=BOOK_REAL)  # coste 500, ahora vale 600

    res = client.get("/overview")
    assert res.status_code == 200
    body = res.json()
    assert set(body["real"].keys()) == {"unrealized_pct"}
    assert body["real"]["unrealized_pct"] == 20.0  # (600-500)/500 * 100
    assert "HIG" not in res.text          # ni ticker...
    assert "500" not in res.text          # ...ni importes en la respuesta


def test_overview_shadow_reuses_performance(db, client, monkeypatch) -> None:
    """El lado sombra debe coincidir exactamente con lo que ya da /performance (mismo cálculo,
    sin duplicar aritmética)."""
    from app import tracking
    from app.ledger import service as ledger

    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"AAA": 110.0})
    monkeypatch.setattr(tracking, "_spy_reference", lambda *a, **k: None)  # sin red para el SPY
    ledger.allocate(db, 1000)
    ledger.record_buy(db, "AAA", 10, 100, "seed")

    perf = client.get("/performance").json()
    body = client.get("/overview").json()
    assert body["shadow"]["return_pct"] == perf["portfolio_return_pct"]
    assert body["shadow"]["alpha_pct"] == perf["alpha_pct"]
    assert body["shadow"]["since"] == perf["since"]
    assert body["shadow"]["positions"] == 1


# ---- /ledger y /performance: doble nivel (auth_optional) ---------------------

def test_ledger_without_token_hides_positions_but_keeps_aggregates(db, client, monkeypatch) -> None:
    """Sin sesión: los agregados (cifras de un sleeve virtual) se ven, pero `positions` viene
    vacío — no se puede reconstruir la cartera del método desde fuera."""
    from app import tracking
    from app.ledger import service as ledger

    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"AAA": 110.0})
    ledger.allocate(db, 1000)
    ledger.record_buy(db, "AAA", 10, 100, "seed")

    res = client.get("/ledger")
    assert res.status_code == 200
    body = res.json()
    assert body["positions"] == []
    assert body["cash"] is not None and body["equity"] is not None
    assert "AAA" not in res.text


def test_ledger_with_token_shows_full_positions(db, client, monkeypatch, token) -> None:
    """Con sesión: el detalle completo de siempre, con ticker por posición."""
    from app import tracking
    from app.ledger import service as ledger

    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"AAA": 110.0})
    ledger.allocate(db, 1000)
    ledger.record_buy(db, "AAA", 10, 100, "seed")

    res = client.get("/ledger", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["positions"]) == 1
    assert body["positions"][0]["ticker"] == "AAA"


def test_performance_without_token_anonymizes_positions(db, client, monkeypatch) -> None:
    """Sin sesión: cada posición pierde ticker/cantidad/coste — solo queda un label genérico y
    el P&L relativo. Los agregados (rentabilidad, alpha...) siguen intactos."""
    from app import tracking
    from app.ledger import service as ledger

    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"AAA": 110.0})
    monkeypatch.setattr(tracking, "_spy_reference", lambda *a, **k: None)  # sin red para el SPY
    ledger.allocate(db, 1000)
    ledger.record_buy(db, "AAA", 10, 100, "seed")

    res = client.get("/performance")
    assert res.status_code == 200
    assert "AAA" not in res.text
    assert '"ticker"' not in res.text
    body = res.json()
    assert body["portfolio_return_pct"] == 10.0  # (110-100)/100 * 100
    assert len(body["positions"]) == 1
    pos = body["positions"][0]
    assert set(pos.keys()) == {"label", "unrealized_pnl", "unrealized_pct"}
    assert pos["label"] == "Posición 1"


def test_performance_with_token_shows_tickers(db, client, monkeypatch, token) -> None:
    """Con sesión: la respuesta completa de siempre, con ticker por posición."""
    from app import tracking
    from app.ledger import service as ledger

    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"AAA": 110.0})
    monkeypatch.setattr(tracking, "_spy_reference", lambda *a, **k: None)
    ledger.allocate(db, 1000)
    ledger.record_buy(db, "AAA", 10, 100, "seed")

    res = client.get("/performance", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["positions"][0]["ticker"] == "AAA"


def test_config_does_not_leak_sensitive_fields(client) -> None:
    """Guardarraíles sí, secretos no: /config es público, así que nada de claves ni cuentas."""
    body = client.get("/config").json()
    leaky_keys = {"api_key", "openrouter_api_key", "ibkr_account_id", "vapid_private_key",
                  "app_password", "email", "ibkr_oauth_access_token"}
    assert not (leaky_keys & set(body.keys()))
    assert set(body.keys()) == {
        "max_positions", "min_positions", "max_position_pct", "dry_run", "limit_buffer_pct",
        "approval_expiry_days", "llm_defaults",
    }
    # llm_defaults es modelo/reasoning por etapa (público, ver routes.py) — nunca temperature/
    # top_p/api keys, que sí serían sensibles o ruido de implementación.
    for etapa in body["llm_defaults"].values():
        assert set(etapa.keys()) == {"model", "reasoning_effort"}


# ---- /admin/memory-status: diagnóstico de la memoria vectorial ---------------

def test_memory_status_counts_after_seed_without_loading_model(client, token, tmp_path) -> None:
    """El diagnóstico cuenta los recuerdos del fichero subido leyéndolo con sqlite3 crudo (sin
    cargar el modelo de embeddings). El `client` ya apuntó memory_db_path a este mismo tmp_path."""
    import sqlite3

    # agent_memory.db mínimo: tabla `memories` con 3 filas (sin vectores; status() no los usa).
    src = tmp_path / "source.db"
    conn = sqlite3.connect(src)
    conn.execute("CREATE TABLE memories(id INTEGER PRIMARY KEY, kind TEXT, ticker TEXT, "
                 "text TEXT, created_at TEXT)")
    conn.executemany(
        "INSERT INTO memories(kind, ticker, text, created_at) VALUES (?, ?, ?, ?)",
        [("thesis", t, f"tesis {t}", "now") for t in ("AAA", "BBB", "CCC")],
    )
    conn.commit()
    conn.close()

    headers = {"Authorization": f"Bearer {token}"}
    before = client.get("/admin/memory-status", headers=headers).json()
    assert before["exists"] is False and before["count"] == 0   # aún no se subió nada

    up = client.post("/admin/seed-memory", content=src.read_bytes(),
                     headers={**headers, "Content-Type": "application/octet-stream"})
    assert up.status_code == 200 and up.json()["bytes"] > 0

    after = client.get("/admin/memory-status", headers=headers).json()
    assert after["exists"] is True
    assert after["count"] == 3
    assert "deps" in after                                        # se informa si las deps están


# ---- /admin/universe-snapshot: relanzar a mano la foto del universo ---------

def test_universe_snapshot_requires_token(client) -> None:
    assert client.post("/admin/universe-snapshot").status_code == 401


def test_universe_snapshot_ok_with_size(client, token, monkeypatch) -> None:
    """Con la función de universo monkeypatcheada (sin red), responde ok con la foto y su
    tamaño — el mismo trabajo que hace el job de las 16:30 ET, disparado a mano."""
    monkeypatch.setattr(
        "app.screener.universe.refresh_snapshot_and_report",
        lambda db: {"at": "2026-08-03T20:30:00+00:00", "size": 2600},
    )
    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/admin/universe-snapshot", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"ok": True, "at": "2026-08-03T20:30:00+00:00", "size": 2600}


def test_universe_snapshot_reports_failure_without_500(client, token, monkeypatch) -> None:
    """Si NASDAQ falla (fuente externa, no del backend), responde 200 con ok:false — nunca
    revienta con un 500."""
    def _boom(db):  # noqa: ANN001, ARG001
        raise RuntimeError("NASDAQ no devolvió listado en 4 intentos")

    monkeypatch.setattr("app.screener.universe.refresh_snapshot_and_report", _boom)
    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/admin/universe-snapshot", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"ok": False, "error": "NASDAQ no devolvió listado en 4 intentos"}


# ---- /history: doble nivel (la curva real sin sesión pierde el equity) -------

def _seed_real_history(db) -> None:
    from datetime import date

    from app.models import BOOK_REAL, EquitySnapshot

    db.add_all([
        EquitySnapshot(day=date(2026, 7, 8), book=BOOK_REAL, equity=1000, spy_close=500.0),
        EquitySnapshot(day=date(2026, 7, 9), book=BOOK_REAL, equity=1050, spy_close=505.0),
    ])
    db.commit()


def test_history_real_without_token_hides_equity(db, client) -> None:
    """Sin sesión: fechas e índices (el % que la portada ya presume), jamás importes."""
    _seed_real_history(db)
    res = client.get("/history?book=real")
    assert res.status_code == 200
    pts = res.json()["series"]
    assert len(pts) == 2
    assert all("equity" not in p for p in pts)
    assert pts[1]["index"] == 105.0


def test_history_real_with_token_shows_equity(db, client, token) -> None:
    _seed_real_history(db)
    res = client.get("/history?book=real", headers={"Authorization": f"Bearer {token}"})
    assert [p["equity"] for p in res.json()["series"]] == ["1000", "1050"]


def test_history_rejects_unknown_book(client) -> None:
    assert client.get("/history?book=personal").status_code == 422


# ---- aportaciones con divisa: el libro vive en USD, Manuel aporta EUR ---------

def test_allocate_eur_converts_via_broker_and_books_actual_usd(db, client, token) -> None:
    """Aportación en €: el broker (dry-run) convierte al cambio del fixture (1.09) y se apunta
    la imagen final — 100 EUR → $109.00 en caja, con la trazabilidad en la respuesta."""
    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/real/allocate", json={"amount": 100, "currency": "EUR"}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["cash"] == "109.00"                    # neto REAL apuntado, no el input
    assert body["allocated"]["usd"] == "109.00"
    assert body["allocated"]["rate"] == "1.09"
    assert body["allocated"]["simulated"] is True      # dry-run: conversión simulada


def test_allocate_eur_without_rate_books_nothing(db, client, token, monkeypatch) -> None:
    """Si la conversión no ejecuta (sin cotización → FX cerrado), el libro NO se toca."""
    monkeypatch.setattr("app.tracking.live_prices", lambda _t: {})
    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/real/allocate", json={"amount": 100, "currency": "EUR"}, headers=headers)
    assert res.status_code == 409
    monkeypatch.setattr("app.tracking.live_prices", lambda _t: {"EURUSD=X": 1.09})
    assert client.get("/real", headers=headers).json()["cash"] == "0.00"   # ni un céntimo apuntado


def test_allocate_eur_withdrawal_rejected(client, token) -> None:
    """Retiradas solo en $ (el libro vive en dólares): aportación negativa en € → 422."""
    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/real/allocate", json={"amount": -50, "currency": "EUR"}, headers=headers)
    assert res.status_code == 422


def test_allocate_usd_direct_unchanged(db, client, token) -> None:
    """Modo $ (default): apunte directo sin conversión, como siempre."""
    headers = {"Authorization": f"Bearer {token}"}
    res = client.post("/real/allocate", json={"amount": 150}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["cash"] == "150.00"
    assert "allocated" not in body                     # sin conversión no hay traza FX


# ---- higiene de API: caps y validación de entrada ----------------------------

def test_scores_limit_capped(client, token) -> None:
    """El `limit` de /scores tiene tope duro: ni 0 ni más de 200."""
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/scores?limit=1000", headers=headers).status_code == 422
    assert client.get("/scores?limit=0", headers=headers).status_code == 422
    assert client.get("/scores?limit=200", headers=headers).status_code == 200


def test_allocate_rejects_nan_and_infinity(client, token) -> None:
    """`1e999`/NaN/Infinity pasan el json.loads de serie — deben morir en la validación (422),
    no como un 500 al convertir a Decimal en el libro."""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for bad in ("1e999", "-1e999", "NaN", "Infinity"):
        res = client.post("/ledger/allocate", content=f'{{"amount": {bad}}}', headers=headers)
        assert res.status_code == 422, f"amount={bad} debería dar 422 (dio {res.status_code})"


def test_allocate_negative_withdrawal_still_works(db, client, token) -> None:
    """La validación nueva no rompe las retiradas: un negativo razonable sigue pasando."""
    headers = {"Authorization": f"Bearer {token}"}
    assert client.post("/ledger/allocate", json={"amount": 100}, headers=headers).status_code == 200
    res = client.post("/ledger/allocate", json={"amount": -40}, headers=headers)
    assert res.status_code == 200
    assert res.json()["cash"] == "60.00"


def test_seed_memory_size_cap(client, token, monkeypatch, tmp_path) -> None:
    """Por encima del tope de bytes → 413 y NO se escribe nada en la ruta de memoria."""
    import app.api.routes as routes_mod

    monkeypatch.setattr(routes_mod, "_SEED_MEMORY_MAX_BYTES", 8)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream"}
    res = client.post("/admin/seed-memory", content=b"123456789", headers=headers)
    assert res.status_code == 413
    assert not (tmp_path / "mem.db").exists()


def test_docs_disabled_with_password() -> None:
    """Con APP_PASSWORD puesta (= prod), /docs, /redoc y /openapi.json no existen (404) y la
    raíz no los anuncia. Reconstruye la app real de main.py con la contraseña activa."""
    import importlib

    from app import main as main_mod
    from app.config import settings as cfg

    old = cfg.app_password
    try:
        cfg.app_password = "clave-prod"
        m = importlib.reload(main_mod)
        c = TestClient(m.app)   # sin `with`: no arranca el lifespan (ni scheduler ni init_db)
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert c.get(path).status_code == 404, f"{path} debería estar apagado en prod"
        assert "docs" not in c.get("/").json()
    finally:
        cfg.app_password = old
        importlib.reload(main_mod)  # deja el módulo como estaba para el resto de tests


# ---- embudo del escaneo: agregado público, detalle con sesión ----------------

def _sembrar_embudo(db) -> None:
    """Traza de un escaneo: 3 nombres puntuados, 2 al profundo, 1 en cartera, 1 sin datos."""
    from datetime import UTC, datetime

    from app.models import ScanAudit

    at = datetime(2026, 7, 28, 14, 15, tzinfo=UTC)
    db.add_all([
        ScanAudit(scan_at=at, ticker="AAA", sector="Technology", prescore=91.2, price=100.0,
                  reached_deep=True, deep_score=84, selected=True, funded=True, weight_pct=35.0,
                  stage="cartera"),
        ScanAudit(scan_at=at, ticker="BBB", sector="Technology", prescore=88.4, price=50.0,
                  reached_deep=True, deep_score=61, stage="finalista"),
        ScanAudit(scan_at=at, ticker="CCC", sector="Finance", prescore=42.0, price=20.0,
                  stage="prescore"),
        ScanAudit(scan_at=at, ticker="DDD", stage="datos"),
    ])
    db.commit()


def test_funnel_publico_cuenta_etapas_sin_revelar_tickers(client, db) -> None:
    """Sin sesión, el embudo describe el COMPORTAMIENTO (cuántos por etapa y sector) y no
    identifica a nadie: es lo que puede acompañar a un post sin ser un feed de señales."""
    _sembrar_embudo(db)
    body = client.get("/scan/funnel").json()
    scan = body["scans"][0]

    assert (scan["pre"], scan["deep"], scan["sel"], scan["funded"]) == (3, 2, 1, 1)
    assert scan["sin_datos"] == 1
    assert {s["sector"] for s in scan["sectores"]} == {"Technology", "Finance"}
    assert scan["sectores"][0] == {"sector": "Technology", "pre": 2, "deep": 2, "sel": 1,
                                   "funded": 1}          # ordenado por nº de pre-scoreados
    assert "nombres" not in scan, "sin sesión NO puede viajar el detalle por ticker"
    assert "AAA" not in client.get("/scan/funnel").text


def test_funnel_con_sesion_anade_el_detalle(client, db, token) -> None:
    """Con sesión sí: nombre a nombre, con los que llegaron al profundo primero (la frontera
    del corte es justo lo que no se puede reconstruir mirando solo a los ganadores)."""
    _sembrar_embudo(db)
    scan = client.get("/scan/funnel",
                      headers={"Authorization": f"Bearer {token}"}).json()["scans"][0]

    tickers = [n["ticker"] for n in scan["nombres"]]
    assert tickers[:2] == ["AAA", "BBB"]          # los profundos, antes que el resto
    assert "CCC" in tickers                        # la descartada también deja rastro
    assert scan["nombres"][0]["deep_score"] == 84


def test_report_publico_oculta_las_novedades_del_ranking(client, db, token) -> None:
    """`changes` dice qué tickers entran y salen del ranking: eso es la cartera del método."""
    import json

    from app.models import Meta

    db.add(Meta(key="last_scan_report", value=json.dumps(
        {"at": "2026-07-28T14:15:00+00:00", "mode": "observatorio", "error": None,
         "issues": ["algo"], "changes": ["entran ZZZ", "salen AAA"],
         "outlook": "Veo rotación desde WWW hacia defensivos.",
         "universe": {"fuente": "cierre", "size": 2600}, "scanned": 2601,
         "prescored": 2600, "deep": 50, "cost": None})))
    db.commit()

    anon = client.get("/scan/report").json()["report"]
    assert anon["changes"] == [] and "ZZZ" not in client.get("/scan/report").text
    # La tesis es texto libre del modelo y puede citar nombres: mismo lado que `changes`.
    assert anon["outlook"] is None and "WWW" not in client.get("/scan/report").text
    assert anon["prescored"] == 2600 and anon["issues"] == ["algo"]   # el resto sí se ve

    con = client.get("/scan/report", headers={"Authorization": f"Bearer {token}"}).json()["report"]
    assert con["changes"] == ["entran ZZZ", "salen AAA"]
    assert con["outlook"].startswith("Veo rotación")


# ---- la traza LEÍDA: /scan/outcomes y /scan/audit/{ticker} -------------------

def _siembra_cohorte(db) -> None:
    """Una cohorte con las cuatro suertes: fondeado, seleccionado sin fondear, descartado,
    fuera del corte — y un profundo ilegible que NO debe contar como descarte del criterio."""
    from datetime import UTC, datetime

    from app.models import ScanAudit

    at = datetime.now(UTC).replace(tzinfo=None)
    db.add_all([
        ScanAudit(scan_at=at, ticker="AAA", sector="Tech", prescore=90, price=100.0,
                  reached_deep=True, deep_score=88, selected=True, funded=True,
                  weight_pct=40.0, stage="cartera", decide=True),
        ScanAudit(scan_at=at, ticker="BBB", sector="Tech", prescore=80, price=100.0,
                  reached_deep=True, deep_score=85, selected=True, stage="seleccionado",
                  decide=True),
        ScanAudit(scan_at=at, ticker="CCC", sector="Energy", prescore=70, price=50.0,
                  reached_deep=True, deep_score=60, stage="finalista", decide=True),
        ScanAudit(scan_at=at, ticker="DDD", sector="Health", prescore=65, price=200.0,
                  stage="prescore", decide=True),
        ScanAudit(scan_at=at, ticker="EEE", sector="Tech", prescore=60, price=10.0,
                  reached_deep=True, stage="deep_error", decide=True),
    ])
    db.commit()


def test_outcomes_mide_grupos_y_oculta_nombres_sin_sesion(client, db, token, monkeypatch) -> None:
    """La pregunta central del experimento, con la regla de siempre: el retorno POR GRUPO es
    comportamiento (público); un ticker con su score y su retorno es un feed de señales."""
    from app import scan_outcomes, tracking

    _siembra_cohorte(db)
    monkeypatch.setattr(tracking, "live_prices",
                        lambda _t: {"AAA": 110.0, "BBB": 95.0, "CCC": 60.0,
                                    "DDD": 210.0, "EEE": 11.0})
    monkeypatch.setattr(scan_outcomes, "_spy_ret_since", lambda _d: 1.5)

    anon = client.get("/scan/outcomes").json()["scans"][0]
    g = anon["groups"]
    assert g["cartera"] == {"n": 1, "avg": 10.0, "median": 10.0}        # 100 → 110
    assert g["seleccionados"]["avg"] == -5.0                            # 100 → 95
    assert g["descartados"]["avg"] == 20.0                              # 50 → 60
    assert g["spy"] == 1.5
    assert anon["mode"] == "decisión"
    # El profundo ilegible (EEE) no es un descarte del criterio: fuera de grupos y pares.
    assert {p["score"] for p in anon["pairs"]} == {88, 85, 60}
    assert all("ticker" not in p for p in anon["pairs"])                # sin nombres
    assert "nombres" not in anon["corte"]["fuera"] and "nombres" not in anon["corte"]["dentro"]
    assert "AAA" not in client.get("/scan/outcomes").text

    con = client.get("/scan/outcomes",
                     headers={"Authorization": f"Bearer {token}"}).json()["scans"][0]
    assert {p["ticker"] for p in con["pairs"]} == {"AAA", "BBB", "CCC"}
    assert con["corte"]["fuera"]["nombres"][0]["ticker"] == "DDD"       # el mejor que quedó fuera
    assert con["corte"]["fuera"]["avg"] == 5.0                          # 200 → 210


def test_outcomes_modo_honesto_y_fila_del_libro(client, db, monkeypatch) -> None:
    """Dos cosas que la primera versión confundía: (1) la cartera de un OBSERVATORIO es la
    construcción hipotética de ese martes — con el flag `decide` a NULL/False la cohorte ya no
    se disfraza de decisión; (2) la fila del libro REAL (desde el ledger, a valor de mercado)
    viaja aparte en `book`, porque la traza no alcanza a la decisión que compró la cartera."""
    from datetime import UTC, datetime

    from app import scan_outcomes, tracking
    from app.models import ScanAudit

    # Cohorte SIN flag (como las filas de julio, anteriores a la columna) → observatorio.
    at = datetime.now(UTC).replace(tzinfo=None)
    db.add(ScanAudit(scan_at=at, ticker="AAA", sector="Tech", prescore=90, price=100.0,
                     reached_deep=True, deep_score=88, selected=True, funded=True,
                     weight_pct=40.0, stage="cartera"))
    db.commit()
    monkeypatch.setattr(tracking, "live_prices", lambda _t: {"AAA": 110.0})
    monkeypatch.setattr(scan_outcomes, "_spy_ret_since", lambda _d: 1.0)
    monkeypatch.setattr(scan_outcomes, "book_row",
                        lambda _db: {"since": "2026-07-18", "ret": 4.2, "spy": 2.0, "n": 5})

    body = client.get("/scan/outcomes").json()
    assert body["scans"][0]["mode"] == "observatorio"   # cartera hipotética, no decisión
    assert body["book"] == {"since": "2026-07-18", "ret": 4.2, "spy": 2.0, "n": 5}


def test_historia_de_un_ticker_es_privada(client, db, token) -> None:
    """La historia de un ticker (¿es estable el criterio?) lleva nombre y scores: sin cara
    pública. Con sesión devuelve los escaneos del más reciente al más viejo."""
    _siembra_cohorte(db)
    assert client.get("/scan/audit/AAA").status_code == 401

    res = client.get("/scan/audit/aaa", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["ticker"] == "AAA"
    assert body["scans"][0]["deep_score"] == 88 and body["scans"][0]["stage"] == "cartera"
