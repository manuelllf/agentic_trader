"""Tests de la memoria macro: el outlook inyecta su propia tesis del escaneo anterior (Meta
"last_scan_report") en el USER prompt, pidiendo explícitamente qué cambió desde entonces — igual
que ya hace el scorer por nombre con `prior_thesis`. Sin sesión, sin fila, o con datos rotos o
vacíos, el prompt debe quedar EXACTAMENTE igual que hoy (nada de bloque vacío ni "n/d" inventado).
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app.db import Base
from app.models import Meta
from app.screener import events as events_mod
from app.screener import macro as macro_mod


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


class _CapturingLLM:
    """LLM falso que responde un outlook fijo y CAPTURA el user prompt que recibió."""

    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.last_user: str = ""

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        self.last_user = user
        return self._reply


_REPLY = json.dumps({"regime": "neutral", "outlook": "Nueva tesis.",
                     "favored_sectors": [], "avoided_sectors": []})


@pytest.fixture(autouse=True)
def _sin_red(monkeypatch):
    """Aísla el outlook de la red real: régimen determinista, snapshot vacío y fuentes de eventos
    mudas (su comportamiento best-effort ya se prueba en otros módulos; aquí solo importa el
    bloque de memoria). También resetea la caché de módulo entre casos: sin esto, el segundo test
    del mismo minuto reutilizaría el resultado cacheado del primero."""
    monkeypatch.setattr(macro_mod, "get_macro_regime",
                        lambda: {"regime": "neutral", "spy_above_ma200": True, "vix": 15.0})
    monkeypatch.setattr(macro_mod, "_snapshot_text", lambda: ("n/d", []))
    monkeypatch.setattr(events_mod, "wikipedia_current_events", lambda *a, **k: "")
    monkeypatch.setattr(events_mod, "wikipedia_scheduled_events", lambda *a, **k: "")
    monkeypatch.setattr(events_mod, "gdelt_headlines", lambda *a, **k: [])
    monkeypatch.setattr(events_mod, "google_news_headlines", lambda *a, **k: [])
    macro_mod._outlook_cache = None
    yield
    macro_mod._outlook_cache = None


def test_memoria_inyecta_la_tesis_anterior_con_fecha(db) -> None:
    """Con `last_scan_report` sembrado (outlook + fecha), el user prompt lleva la tesis previa,
    la fecha en YYYY-MM-DD extraída de `at`, y el pie que pide evaluar qué cambió."""
    db.add(Meta(key="last_scan_report", value=json.dumps(
        {"at": "2026-07-28T14:15:00+00:00", "outlook": "X"})))
    db.commit()

    llm = _CapturingLLM(_REPLY)
    macro_mod.get_macro_outlook(llm, db=db)

    assert "Your previous 3-month outlook, written on 2026-07-28" in llm.last_user
    assert "X" in llm.last_user
    assert "Assess explicitly what has changed since then." in llm.last_user


def test_sin_fila_meta_no_hay_bloque_de_memoria(db) -> None:
    """Sin fila `last_scan_report` en Meta, el prompt no lleva ningún bloque de memoria."""
    llm = _CapturingLLM(_REPLY)
    macro_mod.get_macro_outlook(llm, db=db)
    assert "Your previous" not in llm.last_user


# ---- constructor: cash_pct fuera del prompt (mismo lote de cambios de prompt) ----

def test_constructor_prompt_no_pide_cash_pct() -> None:
    """El diseño es 100% invertido (sin caja) y el código ya normaliza cash_pct a 0; pedírselo
    al modelo en el JSON de respuesta era una señal contradictoria. El parseo sigue tolerando
    que el modelo lo mande igualmente (guarda existente), pero el TEXTO del prompt ya no lo pide.

    Vive aquí y no en test_ranker: este fichero es el del lote de cambios de prompts, y así el
    commit que los lleva es autocontenido (el test no puede adelantarse al cambio que prueba)."""
    from app.agents import constructor as constructor_mod

    captured: dict[str, str] = {}

    class _Capturing:
        def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
            captured["system"] = system
            captured["user"] = user
            return json.dumps({"positions": [
                {"ticker": "AAA", "weight_pct": 100, "thesis": "t", "edge": "e", "risk": "r"}],
                "summary": "s"})

    constructor_mod.construct(_Capturing(), "cartera", "candidatos", "macro",
                              max_positions=1, max_position_pct=100.0, valid_tickers={"AAA"})
    assert "cash_pct" not in captured["system"]
    assert "cash_pct" not in captured["user"]


def test_prompt_sin_sesgo_direccional(db) -> None:
    """Regla crítica del encargo: cero palabras que empujen la tesis en una dirección (ni a
    mantenerla ni a cambiarla). Ninguna de estas debe colarse en el prompt con memoria."""
    db.add(Meta(key="last_scan_report", value=json.dumps(
        {"at": "2026-07-28T14:15:00+00:00", "outlook": "X"})))
    db.commit()

    llm = _CapturingLLM(_REPLY)
    macro_mod.get_macro_outlook(llm, db=db)

    bajo = llm.last_user.lower()
    for palabra in ("consistency", "consistent", "confirm", "maintain", "revise"):
        assert palabra not in bajo
