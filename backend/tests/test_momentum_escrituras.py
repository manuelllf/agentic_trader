"""Escrituras de Omega con las clases de `models.py` (sin SQL a mano): cada una sobre el esquema
declarado, que es el mismo que el script de deriva compara con Supabase."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.db import Base
from app.models import (
    MomentumApewisdom,
    MomentumCandidato,
    MomentumEjecucion,
    MomentumGateLlamada,
    MomentumSenal,
    MomentumUniverso,
    MomentumUniversoEstado,
)
from app.momentum import apewisdom, candidatos, gate_runner, signals
from app.momentum import routes as rutas


@pytest.fixture
def sesiones(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    fabrica = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr("app.push.send_to_all", lambda *a, **kw: None)
    monkeypatch.setattr(signals, "UNIVERSO", ["AAA"])
    return fabrica


@pytest.fixture
def db(sesiones):
    s = sesiones()
    yield s
    s.close()


def _senal(db, ticker: str = "AAA", estado: str = "nueva") -> MomentumSenal:
    s = MomentumSenal(ticker=ticker, sector="Espacio", tipo="zigzag", entry_date=date(2026, 9, 1),
                      entry_price=Decimal("10"), ref_label="pico", ref_price=Decimal("20"),
                      caida_pct=Decimal("-50"), ath=Decimal("30"), estado=estado,
                      desde_noticias=date(2026, 8, 25))
    db.add(s)
    db.commit()
    return s


def test_apewisdom_no_duplica_en_la_misma_tanda_ni_entre_tandas(db, monkeypatch) -> None:
    fila = {"ticker": "zzz", "rank": "1", "mentions": "50", "mentions_24h_ago": "5",
            "upvotes": "x"}
    resp = SimpleNamespace(raise_for_status=lambda: None,
                           json=lambda: {"results": [fila, dict(fila)]})
    monkeypatch.setattr(apewisdom.httpx, "get", lambda *a, **k: resp)

    assert apewisdom.capturar(db) == 1
    assert apewisdom.capturar(db) == 0
    guardada = db.scalars(select(MomentumApewisdom)).one()
    assert (guardada.ticker, guardada.mentions, guardada.upvotes) == ("ZZZ", 50, None)


def test_ruptura_crea_candidato_y_alta_manual_devuelve_la_fila(db) -> None:
    db.add(MomentumApewisdom(fecha=date.today(), ticker="ZZZ", mentions=60, mentions_24h_ago=10))
    db.commit()

    assert candidatos.detectar_rupturas(db) == 1
    assert candidatos.detectar_rupturas(db) == 0            # no se reabre en 30 días
    manual = candidatos.crear_manual(" qqq ", db)
    assert (manual["ticker"], manual["decision"], manual["decidido_por"]) == (
        "QQQ", "pendiente", "sistema")


def test_filtros_y_decision_actualizan_el_candidato_y_el_universo(db, monkeypatch) -> None:
    fila = candidatos.crear_manual("ZZZ", db)
    monkeypatch.setattr(candidatos, "_info_yfinance",
                        lambda t: {"sector": "Technology", "industry": "Software",
                                   "shortName": "Zeta"})
    monkeypatch.setattr(signals, "señales_de_ticker", lambda t: [])
    monkeypatch.setattr(candidatos, "backfill_señales", lambda t, db: None)

    out = candidatos.comprobar_filtros(fila["id"], db)
    assert (out["filtro_sector_pass"], out["estadistica_pass"], out["nombre"]) == (
        True, False, "Zeta")

    rutas.decidir_candidato(fila["id"], rutas.CandidatoDecisionIn(decision="incorporado"), db)
    cand = db.get(MomentumCandidato, fila["id"])
    db.refresh(cand)
    assert (cand.decision, cand.decidido_por) == ("incorporado", "manual")
    uni = db.get(MomentumUniverso, "ZZZ")
    assert (uni.sector, uni.nombre, uni.origen) == ("Technology", "Zeta", "incorporado")


def test_mantener_crea_y_luego_actualiza(db, monkeypatch) -> None:
    monkeypatch.setattr(candidatos, "sincronizar_universo", lambda db: 0)
    rutas.set_mantener("aaa", rutas.MantenerIn(mantener=False), db)
    rutas.set_mantener("aaa", rutas.MantenerIn(mantener=True), db)
    estado = db.get(MomentumUniversoEstado, "AAA")
    db.refresh(estado)
    assert estado.mantener is True


def test_ejecutar_guarda_dinero_exacto_y_recalcula_el_estado(db) -> None:
    s = _senal(db)
    rutas.ejecutar(s.id, rutas.EjecucionIn(accion="compra", acciones=10, precio=10.35), db)
    out = rutas.ejecutar(s.id, rutas.EjecucionIn(accion="venta", acciones=10, precio=13.0), db)

    assert out["estado"] == "vendida"
    ej = db.scalars(select(MomentumEjecucion).order_by(MomentumEjecucion.id)).first()
    assert Decimal(str(ej.precio)) == Decimal("10.35")
    rutas.descartar(s.id, db)
    db.refresh(s)
    assert s.estado == "descartada"


def test_gate_de_senales_traza_la_llamada_y_marca_la_senal(sesiones, db, monkeypatch) -> None:
    s = _senal(db)
    monkeypatch.setattr(gate_runner, "SessionLocal", sesiones)
    monkeypatch.setattr(gate_runner.news_gate, "evaluar",
                        lambda *a, **k: SimpleNamespace(pasa=False, motivo="fraude"))
    gate_runner._run([s.id])

    db.refresh(s)
    assert (s.gate_resultado, s.estado, s.gate_detalle) == ("falla", "descartada", "fraude")
    llamada = db.scalars(select(MomentumGateLlamada)).one()
    assert (llamada.ok, llamada.pasa, llamada.senal_id) == (True, False, s.id)
    assert llamada.terminado_at is not None


def test_gate_de_senales_con_fallo_deja_la_llamada_con_error(sesiones, db, monkeypatch) -> None:
    s = _senal(db)
    monkeypatch.setattr(gate_runner, "SessionLocal", sesiones)

    def _boom(*_a, **_k):
        raise RuntimeError("timeout")

    monkeypatch.setattr(gate_runner.news_gate, "evaluar", _boom)
    gate_runner._run([s.id])

    llamada = db.scalars(select(MomentumGateLlamada)).one()
    assert (llamada.ok, llamada.error) == (False, "timeout")
    db.refresh(s)
    assert s.gate_resultado is None


def test_gate_de_candidato_informa_sin_decidir(db, monkeypatch) -> None:
    fila = candidatos.crear_manual("ZZZ", db)
    monkeypatch.setattr(candidatos.news_gate, "evaluar",
                        lambda *a, **k: SimpleNamespace(pasa=True, motivo="pánico"))
    reciente = {"ath": 30, "entry_date": datetime(2026, 9, 1), "entry_price": 10,
                "caida_pct": -50, "desde_noticias": datetime(2026, 8, 25)}
    candidatos._lanzar_gate_candidato(fila["id"], "ZZZ", "Zeta", reciente, db)

    cand = db.get(MomentumCandidato, fila["id"])
    db.refresh(cand)
    assert (cand.gate_pass, cand.gate_detalle, cand.decision) == (True, "pánico", "pendiente")
    assert db.scalars(select(MomentumGateLlamada)).one().candidato_id == fila["id"]


def test_los_modelos_cubren_las_tablas_de_omega() -> None:
    tablas = set(Base.metadata.tables)
    assert {"momentum_senales", "momentum_ejecuciones", "momentum_candidatos",
            "momentum_apewisdom", "momentum_gate_llamadas", "momentum_universo",
            "momentum_universo_estado", "memories", "memory_chunks"} <= tablas
    assert models.Vector(384).get_col_spec() == "VECTOR(384)"
