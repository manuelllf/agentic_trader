"""Foto con identidad (B4) y escaneos trazables (B5): la foto nace `capturando`, se cierra de
golpe, siempre captura fresco, y cada escaneo sabe de qué foto salieron sus datos."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import foto_service, scan_audit, scan_service
from app.db import Base
from app.models import Foto, FundamentalsSnapshot, ScanAudit
from app.screener import fundamentals as fund_mod
from app.screener.fundamentals import NameData


@pytest.fixture
def db():
    # StaticPool: los hilos de la foto comparten la misma BD en memoria.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def yahoo_falso(monkeypatch):
    """yfinance de mentira: AAA y BBB existen, ZZZ está deslistado. Cuenta las peticiones."""
    llamadas: dict[str, int] = {}

    class _TickerFalso:
        def __init__(self, ticker):
            llamadas[ticker] = llamadas.get(ticker, 0) + 1
            self.news = []
            self.info = ({} if ticker == "ZZZ" else
                         {"sector": "Technology", "marketCap": 5e9, "shortName": f"{ticker} Inc",
                          "currentPrice": 10.0})

    monkeypatch.setattr(fund_mod, "_scraper_session", lambda: None)
    monkeypatch.setattr(fund_mod.yf, "Ticker", _TickerFalso)
    monkeypatch.setattr(scan_service, "_GATHER_PACE_S", 0.0)
    monkeypatch.setattr(foto_service, "_tickers",
                        lambda db, alcance, limite, countries=None, exchanges=None:
                        [("AAA", None), ("BBB", None), ("ZZZ", None)])
    return llamadas


def test_foto_completa_con_identidad(db, yahoo_falso):
    out = foto_service.capturar(db)
    foto = db.get(Foto, out["foto_id"])
    assert out["estado"] == foto.estado == "completa"
    assert foto.fin is not None
    assert (foto.pedidos, foto.capturados) == (3, 2)       # ZZZ recorrido pero sin datos
    ids = {t: f for t, f in db.query(FundamentalsSnapshot.ticker, FundamentalsSnapshot.foto_id)}
    assert ids == {"AAA": foto.id, "BBB": foto.id}


def test_la_foto_siempre_captura_fresco(db, yahoo_falso):
    fund_mod.foto_guardar(db, "AAA", NameData(ticker="AAA", sector="Technology",
                                              industry="Software", price=9.0,
                                              fundamentals_text="", technical_text=""))
    foto_service.capturar(db)
    assert yahoo_falso["AAA"] == 1                            # no reutilizó la de hace un momento
    filas = db.query(FundamentalsSnapshot).filter_by(ticker="AAA").all()
    assert sorted(f.foto_id is not None for f in filas) == [False, True]


def test_una_foto_huerfana_se_cierra_como_fallida(db, yahoo_falso):
    huerfana = Foto(alcance="nasdaq", estado="capturando", pedidos=10)
    db.add(huerfana)
    db.commit()
    out = foto_service.capturar(db)
    db.refresh(huerfana)
    assert huerfana.estado == "fallida" and huerfana.fin is not None
    assert db.get(Foto, out["foto_id"]).estado == "completa"


def test_foto_reciente_dice_de_que_foto_sale(db):
    foto = Foto(alcance="nasdaq", estado="completa", fin=datetime.now(UTC))
    db.add(foto)
    db.commit()
    datos = NameData(ticker="AAA", sector="Technology", industry="Software", price=9.0,
                     fundamentals_text="", technical_text="")
    fund_mod.foto_guardar(db, "AAA", datos, foto_id=foto.id)
    assert datos.foto_id == foto.id
    assert fund_mod.foto_reciente(db, "AAA").foto_id == foto.id


def _dato(foto_id: int | None) -> NameData:
    return NameData(ticker="X", sector="", industry="", price=None, fundamentals_text="",
                    technical_text="", foto_id=foto_id)


def test_el_escaneo_apunta_la_foto_si_casi_todo_sale_de_ella():
    assert scan_service._foto_de_los_datos([_dato(7)] * 9 + [_dato(None)]) == 7
    assert scan_service._foto_de_los_datos([_dato(7)] * 8 + [_dato(None)] * 2) is None
    assert scan_service._foto_de_los_datos([_dato(None)] * 3) is None
    assert scan_service._foto_de_los_datos([]) is None


def test_la_auditoria_se_cuelga_de_su_escaneo(db):
    lote = datetime(2026, 9, 27, 10, 0, 0, 123456, tzinfo=UTC)
    otro = datetime(2026, 9, 20, 10, 0, 0, tzinfo=UTC)
    db.add_all([ScanAudit(scan_at=lote, ticker="AAA"), ScanAudit(scan_at=lote, ticker="BBB"),
                ScanAudit(scan_at=otro, ticker="CCC")])
    db.commit()
    assert scan_audit.enlazar(db, lote, 42) == 2
    enlazadas = dict(db.query(ScanAudit.ticker, ScanAudit.scan_run_id))
    assert enlazadas == {"AAA": 42, "BBB": 42, "CCC": None}
