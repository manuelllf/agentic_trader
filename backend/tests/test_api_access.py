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
def client(db, monkeypatch):
    monkeypatch.setattr(auth.settings, "app_password", PASSWORD)
    # /macro llamaría a yfinance; en tests no hay red — régimen determinista de mentira.
    monkeypatch.setattr(
        "app.screener.macro.get_macro_regime",
        lambda: {"regime": "neutral", "spy_above_ma200": True, "vix": 15.0},
    )
    app = FastAPI()
    app.include_router(public_router)
    app.include_router(router, dependencies=[Depends(auth.require_auth)])
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def token(client) -> str:
    # `client` ya fijó APP_PASSWORD vía monkeypatch antes de que esto se ejecute.
    return auth.login(PASSWORD)


# ---- reparto público / protegido --------------------------------------------

PUBLIC_GET_PATHS = [
    "/overview", "/ledger", "/scores", "/performance", "/proposal",
    "/watchlist", "/macro", "/config", "/demo/status",
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


def test_config_does_not_leak_sensitive_fields(client) -> None:
    """Guardarraíles sí, secretos no: /config es público, así que nada de claves ni cuentas."""
    body = client.get("/config").json()
    leaky_keys = {"api_key", "openrouter_api_key", "ibkr_account_id", "vapid_private_key",
                  "app_password", "email", "ibkr_oauth_access_token"}
    assert not (leaky_keys & set(body.keys()))
    assert set(body.keys()) == {
        "max_positions", "min_positions", "max_position_pct", "dry_run", "limit_buffer_pct",
    }
