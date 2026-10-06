"""Curva y riesgo a partir de posiciones y cierres guardados, sin precios nuevos ni modelos."""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import precios
from app.i18n import current_locale, translate
from app.liga.motor.catalogo import CATALOGO, CATALOGO_VERSION, validar_reglas
from app.liga.motor.mensajes import Regla, presentar

MIN_OBSERVACIONES = 60
SESIONES_ANUALES = 252


def metricas_diarias(retornos: Sequence[float], niveles: Sequence[float],
                     minimo: int = MIN_OBSERVACIONES) -> dict:
    """Anualiza con rf y MAR cero, desviación muestral y downside RMS; exige `minimo` retornos."""
    n = len(retornos)
    if any(not math.isfinite(r) for r in retornos) or any(
        not math.isfinite(nivel) for nivel in niveles
    ):
        return {"sharpe": None, "sortino": None, "volatilidad": None,
                "max_drawdown": None, "observaciones": 0}
    if n < minimo:
        return {"sharpe": None, "sortino": None, "volatilidad": None,
                "max_drawdown": _drawdown(niveles), "observaciones": n}
    media = sum(retornos) / n
    if not math.isfinite(media):
        return {"sharpe": None, "sortino": None, "volatilidad": None,
                "max_drawdown": _drawdown(niveles), "observaciones": n}
    var = sum((r - media) ** 2 for r in retornos) / (n - 1)
    vol_diaria = math.sqrt(var)
    downside = math.sqrt(sum(min(r, 0.0) ** 2 for r in retornos) / n)
    if not math.isfinite(vol_diaria) or not math.isfinite(downside):
        return {"sharpe": None, "sortino": None, "volatilidad": None,
                "max_drawdown": _drawdown(niveles), "observaciones": n}
    if math.isclose(vol_diaria, 0.0, rel_tol=0.0, abs_tol=1e-12):
        vol_diaria = 0.0
    if math.isclose(downside, 0.0, rel_tol=0.0, abs_tol=1e-12):
        downside = 0.0
    sharpe = (media / vol_diaria * math.sqrt(SESIONES_ANUALES)
              if vol_diaria and math.isfinite(vol_diaria) else None)
    sortino = (media / downside * math.sqrt(SESIONES_ANUALES)
               if downside and math.isfinite(downside) else None)
    volatilidad = (vol_diaria * math.sqrt(SESIONES_ANUALES)
                   if math.isfinite(vol_diaria) else None)
    if sharpe is not None and not math.isfinite(sharpe):
        sharpe = None
    if sortino is not None and not math.isfinite(sortino):
        sortino = None
    if not math.isfinite(volatilidad):
        volatilidad = None
    return {
        "sharpe": sharpe,
        "sortino": sortino,
        "volatilidad": volatilidad,
        "max_drawdown": _drawdown(niveles),
        "observaciones": n,
    }


def _drawdown(niveles: Sequence[float]) -> float | None:
    if not niveles or any(not math.isfinite(nivel) for nivel in niveles):
        return None
    pico = niveles[0]
    peor = 0.0
    for nivel in niveles:
        pico = max(pico, nivel)
        if pico > 0:
            peor = min(peor, nivel / pico - 1)
    return peor


def datos_ficha(db: Session, estrategia_id: str, usuario_id: str | None = None,
                solo_cerradas: bool = False) -> dict:
    """Serie pública según jornadas guardadas, con jornada abierta marcada como provisional.
    `solo_cerradas`: lo que ve quien aún no puede seguir la cartera en directo."""
    jornadas = db.execute(text("""
        select j.id as jornada_id, j.numero as jornada_numero, j.dia_base, j.dia_fin,
               j.estado as estado_jornada, j.foto_id, j.scan_run_id,
               i.id as inscripcion_id, i.receta_id, i.n_pasan
        from liga.inscripciones i join liga.jornadas j on j.id = i.jornada_id
        where i.estrategia_id = :e and j.estado = any(:estados)
        order by j.dia_base, j.id
    """), {"e": estrategia_id,
           "estados": ["cerrada"] if solo_cerradas else ["formada", "cerrada"]}).mappings().all()
    if not jornadas:
        return _sin_datos()

    by_round: list[tuple[date, date, bool, list[tuple[str, Decimal]]]] = []
    tickers: set[str] = {precios.REFERENCIA}
    for j in jornadas:
        posiciones = db.execute(text("""
            select ticker, peso from liga.posiciones where inscripcion_id = :i order by ticker
        """), {"i": j["inscripcion_id"]}).all()
        holdings = [(t, Decimal(str(w))) for t, w in posiciones]
        tickers.update(t for t, _ in holdings)
        by_round.append((j["dia_base"], j["dia_fin"], j["estado_jornada"] == "cerrada", holdings))
    series = precios.series(db, sorted(tickers), desde=min(r[0] for r in by_round))
    as_of = precios.fecha_mercado(datetime.now(UTC))
    market_end = max(fin if oficial else min(fin, as_of)
                     for _, fin, oficial, _ in by_round)
    from app.liga.motor.calendario import dias_de_bolsa

    sessions = dias_de_bolsa(min(base for base, _, _, _ in by_round), market_end)
    out = _serie_guardada(by_round, series, as_of, sessions,
                          numeros=[j["jornada_numero"] for j in jornadas])
    out["evidencia"] = None
    if usuario_id is not None:
        from app.liga import estrategias

        contexto = estrategias.evidencia_formacion_ficha(usuario_id, estrategia_id)
        if contexto is not None:
            out["evidencia"] = _evidencia_formacion(contexto, series, as_of, sessions)
    return out


def _resultado_reglas(receta, empresa) -> tuple[list[dict], str]:  # noqa: ANN001
    """Evaluate a ticker only with the recipe and fundamentals captured for its formation."""
    if receta is None:
        return [], "sin_receta"
    reglas = receta.reglas or []
    if receta.catalogo_version != CATALOGO_VERSION:
        return _reglas_no_disponibles(reglas), "version_no_soportada"
    if validar_reglas(reglas):
        return _reglas_no_disponibles(reglas), "receta_no_evaluable"
    salida = []
    for item in reglas:
        clave = item["clave"]
        regla = CATALOGO[clave]
        params = item.get("params") or {}
        idioma = current_locale.get()
        detalle = presentar(regla.detalle(params), idioma)
        titulo = Regla(clave).redactar(idioma)
        if empresa is None:
            salida.append({"clave": clave, "titulo": titulo, "detalle": detalle,
                           "cumple": None, "motivo": translate("liga_rend_no_figura")})
            continue
        motivo = regla.evaluar(empresa, params)
        if motivo is None:
            cumple = True
        elif motivo.sin_dato:
            cumple = None
        else:
            cumple = False
        salida.append({"clave": clave, "titulo": titulo, "detalle": detalle,
                       "cumple": cumple, "motivo": presentar(motivo, idioma)})
    return salida, "disponible"


def _reglas_no_disponibles(reglas: list) -> list[dict]:
    salida = []
    for item in reglas:
        clave = item.get("clave") if isinstance(item, dict) else None
        valida = isinstance(clave, str)
        salida.append({
            "clave": clave if valida else "desconocida",
            "titulo": clave if valida else translate("liga_rend_regla_historica"),
            "detalle": translate("liga_rend_no_reproducible"), "cumple": None,
            "motivo": translate("liga_rend_version_no_evaluable")})
    return salida


def _rendimiento_por_posicion(tickers: Sequence[str], base: date, limite: date,
                              series: dict, market_sessions: Sequence[date]) -> dict[str, dict]:
    """Same exact base/end for each holding and SPY; no stale endpoint substitution."""
    def cierres_unicos(ticker: str) -> dict[date, object]:
        por_dia: dict[date, list] = {}
        for cierre in series.get(ticker, []):
            por_dia.setdefault(cierre.dia, []).append(cierre)
        return {dia: filas[0] for dia, filas in por_dia.items() if len(filas) == 1}

    nombres = sorted(set(tickers))
    claves = [*nombres, precios.REFERENCIA]
    cierres = {ticker: cierres_unicos(ticker) for ticker in claves}
    fechas_comunes = set(cierres[precios.REFERENCIA])
    for ticker in nombres:
        fechas_comunes &= set(cierres[ticker])
    fin = max((d for d in fechas_comunes if base < d <= limite), default=None)
    if fin is None or base not in fechas_comunes:
        return {ticker: {"estado": "sin_datos", "desde": base.isoformat(), "hasta": None,
                         "rentabilidad_pct": None, "sp500_pct": None, "diferencia_pp": None,
                         "incompleta": True}
                for ticker in nombres}

    sesiones = [d for d in market_sessions if base <= d <= fin]
    incompleta = any(d not in cierres[t] for t in claves for d in sesiones)
    niveles = {
        ticker: precios.indice(
            sorted((c for d, c in cierres[ticker].items() if base <= d <= fin),
                   key=lambda c: c.dia), dividendos=1.0)
        for ticker in claves
    }
    sp = (niveles[precios.REFERENCIA][fin] / niveles[precios.REFERENCIA][base] - 1) * 100
    salida: dict[str, dict] = {}
    for ticker in nombres:
        retorno = (niveles[ticker][fin] / niveles[ticker][base] - 1) * 100
        salida[ticker] = {"estado": "disponible", "desde": base.isoformat(),
                          "hasta": fin.isoformat(), "rentabilidad_pct": retorno,
                          "sp500_pct": sp, "diferencia_pp": retorno - sp,
                          "incompleta": incompleta}
    return salida


def _evidencia_formacion(contexto: dict, series: dict, as_of: date,
                         market_sessions: Sequence[date]) -> dict:
    actual = contexto["actual"]
    receta = contexto["receta"]
    positions = []
    # Positions and weights come from the exact pinned formation; the helper exposes no
    # caller-selected tickers or photos.
    for pos in contexto["posiciones_actuales"]:
        positions.append({"ticker": pos["ticker"], "peso": pos["peso"]})

    version_ok = bool(receta and receta.catalogo_version == CATALOGO_VERSION)
    estado_reglas = "sin_datos" if not contexto["foto_disponible"] else (
        "disponible" if version_ok else "version_no_soportada")
    regla_meta = []
    if receta is not None and version_ok and not validar_reglas(receta.reglas or []):
        for item in receta.reglas or []:
            regla = CATALOGO[item["clave"]]
            regla_meta.append({
                "clave": item["clave"], "titulo": Regla(item["clave"]).redactar(
                    current_locale.get()),
                "detalle": presentar(regla.detalle(item.get("params") or {}),
                                     current_locale.get())})

    limite = actual["dia_fin"] if actual["estado_jornada"] == "cerrada" else min(
        actual["dia_fin"], as_of)
    retornos = _rendimiento_por_posicion(
        [p["ticker"] for p in positions], actual["dia_base"], limite, series, market_sessions)
    empresas = contexto["empresas"] if contexto["foto_disponible"] else {}
    for pos in positions:
        ticker = pos["ticker"]
        reglas, _estado = _resultado_reglas(receta, empresas.get(ticker))
        pos["origen"] = "mantenida" if actual["n_pasan"] is None else "seleccion"
        pos["reglas"] = reglas if contexto["foto_disponible"] else _reglas_no_disponibles(
            receta.reglas or [] if receta is not None else [])
        if not contexto["foto_disponible"]:
            pos["reglas"] = [dict(r, motivo=translate("liga_rend_sin_foto_exacta"))
                             for r in pos["reglas"]]
        pos["rendimiento"] = retornos[ticker]

    salida = {
        "formacion": {
            "inscripcion_id": actual["inscripcion_id"], "jornada_id": actual["jornada_id"],
            "jornada_numero": actual["numero"], "desde": actual["dia_base"].isoformat(),
            "hasta": actual["dia_fin"].isoformat(),
            "metodo": "mantenida" if actual["n_pasan"] is None else "seleccion",
            "receta_id": actual["receta_id"],
            "receta_vigente": actual["receta_vigente_id"] == actual["receta_id"],
            "estado_foto": "disponible" if contexto["foto_disponible"] else "sin_datos",
            "estado_reglas": estado_reglas, "idea": receta.idea if receta else None,
            "pregunta": receta.pregunta if receta else None,
            "reglas": regla_meta, "pesos": _pesos_receta(receta),
            "n_empresas": receta.n_empresas if receta else None,
            "reparto": receta.reparto if receta else None,
            "max_por_sector": receta.max_por_sector if receta else None,
        },
        "posiciones": positions,
    }

    anterior = contexto["anterior"]
    if anterior is None:
        salida["cambios"] = None
        return salida
    current_tickers = set(contexto["tickers_actuales"])
    previous_tickers = set(contexto["tickers_anteriores"])
    entradas, salidas = sorted(current_tickers - previous_tickers), sorted(
        previous_tickers - current_tickers)
    receta_anterior = contexto["receta_anterior"]
    metodologia_cambio = bool(
        receta is not None and receta_anterior is not None
        and receta.id != receta_anterior.id)
    cambios_salida = []
    for ticker in salidas:
        reglas, estado = _resultado_reglas(receta, empresas.get(ticker))
        incumplidas = [r for r in reglas if r["cumple"] is False]
        unknown = estado != "disponible" or any(r["cumple"] is None for r in reglas)
        if metodologia_cambio:
            causa = "metodologia_cambiada"
        elif receta is not None and ticker in (receta.excluidas or []):
            causa = "excluida_manual"
        elif actual["n_pasan"] is None or unknown:
            causa = "no_disponible"
        elif incumplidas:
            causa = "regla_no_cumplida"
        else:
            causa = "sigue_elegible_sin_entrar"
        cambios_salida.append({"ticker": ticker, "causa": causa, "reglas": reglas})
    salida["cambios"] = {
        "desde_inscripcion_id": anterior["inscripcion_id"],
        "metodologia_cambio": metodologia_cambio,
        "entradas": entradas,
        "salidas": cambios_salida,
    }
    return salida


def _pesos_receta(receta) -> dict | None:  # noqa: ANN001
    if receta is None:
        return None
    return {"negocio": receta.peso_negocio, "precio": receta.peso_precio,
            "deuda": receta.peso_deuda, "pronto": receta.peso_pronto,
            "pregunta": receta.peso_pregunta}


def _serie_guardada(by_round: Sequence[tuple[date, date, bool, list[tuple[str, Decimal]]]],
                    series: dict, as_of: date, market_sessions: Sequence[date],
                    numeros: Sequence[int] | None = None) -> dict:
    """Curva pura a partir de posiciones y cierres precargados; no accede a la BD.
    Con `numeros` (uno por jornada), cada punto lleva su jornada; el día base, la que abre."""
    def cierres_unicos(ticker: str) -> dict[date, object]:
        """Drop ambiguous duplicate dates rather than letting input order choose a close."""
        por_dia: dict[date, list] = {}
        for cierre in series.get(ticker, []):
            por_dia.setdefault(cierre.dia, []).append(cierre)
        return {dia: filas[0] for dia, filas in por_dia.items() if len(filas) == 1}

    spy_by_day = cierres_unicos(precios.REFERENCIA)
    if not spy_by_day:
        return _sin_datos()

    # Cada jornada rebalancea al peso registrado. Se mantiene el nivel acumulado desde el
    # primer periodo; cada jornada posterior parte del valor de la anterior en su día base.
    puntos: list[dict] = []
    retornos_validos: list[float] = []
    niveles_estrategia: list[float] = []
    round_factor = 1.0
    official_until: date | None = None
    provisional_until: date | None = None
    sp_levels = precios.indice(sorted(spy_by_day.values(), key=lambda c: c.dia), dividendos=1.0)
    base_global: date | None = None
    calendar_position = {d: i for i, d in enumerate(market_sessions)}
    incomplete = False
    previous_round_end: date | None = None
    previous_round_complete = True

    for orden, (base, fin, oficial, holdings) in enumerate(by_round):
        numero = numeros[orden] if numeros is not None else None
        # Only chain a round at the exact close where the preceding round ended. A missing base
        # or a skipped month has no defensible portfolio level to inherit.
        if puntos and (not previous_round_complete or previous_round_end != base):
            incomplete = True
            break
        if not puntos and base_global is not None:
            incomplete = True
            break
        if base not in sp_levels or base not in spy_by_day:
            incomplete = True
            break
        if not math.isfinite(sp_levels[base]) or sp_levels[base] <= 0:
            incomplete = True
            break
        stock_levels: dict[str, dict[date, float]] = {}
        stock_closes: dict[str, dict[date, object]] = {}
        for ticker, _ in holdings:
            stock_closes[ticker] = cierres_unicos(ticker)
            stock_levels[ticker] = precios.indice(
                sorted((c for d, c in stock_closes[ticker].items() if d >= base),
                       key=lambda c: c.dia), dividendos=1.0)
        if any(base not in levels or not math.isfinite(levels[base])
               or base not in stock_closes[ticker]
               for ticker, levels in stock_levels.items()):
            incomplete = True
            break
        round_complete = (oficial and fin in calendar_position and fin in sp_levels
                          and fin in spy_by_day and all(
                              fin in stock_closes[t] for t, _ in holdings))
        first_round_point = len(puntos)
        if puntos:
            round_factor = puntos[-1]["_estrategia_nivel"]
            puntos[-1]["_jornada"] = numero
        else:
            # La base de la primera jornada fija el 0 % de ambas curvas y permite medir el
            # retorno de la primera sesión como una observación diaria real.
            puntos.append({"_dia": base, "_estrategia_nivel": round_factor,
                           "_sp_nivel": 1.0, "provisional": not round_complete,
                           "salto": False, "_jornada": numero})
            niveles_estrategia.append(round_factor)
            base_global = base
        assert base_global is not None
        stop = fin if oficial else min(fin, as_of)
        sessions = [d for d in market_sessions if base < d <= stop]
        points_before_round = len(puntos)
        previous_available_session = base
        for d in sessions:
            if d not in spy_by_day or d not in sp_levels or any(
                d not in stock_closes[ticker] or d not in levels
                for ticker, levels in stock_levels.items()
            ):
                incomplete = True
                continue
            rel = sum(
                float(weight / Decimal(100)) * (levels[d] - 1.0)
                for (_, weight), levels in zip(holdings, stock_levels.values(), strict=True)
            )
            strategy_level = round_factor * (1 + rel)
            benchmark_level = sp_levels[d] / sp_levels[base_global]
            if not math.isfinite(strategy_level) or not math.isfinite(benchmark_level):
                incomplete = True
                continue
            prior_index = calendar_position.get(previous_available_session)
            current_index = calendar_position.get(d)
            contiguous = (prior_index is not None and current_index == prior_index + 1)
            # Keep valid total-return levels on either side of a missing close, while making the
            # gap visible in the chart and excluding the multi-session move from daily ratios.
            puntos.append({"_dia": d, "_estrategia_nivel": strategy_level,
                           "_sp_nivel": benchmark_level, "provisional": not round_complete,
                           "salto": not contiguous, "_jornada": numero})
            if contiguous:
                daily = strategy_level / puntos[-2]["_estrategia_nivel"] - 1
                retornos_validos.append(daily)
            niveles_estrategia.append(strategy_level)
            previous_available_session = d
        round_complete = round_complete and bool(puntos and puntos[-1]["_dia"] == fin)
        if oficial and round_complete:
            official_until = fin
        elif len(puntos) > points_before_round:
            provisional_until = puntos[-1]["_dia"]
        if oficial and not round_complete:
            for punto in puntos[first_round_point:]:
                punto["provisional"] = True
        previous_round_end = fin
        previous_round_complete = bool(round_complete or not oficial)
        if oficial and not round_complete:
            previous_round_complete = False
            incomplete = True

    if not puntos:
        return _sin_datos()
    # Rebase displayed percentages to the first day with valid portfolio and SPY data.
    first_e, first_sp = puntos[0]["_estrategia_nivel"], puntos[0]["_sp_nivel"]
    chart = [{"dia": p["_dia"].isoformat(),
              "estrategia": (p["_estrategia_nivel"] / first_e - 1) * 100,
              "sp500": (p["_sp_nivel"] / first_sp - 1) * 100,
              "provisional": p["provisional"], "salto": p["salto"],
              **({"jornada": p["_jornada"]} if numeros is not None else {})}
             for p in puntos]
    metrics = metricas_diarias(retornos_validos, niveles_estrategia)
    return {
        "estado": "disponible",
        "metodologia": translate("liga_rend_metodologia"),
        "oficial_hasta": official_until.isoformat() if official_until else None,
        "provisional_hasta": provisional_until.isoformat() if provisional_until else None,
        "incompleta": incomplete,
        "serie": chart,
        "metricas": metrics,
    }


def _sin_datos() -> dict:
    return {"estado": "sin_datos", "metodologia": translate("liga_rend_sin_cierres"),
            "oficial_hasta": None, "provisional_hasta": None, "incompleta": False,
            "serie": [], "metricas": None, "evidencia": None}
