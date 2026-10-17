"""Captura aislada, sin red."""
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

from app.liga.procesos import omega


class FotoDB:
    def __init__(self):
        self.foto = {}
        self.origen = [SimpleNamespace(id=1, ticker="AAA", created_at=None,
                                      entry_date=date(2026, 10, 1), estado="descartada")]

    def execute(self, sql, params):
        sql = str(sql)
        if "from momentum_senales" in sql:
            assert "estado <>" not in sql
            assert "not (coalesce(s.resuelta" in sql
            filas = [f for f in self.origen if f.id not in self.foto and f.id > params["ultimo"]]
            return SimpleNamespace(all=lambda: filas)
        if "insert into liga.omega_alertas" in sql:
            for f in params:
                self.foto.setdefault(f["s"], f)
            return None
        assert "from liga.omega_alertas" in sql
        filas = [SimpleNamespace(senal_id=f["s"], ticker=f["t"], nace_en=f["n"],
                                 market_cap_usd=f["c"]) for f in self.foto.values()]
        return SimpleNamespace(all=lambda: filas)


def test_captura_idempotente_incluye_descartadas():
    db = FotoDB()
    llamadas = []

    def pedir(ticker):
        llamadas.append(ticker)
        return Decimal(100)
    assert omega.capturar_alertas(db, pedir) == 1
    assert omega.capturar_alertas(db, pedir) == 0
    assert llamadas == ["AAA"]
    assert db.foto[1]["e"] == "descartada"
    assert db.foto[1]["n"].hour == 16
    assert db.foto[1]["n"].utcoffset().total_seconds() == -14400
    alertas = omega.alertas(db, date(2026, 10, 1), date(2026, 10, 1))
    assert alertas[0].market_cap == 100


def test_yfinance_caido_guarda_null(monkeypatch, caplog):
    def caido(ticker):
        raise RuntimeError("offline")
    monkeypatch.setattr(omega, "capitalizacion_yfinance", caido)
    db = FotoDB()
    assert omega.capturar_alertas(db) == 1
    assert db.foto[1]["c"] is None
    assert "Sin capitalización de AAA" in caplog.text


def test_created_at_se_conserva():
    db = FotoDB()
    instante = datetime(2026, 10, 1, 14, tzinfo=omega.TZ_BOLSA)
    db.origen[0].created_at = instante
    omega.capturar_alertas(db, lambda _: None)
    assert db.foto[1]["n"] == instante
