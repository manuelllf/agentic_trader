"""Foto versionada de `fundamentals.gather()` (`FundamentalsSnapshot`), ventana de 12h."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app.db import Base
from app.models import FundamentalsSnapshot
from app.screener import fundamentals as fund_mod
from app.screener.fundamentals import NameData


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _sample() -> NameData:
    return NameData(
        ticker="AAA", sector="Technology", industry="Software", price=100.0,
        fundamentals_text="- P/E (trailing): 20.00\n- Trading currency: USD",
        technical_text="RSI 55", market_cap=5e9,
        news=["más reciente", "segunda", "tercera"], earnings_text="10-Q el 12-sep",
        name="AAA Inc", target_high=150.0, target_mean=130.0,
        pe_trailing=22.5, pe_forward=19.1, high_52w=110.0, low_52w=80.0,
        # Lo que de verdad se persiste (ver FundamentalsSnapshotMetric): en crudo, no el texto
        # ya montado de arriba — ese solo importa para el prompt EN VIVO, nunca para la BD.
        fundamentales_crudos={"trailingPE": 20.0, "currency": "USD"},
    )


def test_foto_guardar_y_leer_redondo(db) -> None:
    """Ronda completa por columnas propias (nunca JSON ni texto formateado, ver
    `FundamentalsSnapshot`): las noticias y los ~85 campos crudos son las partes hermanas más
    fáciles de dejar mal — filas por FK, con el ORDEN de las noticias conservado vía `posicion`.
    `fundamentals_text` NO se guarda: se reconstruye con la MISMA función que la monta en vivo
    a partir de las filas crudas — por eso la ronda comprueba el texto reconstruido, no un campo
    guardado tal cual."""
    fund_mod.foto_guardar(db, "AAA", _sample())
    got = fund_mod.foto_reciente(db, "AAA")
    assert got is not None
    assert got.ticker == "AAA"
    # Reconstruido con `_fundamentals_text`, no guardado tal cual — mismo orden de catálogo.
    assert got.fundamentals_text == "- P/E (trailing): 20.00\n- Trading currency: USD"
    assert got.fundamentales_crudos == {"trailingPE": 20.0, "currency": "USD"}   # str y num
    assert got.news == ["más reciente", "segunda", "tercera"]   # orden intacto
    assert (got.industry, got.name, got.earnings_text) == ("Software", "AAA Inc", "10-Q el 12-sep")
    assert (got.target_high, got.target_mean) == (150.0, 130.0)
    assert (got.pe_trailing, got.pe_forward) == (22.5, 19.1)
    assert (got.high_52w, got.low_52w) == (110.0, 80.0)


def test_sin_foto_devuelve_none(db) -> None:
    assert fund_mod.foto_reciente(db, "ZZZ") is None


def test_la_foto_caduca_a_las_12h(db) -> None:
    fund_mod.foto_guardar(db, "AAA", _sample())
    row = db.query(FundamentalsSnapshot).one()
    row.captured_at = datetime.now(UTC) - timedelta(hours=13)   # forzar caducidad
    db.commit()
    assert fund_mod.foto_reciente(db, "AAA") is None


def test_gather_reutiliza_la_foto_sin_tocar_yfinance(db, monkeypatch) -> None:
    """Segunda llamada dentro de las 12h no debe tocar yfinance en absoluto."""
    # Este test ejerce `gather()` de verdad (no mockea la función entera, solo `yf.Ticker`), así
    # que desde el scraper primario tocaría red real para consentir con Yahoo. Se fuerza "sesión
    # no disponible" para aislarlo — sigue probando lo mismo: la reutilización de la foto
    # sobre el camino de yfinance puro.
    monkeypatch.setattr(fund_mod, "_scraper_session", lambda: None)
    llamadas = {"n": 0}

    class _TickerFalso:
        def __init__(self, ticker):
            llamadas["n"] += 1
            self.info = {"sector": "Technology", "marketCap": 5e9, "shortName": "AAA Inc"}
            self.news = []

        def history(self, **kwargs):
            import pandas as pd
            return pd.DataFrame()

    monkeypatch.setattr(fund_mod.yf, "Ticker", _TickerFalso)

    d1, err1 = fund_mod.gather("AAA", db=db)
    assert d1 is not None and err1 is None
    assert llamadas["n"] == 1

    d2, err2 = fund_mod.gather("AAA", db=db)
    assert d2 is not None and err2 is None
    assert llamadas["n"] == 1     # NO volvió a tocar yfinance: sirvió la foto
