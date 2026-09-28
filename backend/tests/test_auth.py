"""Tests del candado de las salas (sesión de admin con 2FA) y de los arranques fail-closed."""

from __future__ import annotations

import asyncio
import time

import pytest
from fastapi import HTTPException

from app import auth
from app.liga.acceso import LimiteFallos


def test_auth_disabled_without_supabase(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(auth.settings, "supabase_url", "")
    assert auth.auth_enabled() is False
    asyncio.run(auth.require_auth(authorization=""))     # sin candado en local: no lanza
    assert auth.auth_optional(authorization="") is True


def test_la_sesion_de_admin_abre_y_lo_demas_no(token_admin) -> None:  # noqa: ANN001
    asyncio.run(auth.require_auth(authorization=f"Bearer {token_admin}"))
    assert auth.auth_optional(authorization=f"Bearer {token_admin}") is True
    for cabecera in ("", "Bearer ", "Bearer basura"):
        with pytest.raises(HTTPException) as e:
            asyncio.run(auth.require_auth(authorization=cabecera))
        assert e.value.status_code == 401
        assert auth.auth_optional(authorization=cabecera) is False


@pytest.mark.parametrize("codigo", [403, 404])
def test_sin_2fa_o_sin_rol_admin_no_abre(token_admin, monkeypatch, codigo) -> None:  # noqa: ANN001
    def rechaza(_ident):  # noqa: ANN001, ANN202
        raise HTTPException(codigo, "no")

    monkeypatch.setattr(auth, "comprobar_admin", rechaza)
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.require_auth(authorization=f"Bearer {token_admin}"))
    assert e.value.status_code == codigo


def test_ya_no_hay_login_con_contrasena() -> None:
    from fastapi.testclient import TestClient

    from app import main as main_mod

    assert TestClient(main_mod.app).post("/auth/login", json={"password": "x"}).status_code \
        in (404, 405)


# ---- fail-closed: en la nube, sin candado NO se arranca ----------------------

def test_prod_sin_supabase_no_arranca(monkeypatch) -> None:  # noqa: ANN001
    """Railway sin SUPABASE_URL = API pública → el arranque debe reventar a propósito."""
    from app import main as main_mod

    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    monkeypatch.setattr(main_mod.settings, "supabase_url", "")
    with pytest.raises(RuntimeError):
        main_mod._require_auth_in_prod()


def test_prod_con_supabase_arranca(monkeypatch) -> None:  # noqa: ANN001
    from app import main as main_mod

    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    monkeypatch.setattr(main_mod.settings, "supabase_url", "https://pruebas.supabase.co")
    main_mod._require_auth_in_prod()              # no lanza


def test_local_sin_supabase_arranca(monkeypatch) -> None:  # noqa: ANN001
    """Dev local (sin var de Railway): sin candado sigue siendo válido — no bloquea."""
    from app import main as main_mod

    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.setattr(main_mod.settings, "supabase_url", "")
    main_mod._require_auth_in_prod()


# ---- fail-closed del volumen: sin escritura en la BD no se arranca -----------

def test_bd_escribible_arranca(tmp_path, monkeypatch) -> None:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app import db as db_mod
    from app import main as main_mod

    ruta = tmp_path / "w.db"
    eng = create_engine(f"sqlite:///{ruta}")
    eng.connect().close()                                 # crea el fichero
    monkeypatch.setattr(main_mod.settings, "database_url", f"sqlite:///{ruta}")
    monkeypatch.setattr(db_mod, "SessionLocal", sessionmaker(bind=eng))
    main_mod._verify_db_writable()                        # no lanza


def test_bd_solo_lectura_revienta_el_arranque(tmp_path, monkeypatch) -> None:
    """Contra una BD abierta en solo lectura (mode=ro, como un volumen sin permisos), el
    write-lock falla → el boot debe caer (deploy fallido y rollback en Railway, en vez de
    una app que lee pero no apunta)."""
    import sqlite3

    from sqlalchemy import create_engine
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import sessionmaker

    from app import db as db_mod
    from app import main as main_mod

    ruta = tmp_path / "ro.db"
    rw = create_engine(f"sqlite:///{ruta}")
    rw.connect().close()                                  # crea el fichero
    rw.dispose()

    # `creator` abre sqlite3 en solo lectura DIRECTO (sin parseo de URL de SQLAlchemy):
    # el write-lock de _verify_db_writable debe fallar contra esta conexión.
    ro_conn = f"file:///{ruta.as_posix()}?mode=ro"
    eng_ro = create_engine("sqlite://", creator=lambda: sqlite3.connect(ro_conn, uri=True))
    monkeypatch.setattr(main_mod.settings, "database_url", f"sqlite:///{ruta}")
    monkeypatch.setattr(db_mod, "SessionLocal", sessionmaker(bind=eng_ro))
    with pytest.raises(OperationalError):
        main_mod._verify_db_writable()


# ---- limitador de fallos al entrar: por IP + tope global ---------------------

def test_tope_global_contra_ips_falsificadas() -> None:
    """Fallos repartidos en muchas IPs (X-Forwarded-For falsificado) → bloqueo global igual."""
    limite = LimiteFallos(por_ip=5, global_=30, ventana_s=900)
    for i in range(30):
        limite.fallo(f"ip-{i}")
    assert limite.espera("ip-nueva-sin-fallos") > 0


def test_fallos_viejos_expiran() -> None:
    """Fallos de hace más de la ventana no cuentan (la ventana desliza sola)."""
    limite = LimiteFallos(por_ip=5, global_=30, ventana_s=900)
    limite._fallos = {"1.1.1.1": [time.time() - 960] * 5}
    assert limite.espera("1.1.1.1") == 0
