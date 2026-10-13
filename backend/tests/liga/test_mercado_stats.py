from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.liga import mercado_stats as stats
from app.liga.estrategias import Contexto
from app.liga.motor.catalogo import EmpresaFoto


@pytest.mark.parametrize("clave,campo,valores", [
    ("barata", "per", (-3, 20, 1000)),
    ("liquidez", "volumen_usd_dia", (0, 1, 1000)),
    ("tamano", "market_cap_usd", (1, 1000000000, 9000000000000)),
])
def test_histograma_y_cobertura(clave, campo, valores):
    empresas = tuple(EmpresaFoto(str(i), precio=10, **{campo: v})
                     for i, v in enumerate((*valores, None)))
    empresas += (EmpresaFoto("sin_precio", **{campo: 50}),)
    ctx = Contexto(1, 2, False, empresas, {})
    salida = stats.calcular_mercado(ctx, "2026-10-01T00:00:00+00:00")
    regla = salida["reglas"][clave]
    assert salida["n"] == 4
    assert regla["cobertura"] == 75
    assert len(regla["histograma"]) == 36
    assert sum(regla["histograma"]) == 3
    assert regla["histograma"][0] == 1 and regla["histograma"][-1] == 1
    assert regla["mediana"] == (1000 if clave == "tamano" else valores[1])
    assert len(salida["estilos"]) == 7


def test_bandas_limites_y_sin_datos():
    empresas = [EmpresaFoto(str(v), market_cap_usd=v * 1000000)
                for v in (20, 300, 2000, 10000, 200000)]
    assert stats.tamanos(empresas) == dict.fromkeys(stats.BANDAS, 1)
    salida = stats.calcular_mercado(Contexto(1, 2, False, (), {}), None)
    assert salida["n"] == 0
    assert all(sum(r["histograma"]) == 0 for r in salida["reglas"].values())


def test_cache_por_foto_y_scan_y_caducidad(monkeypatch):
    stats._cache.clear()
    ctx = Contexto(1, 2, False, (), {})
    monkeypatch.setattr(stats.estrategias, "contexto_de_referencia", lambda: ctx)
    reloj = [0]
    monkeypatch.setattr(stats.time, "monotonic", lambda: reloj[0])
    consultas = []
    fecha = datetime(2026, 10, 1, tzinfo=UTC)
    class DB:
        def execute(self, sql, params):
            consultas.append(params["id"])
            return SimpleNamespace(scalar=lambda: fecha)
        def close(self):
            pass
    monkeypatch.setattr(stats, "fabrica_sistema", DB)
    salida = stats.mercado()
    assert salida["notas_del"] == fecha.isoformat()
    salida["n"] = 99
    assert stats.mercado()["n"] == 0
    assert consultas == [2]
    reloj[0] = 601
    stats.mercado()
    ctx = Contexto(1, 3, False, (), {})
    stats.mercado()
    ctx = Contexto(2, 3, False, (), {})
    stats.mercado()
    ctx = Contexto(1, 3, False, (), {})
    stats.mercado()
    assert consultas == [2, 2, 3, 3]
    stats._cache.clear()


def test_ruta_exige_jugador(monkeypatch):
    from app.liga.auth import require_jugador
    from app.liga.rutas_estrategias import router
    ruta = next(r for r in router.routes if r.path == "/catalogo/mercado")
    assert any(d.call is require_jugador for d in ruta.dependant.dependencies)
