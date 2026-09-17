"""`_convertir_financieros_a_usd`/`_fundamentals_text`: los 8 campos de estados financieros
(`_CAMPOS_MONEDA_FINANCIERA`) se pasan a USD desde `financialCurrency` -- distinta de `currency`
para extranjeras (TSM cotiza en USD, reporta en NTD). Bug real de la auditoría del escaneo 54:
`_fmt` ponía un "$" a ciegas sobre cifras que en realidad venían en otra divisa."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app.db import Base
from app.models import FxRate
from app.screener import fundamentals as fund_mod


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _info_twd() -> dict:
    return {
        "financialCurrency": "TWD",
        "currency": "USD",   # ADR: cotiza en USD, pero reporta en NTD -- divisas DISTINTAS
        "totalRevenue": 4_440_492_343_296.0,   # ~4.44T NTD
        "marketCap": 900_000_000_000.0,        # ya en USD (currency), no debe tocarse
    }


def test_convierte_los_campos_financieros_con_la_tasa_mas_reciente(db) -> None:
    db.add(FxRate(synced_at=datetime.now(UTC), currency_code="TWD", usd_per_unit=0.0315))
    db.commit()

    out = fund_mod._convertir_financieros_a_usd(_info_twd(), db)

    assert out["totalRevenue"] == pytest.approx(4_440_492_343_296.0 * 0.0315)
    assert out["marketCap"] == 900_000_000_000.0   # fuera de _CAMPOS_MONEDA_FINANCIERA: intacto


def test_sin_tasa_sincronizada_se_omite_el_campo_en_vez_de_mostrar_el_dolar_equivocado(db) -> None:
    """Sin FxRate para TWD (hueco real solo el primer día tras desplegar el fix): el campo
    desaparece del texto -- nunca se enseña con el "$" de otra divisa como si fuera USD."""
    out = fund_mod._convertir_financieros_a_usd(_info_twd(), db)
    assert "totalRevenue" not in out

    texto = fund_mod._fundamentals_text(_info_twd(), db=db)
    assert "Revenue" not in texto


def test_moneda_usd_o_sin_db_no_toca_nada(db) -> None:
    info_usd = {**_info_twd(), "financialCurrency": "USD"}
    assert fund_mod._convertir_financieros_a_usd(info_usd, db) == info_usd
    # Sin sesión real (scripts de reconstrucción sueltos): mismo comportamiento de siempre.
    assert fund_mod._convertir_financieros_a_usd(_info_twd(), None) == _info_twd()


def test_fundamentals_text_muestra_el_valor_ya_convertido(db) -> None:
    db.add(FxRate(synced_at=datetime.now(UTC), currency_code="TWD", usd_per_unit=0.0315))
    db.commit()

    texto = fund_mod._fundamentals_text(_info_twd(), db=db)
    # 4.44T NTD * 0.0315 = 139.88B USD, no los 4.44T (billones) que salían con la divisa sin convertir.
    assert "Revenue: $139.88B" in texto


def test_valores_crudos_tambien_convierte(db) -> None:
    """Bug real (17-sep-2026): lo persistido en fundamentals_snapshot_metric se quedaba en la
    divisa nativa mientras el texto que vio el LLM ya iba en USD -- dos fuentes de verdad
    distintas del mismo escaneo."""
    db.add(FxRate(synced_at=datetime.now(UTC), currency_code="TWD", usd_per_unit=0.0315))
    db.commit()

    crudos = fund_mod._valores_crudos(_info_twd(), db)
    assert crudos["totalRevenue"] == pytest.approx(4_440_492_343_296.0 * 0.0315)


def test_convertir_marca_financial_currency_a_usd_para_evitar_doble_conversion(db) -> None:
    """Sin esto, `foto_reciente()` reconstruye desde lo YA convertido y vuelve a llamar
    `_convertir_financieros_a_usd` -- si `financialCurrency` se quedara en "TWD", aplicaría la
    tasa una segunda vez sobre un valor que ya no la necesita."""
    db.add(FxRate(synced_at=datetime.now(UTC), currency_code="TWD", usd_per_unit=0.0315))
    db.commit()

    out = fund_mod._convertir_financieros_a_usd(_info_twd(), db)
    assert out["financialCurrency"] == "USD"

    # Relectura: con la divisa ya marcada como USD, una segunda pasada no debe tocar nada.
    otra_vez = fund_mod._convertir_financieros_a_usd(out, db)
    assert otra_vez["totalRevenue"] == out["totalRevenue"]


def _info_ev_roto() -> dict:
    """Mismo patrón real que SK hynix (17-sep-2026): EV negativo que no cuadra ni convertido
    bien -- dato roto aguas arriba en yfinance, no un problema de escala de divisa."""
    return {
        "financialCurrency": "KRW",
        "currency": "USD",
        "marketCap": 1_300_000_000_000.0,          # ya en USD
        "enterpriseValue": -65_000_000_000_000.0,  # KRW crudo, incluso convertido no cuadra
        "totalCash": 88_000_000_000_000.0,
        "totalDebt": 21_000_000_000_000.0,
        "enterpriseToRevenue": -0.34,
        "enterpriseToEbitda": -0.46,
    }


def test_guardarrail_omite_ev_que_no_cuadra_tras_convertir(db) -> None:
    db.add(FxRate(synced_at=datetime.now(UTC), currency_code="KRW", usd_per_unit=0.000725))
    db.commit()

    out = fund_mod._convertir_financieros_a_usd(_info_ev_roto(), db)
    assert "enterpriseValue" not in out
    assert "enterpriseToRevenue" not in out
    assert "enterpriseToEbitda" not in out
    # El resto de campos convertidos SÍ se quedan -- el guardarraíl es solo para el EV roto.
    assert out["totalCash"] == pytest.approx(88_000_000_000_000.0 * 0.000725)


def test_guardarrail_no_toca_un_ev_que_sí_cuadra(db) -> None:
    db.add(FxRate(synced_at=datetime.now(UTC), currency_code="TWD", usd_per_unit=0.0315))
    db.commit()

    info = {
        "financialCurrency": "TWD",
        "currency": "USD",
        "marketCap": 900_000_000_000.0,
        "enterpriseValue": 28_571_428_571_428.6,  # ~900B USD tras convertir, cuadra con mcap
        "totalCash": 0.0,
        "totalDebt": 0.0,
    }
    out = fund_mod._convertir_financieros_a_usd(info, db)
    assert out["enterpriseValue"] == pytest.approx(900_000_000_000.0, rel=0.01)
