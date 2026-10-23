"""Foto de alertas y huecos de Omega en la liga, separada de la sala personal."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import precios
from app.liga.models import Jornada, Temporada
from app.liga.motor import omega_huecos as motor
from app.liga.motor.omega_huecos import Alerta, Operacion
from app.liga.procesos.comun import TZ_BOLSA, auditar

logger = logging.getLogger(__name__)

Capitalizacion = Callable[[str], Decimal | None]


def capitalizacion_yfinance(ticker: str) -> Decimal | None:
    """Capitalización de Yahoo Finance en el momento de la captura."""
    try:
        import yfinance as yf

        valor = yf.Ticker(ticker).info.get("marketCap")
        return Decimal(str(valor)) if valor else None
    except Exception:
        logger.warning("Sin capitalización de %s", ticker, exc_info=True)
        return None


# --- Lectura -------------------------------------------------------------------------------------


def capturar_alertas(db: Session, capitalizacion: Capitalizacion | None = None) -> int:
    """Copia a la foto, por lotes y sin commit, las señales que aún no estén."""
    pedir = capitalizacion or capitalizacion_yfinance
    ultimo = -1
    total = 0
    while True:
        filas = db.execute(text("""
            select s.id, s.ticker, s.created_at, s.entry_date, s.estado
            from momentum_senales s
            where s.id > :ultimo
              and not exists (select 1 from liga.omega_alertas a where a.senal_id = s.id)
              and not (coalesce(s.resuelta, false) and s.exit_date is not null
                and s.exit_date < (coalesce(s.created_at,
                  (s.entry_date + time '16:00') at time zone 'America/New_York')
                  at time zone 'America/New_York')::date)
            order by s.id limit 200
        """), {"ultimo": ultimo}).all()
        if not filas:
            break
        lote = []
        for f in filas:
            try:
                cap = pedir(f.ticker)
            except Exception:
                logger.warning("Sin capitalización de %s", f.ticker, exc_info=True)
                cap = None
            if cap is None:
                logger.warning("Capitalización nula de %s", f.ticker)
            nace = (f.created_at if f.created_at is not None else
                    datetime.combine(f.entry_date, time(16), tzinfo=TZ_BOLSA))
            lote.append({"s": f.id, "t": f.ticker, "n": nace, "e": f.estado, "c": cap})
        db.execute(text("""
            insert into liga.omega_alertas
                (senal_id, ticker, nace_en, estado_origen, market_cap_usd)
            values (:s, :t, :n, :e, :c) on conflict (senal_id) do nothing
        """), lote)
        total += len(lote)
        ultimo = filas[-1].id
    return total


def alertas(db: Session, desde: date, hasta: date) -> list[Alerta]:
    """Lee solo la foto de Omega, nunca la sala personal."""
    filas = db.execute(text("""
        select senal_id, ticker, nace_en, market_cap_usd from liga.omega_alertas
        where nace_en >= :d and nace_en < :h
    """), {"d": datetime.combine(desde, time(0), tzinfo=TZ_BOLSA),
           "h": datetime.combine(hasta + timedelta(days=1), time(0), tzinfo=TZ_BOLSA)}).all()
    return [Alerta(f.ticker, f.nace_en.astimezone(TZ_BOLSA), Decimal(0),
                   f.market_cap_usd, f.senal_id) for f in filas]


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


def rentabilidad(db: Session, j: Jornada, dia: date,
                 cotizaciones: dict[str, list[precios.Cierre]] | None = None,
                 ) -> tuple[Decimal, list[str]]:
    """Rentabilidad del mes de Omega hasta `dia` y qué abiertas no tienen cierre ese día."""
    ops = operaciones(db, j)
    if not ops:
        return Decimal("0.0000"), []
    tickers = sorted({o.ticker for o in ops})
    desde = min(min(o.entrada_dia for o in ops), j.dia_base)
    cierres = precios.series(db, tickers, desde, dia)
    if cotizaciones:
        from app.liga.procesos.diario import superponer

        cierres = superponer(cierres, cotizaciones, desde, dia)
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
        for a in alertas(db, j.dia_base - timedelta(days=motor.ALERTA_MAX_DIAS), j.dia_fin):
            out[a.ticker] = min(out.get(a.ticker, a.momento.date()), a.momento.date())
    return out


# --- Escritura -----------------------------------------------------------------------------------


def sincronizar(db: Session, j: Jornada, hasta: date, actor: str | None = None,
                capitalizacion: Capitalizacion | None = None) -> dict:
    """Asigna las alertas a los huecos libres y cierra lo que toque salir, día a día hasta
    `hasta` (con los cierres ya guardados). No hace commit."""
    capturar_alertas(db, capitalizacion)
    db.execute(text("select id from liga.jornadas where id = :j for update"), {"j": j.id})
    comienzo = j.dia_base + timedelta(days=1)
    hoy = min(hasta, j.dia_fin)
    if hoy < comienzo:
        return {"jornada_id": j.id, "nuevas": 0, "cerradas": 0}
    arrastre = {f.senal_id: f for f in _arrastre(db, j)}
    propias = {f.senal_id: f for f in _propias(db, j.id)}
    ya_propios = {f.ticker for f in propias.values()}
    llegadas = alertas(db, comienzo - timedelta(days=motor.ALERTA_MAX_DIAS), hoy)
    # Las entradas ya guardadas no se recalculan.
    abiertas = [_operacion(f) for f in arrastre.values()]
    abiertas += [_operacion(f) for f in propias.values()]
    tickers = sorted({o.ticker for o in abiertas} | {a.ticker for a in llegadas})
    desde = min([comienzo] + [o.entrada_dia for o in abiertas])
    cierres = precios.series(db, tickers, desde, hoy)
    nuevas = cerradas = discrepancias = 0
    ocupados = {f.numero for f in [*arrastre.values(), *propias.values()]
                if f.salida_dia is None}
    for op in motor.simular(abiertas, llegadas, cierres, comienzo, hoy):
        previa = arrastre.get(op.senal_id) or propias.get(op.senal_id)
        if previa is not None and (previa.entrada_dia != op.entrada_dia
                                   or float(previa.entrada_precio) != op.entrada_precio):
            discrepancias += 1
            logger.error("Entrada discrepante en la señal %s", op.senal_id)
        if previa is None:
            if op.ticker in ya_propios or (op.abierta and op.numero in ocupados):
                discrepancias += 1
                logger.error("Conflicto de hueco en la señal %s", op.senal_id)
                continue
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
            if op.abierta:
                ocupados.add(op.numero)
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
            ocupados.discard(previa.numero)
    if nuevas or cerradas or discrepancias:
        auditar(db, "proceso.diario.omega", f"jornada:{j.id}",
                {"nuevas": nuevas, "cerradas": cerradas, "discrepancias": discrepancias,
                 "hasta": hoy}, actor)
    return {"jornada_id": j.id, "nuevas": nuevas, "cerradas": cerradas,
            "discrepancias": discrepancias}


def retorno_desde_entrada(entrada: float | None, precio: float | None) -> float | None:
    """Rentabilidad en % desde el precio de entrada del hueco; `None` si falta alguno de los dos."""
    if not entrada or precio is None:
        return None
    return round((precio / entrada - 1) * 100, 2)


def datos_ficha(estrategia_id: str, solo_cerradas: bool) -> tuple[list[dict], dict]:
    """Huecos de la jornada en curso, abiertos o cerrados hasta `hasta`, y serie diaria."""
    from sqlalchemy import select

    from app.liga import rendimiento
    from app.liga.motor.calendario import dias_de_bolsa
    from app.liga.procesos.comun import fabrica_sistema, hoy_bolsa, sesion

    with sesion(fabrica_sistema) as db:
        filas = db.execute(select(Jornada, Temporada.n_jornadas).join(
            Temporada, Temporada.id == Jornada.temporada_id).where(
            Jornada.id.in_(text("select jornada_id from liga.inscripciones "
                               "where estrategia_id = :e")),
            Jornada.estado.in_(["cerrada"] if solo_cerradas else ["formada", "cerrada"]),
        ).order_by(Jornada.dia_base, Jornada.id), {"e": estrategia_id}).all()
        jornadas = [j for j, _ in filas]
        if not jornadas:
            return [], rendimiento._sin_datos()
        hoy = hoy_bolsa()
        ultima = jornadas[-1]
        hasta = ultima.dia_fin if ultima.estado == "cerrada" else min(hoy, ultima.dia_fin)
        por_numero = {}
        for op in operaciones(db, ultima):
            if op.entrada_dia <= hasta and (
                op.numero not in por_numero
                or op.entrada_dia > por_numero[op.numero].entrada_dia
            ):
                por_numero[op.numero] = op
        cartera = []
        for numero in sorted(por_numero):
            op = por_numero[numero]
            cerrada = op.salida_dia is not None and op.salida_dia <= hasta
            cartera.append({
                "numero": op.numero, "ticker": op.ticker,
                "entrada_dia": op.entrada_dia, "entrada_precio": op.entrada_precio,
                "salida_dia": op.salida_dia if cerrada else None,
                "salida_precio": op.salida_precio if cerrada else None,
                "peso": 100 / motor.N_HUECOS,
            })
        series = precios.series(db, [precios.REFERENCIA], jornadas[0].dia_base, hasta)
        rondas = []
        for j in jornadas:
            ticker = f"OMEGA_{j.id}"
            dias = dias_de_bolsa(j.dia_base, min(j.dia_fin, hasta))
            series[ticker] = []
            for dia in dias:
                r, sin = rentabilidad(db, j, dia)
                if not sin:
                    series[ticker].append(precios.Cierre(dia, 1 + float(r) / 100))
            rondas.append((j.dia_base, j.dia_fin, j.estado == "cerrada",
                           [(ticker, Decimal(100))]))
        salida = rendimiento._serie_guardada(
            rondas, series, hoy, dias_de_bolsa(jornadas[0].dia_base, hasta),
            numeros=[j.numero for j in jornadas], totales=[total for _, total in filas])
        salida["evidencia"] = None
        return cartera, salida
