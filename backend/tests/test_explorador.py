"""`analytics_explorer`: constructor de filtro puro, sin DuckDB real (mismo criterio que
`test_memoria_troceo.py` — lo que se puede probar sin infraestructura, se prueba sin ella)."""

from __future__ import annotations

import pytest

from app.analytics_explorer import (
    Filtros,
    _limpio,
    construir_snapshot_where,
    construir_universo_where,
    query_contar,
    query_tickers,
)


def test_sin_filtros_es_1_igual_1_sin_parametros() -> None:
    sql, params = construir_snapshot_where(Filtros())
    assert sql == "1=1"
    assert params == []


def test_fecha_mal_formada_revienta_claro() -> None:
    with pytest.raises(ValueError, match="fecha_desde"):
        construir_snapshot_where(Filtros(fecha_desde="27-08-2026"))


def test_rango_de_fechas_liga_ambos_extremos() -> None:
    sql, params = construir_snapshot_where(Filtros(fecha_desde="2026-06-01", fecha_hasta="2026-08-01"))
    assert "captured_at >= ?" in sql
    assert "captured_at < ?" in sql   # hasta = final de ese día, no el día a secas
    assert params == ["2026-06-01", "2026-08-01"]


def test_lista_de_sectores_liga_un_marcador_por_valor() -> None:
    sql, params = construir_snapshot_where(Filtros(sectores=["Technology", "Healthcare"]))
    assert "sector in (?, ?)" in sql
    assert params == ["Technology", "Healthcare"]


def test_sectores_vacios_no_meten_clausula() -> None:
    sql, params = construir_snapshot_where(Filtros(sectores=[], industrias=[]))
    assert sql == "1=1"
    assert params == []


def test_texto_libre_liga_dos_comodines() -> None:
    sql, params = construir_snapshot_where(Filtros(q="AAPL"))
    assert "ilike ?" in sql
    assert params == ["%AAPL%", "%AAPL%"]


def test_rango_numerico_solo_liga_lo_que_se_pide() -> None:
    sql, params = construir_snapshot_where(Filtros(market_cap_min=1e9))
    assert "market_cap_usd >= ?" in sql
    assert "market_cap_usd <= ?" not in sql
    assert params == [1e9]


def test_cerca_del_maximo_descarta_nulos_explicito() -> None:
    sql, params = construir_snapshot_where(Filtros(cerca_max_pct=10.0))
    assert "high_52w is not null" in sql
    assert params == [10.0]


def test_alcance_true_false_y_none_se_distinguen() -> None:
    _, p_global = construir_snapshot_where(Filtros(alcance=True))
    _, p_escaneo = construir_snapshot_where(Filtros(alcance=False))
    _, p_ambos = construir_snapshot_where(Filtros())
    assert p_global == [True]
    assert p_escaneo == [False]
    assert p_ambos == []


def test_pais_y_mercado_van_al_where_del_universo_no_del_snapshot() -> None:
    snap_sql, snap_params = construir_snapshot_where(Filtros(paises=["Spain"], mercados=["NASDAQ"]))
    uni_sql, uni_params = construir_universo_where(Filtros(paises=["Spain"], mercados=["NASDAQ"]))
    assert snap_sql == "1=1" and snap_params == []          # no son columnas de fundamentals_snapshot
    assert "country in (?)" in uni_sql and "exchange in (?)" in uni_sql
    assert uni_params == ["Spain", "NASDAQ"]


def test_query_contar_liga_los_mismos_parametros_que_el_filtro() -> None:
    f = Filtros(sectores=["Technology"], market_cap_min=1e9, paises=["USA"])
    sql, params = query_contar(f)
    assert "count(*)" in sql and "quantile_cont" in sql
    assert params == ["Technology", 1e9, "USA"]   # snapshot primero, universo después


def test_query_tickers_anade_limit_offset_al_final() -> None:
    f = Filtros(sectores=["Technology"])
    sql, params = query_tickers(f, limit=25, offset=50)
    assert sql.strip().endswith("limit ? offset ?")
    assert params[-2:] == [25, 50]
    assert params[:-2] == ["Technology"]


# ---- _limpio: NaN/NaT de pandas -> None, JSON no entiende NaN ----

def test_limpio_convierte_nan_a_none() -> None:
    assert _limpio(float("nan")) is None


def test_limpio_deja_none_como_none() -> None:
    assert _limpio(None) is None


def test_limpio_deja_numeros_normales_intactos() -> None:
    assert _limpio(42.5) == 42.5
    assert _limpio(0.0) == 0.0   # 0 no es None ni NaN, no debe colarse por el `if v is None`
