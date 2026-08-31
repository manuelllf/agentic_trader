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
