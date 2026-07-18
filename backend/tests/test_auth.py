"""Tests del login: contraseña, token firmado, caducidad y guardarraíl require_auth."""

from __future__ import annotations

import time

import pytest
from fastapi import HTTPException

from app import auth


def test_auth_disabled_without_password(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "app_password", "")
    assert auth.auth_enabled() is False
    auth.require_auth(authorization="")          # sin candado en local: no lanza
    assert auth.login("lo-que-sea") is not None   # login libre


def test_login_wrong_and_right(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "app_password", "clave-super-chunga-123")
    assert auth.login("incorrecta") is None
    token = auth.login("clave-super-chunga-123")
    assert token and auth.verify_token(token)
    auth.require_auth(authorization=f"Bearer {token}")   # token bueno: pasa


def test_require_auth_rejects_bad_token(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "app_password", "pw")
    with pytest.raises(HTTPException) as e:
        auth.require_auth(authorization="Bearer basura")
    assert e.value.status_code == 401
    with pytest.raises(HTTPException):
        auth.require_auth(authorization="")           # sin token → 401


def test_token_expires(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "app_password", "pw")
    monkeypatch.setattr(auth.settings, "auth_token_days", 30)
    old_ts = str(int(time.time()) - 40 * 86400)       # 40 días atrás
    old_token = f"{old_ts}.{auth._sign(old_ts)}"       # firma válida, pero caducado
    assert auth.verify_token(old_token) is False


def test_token_not_forgeable(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "app_password", "pw-A")
    token = auth.login("pw-A")
    # cambiar la contraseña invalida los tokens viejos (la firma ya no cuadra)
    monkeypatch.setattr(auth.settings, "app_password", "pw-B")
    assert auth.verify_token(token) is False


# ---- fail-closed: en la nube, sin contraseña NO se arranca -------------------

def test_prod_sin_password_no_arranca(monkeypatch) -> None:
    """Railway + APP_PASSWORD vacía = API pública → el arranque debe reventar a propósito."""
    from app import main as main_mod

    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    monkeypatch.setattr(main_mod.settings, "app_password", "")
    with pytest.raises(RuntimeError):
        main_mod._require_password_in_prod()


def test_prod_con_password_arranca(monkeypatch) -> None:
    from app import main as main_mod

    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    monkeypatch.setattr(main_mod.settings, "app_password", "pw")
    main_mod._require_password_in_prod()          # no lanza


def test_local_sin_password_arranca(monkeypatch) -> None:
    """Dev local (sin var de Railway): sin candado sigue siendo válido — no bloquea."""
    from app import main as main_mod

    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.setattr(main_mod.settings, "app_password", "")
    main_mod._require_password_in_prod()          # dev local sin candado: ok


# ---- rate-limit del login: solo fallos, por IP + tope global -----------------

def test_login_endpoint_bloquea_tras_5_fallos(monkeypatch) -> None:
    """5 contraseñas malas → la 6ª da 429 con Retry-After, INCLUSO con la contraseña buena."""
    from fastapi.testclient import TestClient

    from app import main as main_mod

    monkeypatch.setattr(auth, "_fails", {})
    monkeypatch.setattr(auth.settings, "app_password", "la-buena")
    c = TestClient(main_mod.app)
    for _ in range(5):
        assert c.post("/auth/login", json={"password": "mala"}).status_code == 401
    res = c.post("/auth/login", json={"password": "mala"})
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) > 0
    assert c.post("/auth/login", json={"password": "la-buena"}).status_code == 429


def test_login_correcto_no_consume_y_limpia(monkeypatch) -> None:
    """Los aciertos no cuentan: con 4 fallos previos, el login bueno entra y limpia su IP."""
    from fastapi.testclient import TestClient

    from app import main as main_mod

    monkeypatch.setattr(auth, "_fails", {})
    monkeypatch.setattr(auth.settings, "app_password", "la-buena")
    c = TestClient(main_mod.app)
    for _ in range(4):
        c.post("/auth/login", json={"password": "mala"})
    assert c.post("/auth/login", json={"password": "la-buena"}).status_code == 200
    assert auth._fails == {}                       # el acierto limpió el contador de su IP


def test_tope_global_contra_ips_falsificadas(monkeypatch) -> None:
    """30 fallos repartidos en 30 IPs (X-Forwarded-For falsificado) → bloqueo global igual."""
    monkeypatch.setattr(auth, "_fails", {})
    for i in range(30):
        auth.register_login_failure(f"ip-{i}")
    assert auth.login_blocked("ip-nueva-sin-fallos") > 0


def test_fallos_viejos_expiran(monkeypatch) -> None:
    """Fallos de hace más de 15 min no cuentan (la ventana desliza sola)."""
    viejo = time.time() - auth._WINDOW_SECONDS - 60
    monkeypatch.setattr(auth, "_fails", {"1.1.1.1": [viejo] * 5})
    assert auth.login_blocked("1.1.1.1") == 0
