from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _sin_espera_de_reintento_del_gather(monkeypatch) -> None:  # noqa: ANN001
    """Con `time.sleep` anulado en los tests, los 180 s de espera del reintento del gather se
    convertían en un bucle activo de 3 minutos reales: el test parecía colgado."""
    from app import scan_service

    monkeypatch.setattr(scan_service, "_GATHER_RETRY_COOLDOWN_S", 0.0)


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
