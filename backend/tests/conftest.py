from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _sin_espera_de_reintento_del_gather(monkeypatch) -> None:  # noqa: ANN001
    """Con `time.sleep` anulado en los tests, los 180 s de espera del reintento del gather se
    convertían en un bucle activo de 3 minutos reales: el test parecía colgado."""
    from app import scan_service

    monkeypatch.setattr(scan_service, "_GATHER_RETRY_COOLDOWN_S", 0.0)
