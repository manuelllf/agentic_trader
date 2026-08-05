"""Tests de dos añadidos a scan_service: la capa media estratificada (repuntúa los mejores de
cada sector con un modelo mejor antes del corte a finalistas) y el guardarraíl de operación
corporativa (corrige en código un target_price que mezcla enterprise value con precio por
acción). LLM falso y DB en memoria (patrón de test_escaneo_trazas.py) — nunca toca OpenRouter."""

from __future__ import annotations

import json
import re

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import (
    models,  # noqa: F401  (registra las tablas)
    scan_service,
)
from app.db import Base
from app.models import ScanRun, Score


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _stub_universo(monkeypatch, symbols: list[str]) -> None:
    """Universo fijo, como si viniera de la foto del último cierre."""
    from app.screener import universe as universe_mod

    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        list(symbols),
        {"fuente": "cierre", "at": "2026-08-04T20:30:00+00:00", "dias": 0, "size": len(symbols)},
    ))


def _stub_common(monkeypatch) -> None:
    """El resto del pipeline (macro, memoria, precios en vivo, tope de posiciones) baratamente
    stubeado — igual que en test_escaneo_trazas.py."""
    from app import tracking
    from app.screener import macro as macro_mod

    monkeypatch.setattr(scan_service, "_memory_store", lambda: None)
    monkeypatch.setattr(macro_mod, "get_macro_outlook", lambda llm, db=None: {
        "regime": "neutral", "vix": 15.0, "outlook": "estable",
        "favored_sectors": [], "avoided_sectors": [], "snapshot": "n/d",
    })
    monkeypatch.setattr(tracking, "live_prices", lambda tickers: dict.fromkeys(tickers, 100.0))
    monkeypatch.setattr(scan_service.settings, "max_position_pct", 100.0)
    monkeypatch.setattr(scan_service.settings, "min_positions", 1)


def _gather_stub(monkeypatch, sectors: dict[str, str], target_high: dict[str, float] | None = None):
    from app.screener import fundamentals as fund_mod
    from app.screener.fundamentals import NameData

    th = target_high or {}
    monkeypatch.setattr(fund_mod, "gather", lambda t: NameData(
        ticker=t, sector=sectors[t], industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9,
        news=[], target_high=th.get(t),
    ))


class ScoringLLM:
    """Simula el prescore/capa-media: lee el ticker del prompt (primer token) y devuelve el
    score que le corresponda. Registra qué tickers puntuó (para comprobar el carril de entrada)."""

    def __init__(self, scores: dict[str, float]) -> None:
        self.scores = scores
        self.called: list[str] = []

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        ticker = user.split()[0]
        self.called.append(ticker)
        return json.dumps({"score": self.scores.get(ticker, 0), "headline": f"pre-{ticker}"})


class DeepLLM:
    """Sirve tanto al informe profundo (prompt con 'Company: TICKER') como a la construcción
    (sin ese patrón, cae al fallback). Cada consumidor solo lee las claves que le importan."""

    def __init__(self, replies: dict[str, dict]) -> None:
        self.replies = replies

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        m = re.search(r"Company: (\S+)", user)
        if m and m.group(1) in self.replies:
            return json.dumps(self.replies[m.group(1)])
        # Construcción: pesos iguales entre todos los nombres puntuados (fallback genérico).
        tickers = list(self.replies)
        w = round(100.0 / len(tickers), 2) if tickers else 0.0
        positions = [{"ticker": t, "weight_pct": w, "thesis": "t", "edge": "e", "risk": "r"}
                    for t in tickers]
        return json.dumps({"cash_pct": 0, "positions": positions, "summary": "cartera"})


def _stub_llms(monkeypatch, prescore_scores: dict, mid_scores: dict, deep_replies: dict):
    from app.config import settings as cfg

    prescore_llm = ScoringLLM(prescore_scores)
    mid_llm = ScoringLLM(mid_scores)
    deep_llm = DeepLLM(deep_replies)

    def fake_get_llm(model: str | None = None):
        if model == cfg.mid_model:
            return mid_llm
        if model == cfg.prescore_model:
            return prescore_llm
        return deep_llm

    monkeypatch.setattr(scan_service, "get_llm", fake_get_llm)
    return prescore_llm, mid_llm, deep_llm


# ---- (a)/(b) capa media estratificada ------------------------------------------

_SECTORS = {"TA1": "Tech", "TA2": "Tech", "HA1": "Health", "HA2": "Health"}
_PRESCORE = {"TA1": 90.0, "TA2": 80.0, "HA1": 70.0, "HA2": 95.0}
_MID = {"TA1": 99.0, "HA2": 50.0}   # solo top-1/sector recibe capa media


def _deep_ok(ticker: str) -> dict:
    return {"score": 85, "headline": f"deep-{ticker}", "report": "informe", "target_price": 150.0}


def test_capa_media_repuntua_top_por_sector_y_manda_en_el_carril_global(db, monkeypatch) -> None:
    """Con mid_layer activado: solo se repuntúan los top-1/sector (TA1 y HA2) y el carril
    global sale de ESE score, no del pre-score crudo (que habría elegido a HA2, no a TA1)."""
    _stub_common(monkeypatch)
    _stub_universo(monkeypatch, list(_SECTORS))
    _gather_stub(monkeypatch, _SECTORS)
    _, mid_llm, _ = _stub_llms(monkeypatch, _PRESCORE, _MID, {"TA1": _deep_ok("TA1")})

    monkeypatch.setattr(scan_service.settings, "mid_layer", True)
    monkeypatch.setattr(scan_service.settings, "mid_per_sector", 1)
    monkeypatch.setattr(scan_service.settings, "deep_per_sector", 0)
    # A 0 también el carril sectorial CON capa media: así el único finalista sale del carril
    # global y el test mide lo que dice medir (que manda el score de la capa media).
    monkeypatch.setattr(scan_service.settings, "deep_per_sector_mid", 0)
    monkeypatch.setattr(scan_service.settings, "deep_top_caps", 0)
    monkeypatch.setattr(scan_service.settings, "deep_watchlist", 0)
    monkeypatch.setattr(scan_service.settings, "deep_finalists", 1)

    result = scan_service.run_scan_and_store(db, sample_size=4, decide=True)

    assert set(mid_llm.called) == {"TA1", "HA2"}     # solo el top-1 de cada sector
    assert result["deep"] == 1
    assert {s.ticker for s in db.query(Score).all()} == {"TA1"}   # gana por el score de capa media


def test_capa_media_desactivada_usa_el_pre_score_crudo_como_antes(db, monkeypatch) -> None:
    """Con mid_layer desactivado, el carril global vuelve a salir del pre-score crudo: gana
    HA2 (95), no TA1 (90) — el comportamiento previo a este cambio, intacto."""
    _stub_common(monkeypatch)
    _stub_universo(monkeypatch, list(_SECTORS))
    _gather_stub(monkeypatch, _SECTORS)
    _, mid_llm, _ = _stub_llms(monkeypatch, _PRESCORE, _MID, {"HA2": _deep_ok("HA2")})

    monkeypatch.setattr(scan_service.settings, "mid_layer", False)
    monkeypatch.setattr(scan_service.settings, "deep_per_sector", 0)
    monkeypatch.setattr(scan_service.settings, "deep_top_caps", 0)
    monkeypatch.setattr(scan_service.settings, "deep_watchlist", 0)
    monkeypatch.setattr(scan_service.settings, "deep_finalists", 1)

    result = scan_service.run_scan_and_store(db, sample_size=4, decide=True)

    assert mid_llm.called == []                      # la capa media ni se invoca
    assert result["deep"] == 1
    assert {s.ticker for s in db.query(Score).all()} == {"HA2"}
    assert "mid_model" not in result["cost"]["by_model"]


def test_observatorio_no_paga_la_capa_media(db, monkeypatch) -> None:
    """El semanal no toca ningún libro: afinar con el modelo caro un ranking que no se ejecuta
    no compra nada, así que la capa media queda reservada a los escaneos que deciden."""
    _stub_common(monkeypatch)
    _stub_universo(monkeypatch, list(_SECTORS))
    _gather_stub(monkeypatch, _SECTORS)
    _, mid_llm, _ = _stub_llms(monkeypatch, _PRESCORE, _MID, {"HA2": _deep_ok("HA2")})

    monkeypatch.setattr(scan_service.settings, "mid_layer", True)
    monkeypatch.setattr(scan_service.settings, "mid_per_sector", 1)
    monkeypatch.setattr(scan_service.settings, "deep_per_sector", 0)
    monkeypatch.setattr(scan_service.settings, "deep_top_caps", 0)
    monkeypatch.setattr(scan_service.settings, "deep_watchlist", 0)
    monkeypatch.setattr(scan_service.settings, "deep_finalists", 1)

    scan_service.run_scan_and_store(db, sample_size=4, decide=False)

    assert mid_llm.called == []


# ---- (c)/(d) guardarraíl de operación corporativa ------------------------------

_OPA_SECTORS = {"OPA1": "Industrials", "NORMAL": "Industrials"}
_OPA_TARGET_HIGH = {"OPA1": 100.0, "NORMAL": 100.0}
_OPA_REPLIES = {
    "OPA1": {
        "score": 85, "headline": "opa",
        "report": "La compañía recibió una oferta de adquisición en efectivo de un fondo.",
        "target_price": 120.0,   # 20% por encima del máximo del consenso (100)
    },
    "NORMAL": {
        "score": 70, "headline": "normal",
        "report": "Crecimiento sólido de ingresos y márgenes estables este trimestre.",
        "target_price": 130.0,   # también por encima del consenso, pero SIN texto de operación
    },
}


def test_opa_con_texto_de_adquisicion_y_target_disparado_queda_marcada(db, monkeypatch) -> None:
    _stub_common(monkeypatch)
    _stub_universo(monkeypatch, list(_OPA_SECTORS))
    _gather_stub(monkeypatch, _OPA_SECTORS, _OPA_TARGET_HIGH)
    prescore_scores = {t: 80.0 for t in _OPA_SECTORS}
    _stub_llms(monkeypatch, prescore_scores, {}, _OPA_REPLIES)
    monkeypatch.setattr(scan_service.settings, "mid_layer", False)

    scan_service.run_scan_and_store(db, sample_size=2, decide=True)

    opa = db.query(Score).filter(Score.ticker == "OPA1").one()
    assert opa.target_flagged is True
    assert opa.target_raw == 120.0
    assert opa.target_price == 100.0                  # acotado al máximo del consenso

    run = db.query(ScanRun).one()
    assert any("OPA1" in i and "120" in i and "100" in i for i in run.issues)


def test_informe_normal_con_target_alto_sin_texto_de_operacion_no_se_toca(db, monkeypatch) -> None:
    _stub_common(monkeypatch)
    _stub_universo(monkeypatch, list(_OPA_SECTORS))
    _gather_stub(monkeypatch, _OPA_SECTORS, _OPA_TARGET_HIGH)
    prescore_scores = {t: 80.0 for t in _OPA_SECTORS}
    _stub_llms(monkeypatch, prescore_scores, {}, _OPA_REPLIES)
    monkeypatch.setattr(scan_service.settings, "mid_layer", False)

    scan_service.run_scan_and_store(db, sample_size=2, decide=True)

    normal = db.query(Score).filter(Score.ticker == "NORMAL").one()
    assert normal.target_flagged is False
    assert normal.target_raw is None
    assert normal.target_price == 130.0               # el modelo manda, no se corrige
