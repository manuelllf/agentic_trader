"""Tasas de cambio a USD -- solo las divisas que de verdad aparecen en el universo capturado.

Job de las 5:00 Europa/Madrid (antes del de analítica DuckDB de las 6:00, ver `scheduler.py`):
sincroniza `FxRate` y RECALCULA `market_cap_usd` en `fundamentals_snapshot` con la tasa del día,
para que un movimiento de divisa se note sin re-capturar fundamentales (ver `models.FxRate`).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

logger = logging.getLogger(__name__)

# Ventana de recálculo: solo las fotos recientes importan para rankear un scan -- una fila de
# hace medio año no va a entrar en ningún "top market cap" y recorrer TODA la tabla cada noche
# crecería sin límite según se acumulan capturas.
_VENTANA_RECALCULO_DIAS = 35


def _divisas_activas(db) -> list[str]:  # noqa: ANN001
    """Divisas distintas (no-USD) presentes en fotos recientes -- no un catálogo mundial."""
    from datetime import timedelta

    from app.models import FundamentalsSnapshot

    desde = datetime.now(UTC) - timedelta(days=_VENTANA_RECALCULO_DIAS)
    filas = (db.query(FundamentalsSnapshot.currency).distinct()
            .filter(FundamentalsSnapshot.captured_at >= desde,
                   FundamentalsSnapshot.currency.isnot(None),
                   FundamentalsSnapshot.currency != "USD")
            .all())
    return [c for (c,) in filas]


def sincronizar(db) -> dict:  # noqa: ANN001
    """Pide a Yahoo la tasa de hoy de cada divisa activa (una sola petición, ver
    `yahoo_scraper.tasas_de_cambio`) y recalcula `market_cap_usd` de las fotos recientes."""
    from app.models import FundamentalsSnapshot, FxRate
    from app.screener import fundamentals as fund_mod
    from app.screener import yahoo_scraper

    divisas = _divisas_activas(db)
    if not divisas:
        return {"divisas": 0, "recalculadas": 0}

    scraper = fund_mod._scraper_session()
    if scraper is None:
        raise RuntimeError("Scraper de Yahoo no disponible: sin sesión no hay tasas de cambio.")
    s, crumb = scraper
    tasas = yahoo_scraper.tasas_de_cambio(s, crumb, divisas)
    sin_cotizacion = set(divisas) - set(tasas)
    if sin_cotizacion:
        logger.warning("FX: sin cotización para %s (se deja su market_cap_usd como estaba).",
                       ", ".join(sorted(sin_cotizacion)))

    sync_at = datetime.now(UTC)
    db.bulk_save_objects([
        FxRate(synced_at=sync_at, currency_code=ccy, usd_per_unit=tasa)
        for ccy, tasa in tasas.items()
    ])
    db.commit()

    from datetime import timedelta
    desde = sync_at - timedelta(days=_VENTANA_RECALCULO_DIAS)
    recalculadas = 0
    for ccy, tasa in tasas.items():
        recalculadas += (
            db.query(FundamentalsSnapshot)
            .filter(FundamentalsSnapshot.captured_at >= desde,
                   FundamentalsSnapshot.currency == ccy,
                   FundamentalsSnapshot.market_cap.isnot(None))
            .update({FundamentalsSnapshot.market_cap_usd: FundamentalsSnapshot.market_cap * tasa},
                    synchronize_session=False)
        )
    db.commit()
    logger.info("FX: %d divisas sincronizadas, %d fotos recalculadas a USD.",
               len(tasas), recalculadas)
    return {"divisas": len(tasas), "recalculadas": recalculadas}
