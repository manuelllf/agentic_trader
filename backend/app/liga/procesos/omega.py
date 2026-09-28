"""Omega de la casa en la liga: los 4 huecos virtuales, con la base de datos por encima del motor
puro (`motor.omega_huecos`). Las alertas se leen de `momentum_senales` (solo lectura) y cada
operación de un hueco vive en `liga.omega_operaciones`.

Repetir el proceso el mismo día no duplica nada: se recalcula el mes entero con el motor (que es
determinista) y solo se añade lo que falte o se cierra lo que toque; lo ya escrito no se toca.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import replace
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import precios
from app.liga.models import Jornada
from app.liga.motor import omega_huecos as motor
from app.liga.motor.omega_huecos import Alerta, Operacion
from app.liga.procesos.comun import TZ_BOLSA, auditar

logger = logging.getLogger(__name__)

Capitalizacion = Callable[[str], Decimal | None]


def capitalizacion_yfinance(ticker: str) -> Decimal | None:
    """Solo se pide para desempatar dos alertas idénticas en instante y caída; sin dato, pierde."""
    try:
        import yfinance as yf

        valor = yf.Ticker(ticker).info.get("marketCap")
        return Decimal(str(valor)) if valor else None
    except Exception:
        logger.warning("Sin capitalización de %s para el desempate", ticker, exc_info=True)
        return None


# --- Lectura -------------------------------------------------------------------------------------


def alertas(db: Session, desde: date, hasta: date,
            capitalizacion: Capitalizacion | None = None) -> list[Alerta]:
    """Filas de `momentum_senales` llegadas entre esos días de bolsa (hora de Nueva York). Llegada:
    `created_at`; sin él, el cierre de `entry_date`. Las descartadas no cuentan, ni las señales
    históricas que el escáner inserta ya resueltas al incorporar un ticker (salieron antes de
    "llegar"): no son alertas de hoy."""
    filas = db.execute(text("""
        select id, ticker, created_at, entry_date, caida_pct from momentum_senales
        where estado <> 'descartada'
          and not (resuelta and exit_date is not null and exit_date <
                   (coalesce(created_at, entry_date::timestamptz)
                    at time zone 'America/New_York')::date)
          and coalesce(created_at, entry_date::timestamptz) >= :d
          and coalesce(created_at, entry_date::timestamptz) < :h
    """), {"d": datetime.combine(desde - timedelta(days=1), time(0), tzinfo=TZ_BOLSA),
           "h": datetime.combine(hasta + timedelta(days=2), time(0), tzinfo=TZ_BOLSA)}).all()
    out = []
    for f in filas:
        momento = (f.created_at.astimezone(TZ_BOLSA) if f.created_at is not None
                   else datetime.combine(f.entry_date, time(16), tzinfo=TZ_BOLSA))
        if desde <= momento.date() <= hasta:
            out.append(Alerta(f.ticker, momento, Decimal(f.caida_pct or 0), None, f.id))
    return _con_capitalizacion(out, capitalizacion or capitalizacion_yfinance)


def _con_capitalizacion(lista: list[Alerta], pedir: Capitalizacion) -> list[Alerta]:
    """La capitalización solo para las alertas empatadas en instante y caída."""
    grupos: dict[tuple, list[Alerta]] = {}
    for a in lista:
        grupos.setdefault((a.momento, a.caida_pct), []).append(a)
    empatadas = {id(a) for g in grupos.values() if len(g) > 1 for a in g}
    return [replace(a, market_cap=pedir(a.ticker)) if id(a) in empatadas else a for a in lista]


def _operacion(f) -> Operacion:
    return Operacion(f.numero, f.ticker, f.entrada_dia, float(f.entrada_precio), f.salida_dia,
                     None if f.salida_precio is None else float(f.salida_precio), f.motivo,
                     f.senal_id)


_COLUMNAS = ("id, numero, ticker, entrada_dia, entrada_precio, salida_dia, salida_precio, motivo, "
             "senal_id")
_COLUMNAS_O = ", ".join(f"o.{c.strip()}" for c in _COLUMNAS.split(","))


def _arrastre(db: Session, j: Jornada) -> list:
    """Filas de jornadas anteriores de la temporada que seguían abiertas en el día base."""
    return db.execute(text(f"""
        select {_COLUMNAS_O}
        from liga.omega_operaciones o join liga.jornadas p on p.id = o.jornada_id
        where p.temporada_id = :t and p.dia_base < :b and o.entrada_dia <= :b
          and (o.salida_dia is null or o.salida_dia > :b)
        order by o.numero
    """), {"t": j.temporada_id, "b": j.dia_base}).all()


def _propias(db: Session, jornada_id: int) -> list:
    return db.execute(text(
        f"select {_COLUMNAS} from liga.omega_operaciones where jornada_id = :j "
        "order by numero, entrada_dia"), {"j": jornada_id}).all()


def operaciones(db: Session, j: Jornada) -> list[Operacion]:
    """Lo que cuenta en el mes: lo que arrastran los huecos y lo escrito en la propia jornada."""
    return [_operacion(f) for f in _arrastre(db, j) + _propias(db, j.id)]


def rentabilidad(db: Session, j: Jornada, dia: date) -> tuple[Decimal, list[str]]:
    """Rentabilidad del mes de Omega hasta `dia` y qué abiertas no tienen cierre ese día."""
    ops = operaciones(db, j)
    if not ops:
        return Decimal("0.0000"), []
    tickers = sorted({o.ticker for o in ops})
    desde = min(min(o.entrada_dia for o in ops), j.dia_base)
    cierres = precios.series(db, tickers, desde, dia)
    r = motor.rentabilidad_mes(ops, cierres, j.dia_base, dia)
    sin = sorted({o.ticker for o in ops if o.entrada_dia <= dia
                  and (o.salida_dia is None or o.salida_dia > dia)
                  and not any(c.dia == dia for c in cierres.get(o.ticker, []))})
    return r, sin


def inicios(db: Session, jornadas: list[Jornada]) -> dict[str, date]:
    """Desde qué día hacen falta cierres de lo que Omega puede comprar o ya tiene abierto."""
    out: dict[str, date] = {}
    for j in jornadas:
        for f in _arrastre(db, j) + _propias(db, j.id):
            out[f.ticker] = min(out.get(f.ticker, f.entrada_dia), f.entrada_dia)
        for a in alertas(db, j.dia_base + timedelta(days=1), j.dia_fin,
                         capitalizacion=lambda _t: None):
            out[a.ticker] = min(out.get(a.ticker, a.momento.date()), a.momento.date())
    return out


# --- Escritura -----------------------------------------------------------------------------------


def sincronizar(db: Session, j: Jornada, hasta: date, actor: str | None = None,
                capitalizacion: Capitalizacion | None = None) -> dict:
    """Asigna las alertas a los huecos libres y cierra lo que toque salir, día a día hasta
    `hasta` (con los cierres ya guardados). No hace commit."""
    comienzo = j.dia_base + timedelta(days=1)
    hoy = min(hasta, j.dia_fin)
    if hoy < comienzo:
        return {"jornada_id": j.id, "nuevas": 0, "cerradas": 0}
    arrastre = {(f.numero, f.entrada_dia): f for f in _arrastre(db, j)}
    propias = {(f.numero, f.entrada_dia): f for f in _propias(db, j.id)}
    ya_propios = {f.ticker for f in propias.values()}
    llegadas = alertas(db, comienzo, hoy, capitalizacion)
    # Las de arrastre se recalculan como abiertas: su salida, si la hubo, la decide el motor.
    abiertas = [replace(_operacion(f), salida_dia=None, salida_precio=None, motivo=None)
                for f in arrastre.values()]
    tickers = sorted({o.ticker for o in abiertas} | {a.ticker for a in llegadas})
    desde = min([comienzo] + [o.entrada_dia for o in abiertas])
    cierres = precios.series(db, tickers, desde, hoy)
    nuevas = cerradas = 0
    for op in motor.simular(abiertas, llegadas, cierres, comienzo, hoy):
        clave = (op.numero, op.entrada_dia)
        previa = arrastre.get(clave) if op.entrada_dia <= j.dia_base else propias.get(clave)
        if previa is None:
            if op.ticker in ya_propios:
                continue  # el precio de otro día llegó tarde: no se duplica el ticker
            db.execute(text("""
                insert into liga.omega_operaciones
                  (jornada_id, numero, senal_id, ticker, entrada_dia, entrada_precio,
                   salida_dia, salida_precio, motivo)
                values (:j, :n, :s, :t, :ed, :ep, :sd, :sp, :m)
                on conflict (jornada_id, numero, entrada_dia) do nothing
            """), {"j": j.id, "n": op.numero, "s": op.senal_id, "t": op.ticker,
                   "ed": op.entrada_dia, "ep": round(op.entrada_precio, 4), "sd": op.salida_dia,
                   "sp": None if op.salida_precio is None else round(op.salida_precio, 4),
                   "m": op.motivo})
            ya_propios.add(op.ticker)
            nuevas += 1
            cerradas += op.salida_dia is not None
        elif previa.salida_dia is None and op.salida_dia is not None:
            db.execute(text("""
                update liga.omega_operaciones
                set salida_dia = :sd, salida_precio = :sp, motivo = :m
                where id = :i and salida_dia is null
            """), {"sd": op.salida_dia, "sp": round(op.salida_precio, 4), "m": op.motivo,
                   "i": previa.id})
            cerradas += 1
    if nuevas or cerradas:
        auditar(db, "proceso.diario.omega", f"jornada:{j.id}",
                {"nuevas": nuevas, "cerradas": cerradas, "hasta": hoy}, actor)
    return {"jornada_id": j.id, "nuevas": nuevas, "cerradas": cerradas}
