from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _sin_espera_de_reintento_del_gather(monkeypatch) -> None:  # noqa: ANN001
    """Con `time.sleep` anulado en los tests, los 180 s de espera del reintento del gather se
    convertían en un bucle activo de 3 minutos reales: el test parecía colgado."""
    from app import scan_service

    monkeypatch.setattr(scan_service, "_GATHER_RETRY_COOLDOWN_S", 0.0)


@pytest.fixture(autouse=True)
def _sin_regalo_de_bienvenida(request):  # noqa: ANN001, ANN201
    """Las cuentas nuevas reciben créditos de bienvenida (sql 015); casi todas las pruebas de
    créditos parten de saldo 0, así que el regalo se apaga en la BD de pruebas salvo en las
    marcadas con `@pytest.mark.con_bienvenida`."""
    import os

    url = os.environ.get("LIGA_TEST_DATABASE_URL")
    if not url or request.node.get_closest_marker("con_bienvenida"):
        yield
        return
    psycopg = pytest.importorskip("psycopg")
    with psycopg.connect(url, autocommit=True) as cx:
        cx.execute("insert into liga.ajustes (clave, valor) values ('creditos.bienvenida', '0') "
                   "on conflict (clave) do update set valor = '0'")
    try:
        yield
    finally:
        with psycopg.connect(url, autocommit=True) as cx:
            cx.execute("delete from liga.ajustes where clave = 'creditos.bienvenida'")


TOKEN_ADMIN = "token-de-admin-de-pruebas"


@pytest.fixture
def token_admin(monkeypatch) -> str:  # noqa: ANN001
    """Candado de las salas encendido y una sesión de admin con 2FA que lo abre, sin red ni BD:
    la verificación real del JWT y del rol se prueba en test_liga_auth."""
    from fastapi import HTTPException

    from app import auth
    from app.liga.auth import Identidad

    def verificar(token: str) -> Identidad:
        if token != TOKEN_ADMIN:
            raise HTTPException(401, "Sesión no válida. Vuelve a entrar.")
        return Identidad(uid="admin", aal="aal2", claims={})

    monkeypatch.setattr(auth.settings, "supabase_url", "https://pruebas.supabase.co")
    monkeypatch.setattr(auth, "verificar", verificar)
    monkeypatch.setattr(auth, "comprobar_admin", lambda ident: ident)
    return TOKEN_ADMIN
