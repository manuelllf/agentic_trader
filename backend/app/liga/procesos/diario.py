"""Cierres diarios de la liga (plan §8): los precios de lo que está en cartera y del S&P, y la
tabla provisional del mes, que se calcula al pedirla y no se guarda (sería una copia).

El horario vive en código (`app.scheduler`, 17:15 de Nueva York los días de bolsa) y se enciende
con el ajuste `procesos.diario.activo` de `liga.ajustes` (apagado si no existe).
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import precios
from app.liga.models import Jornada
from app.liga.motor import calendario
from app.liga.motor.puntos import resultado_jornada
from app.liga.motor.rentabilidad import rentabilidad_cartera, rentabilidad_sp
from app.liga.procesos import datos, omega
from app.liga.procesos.comun import (
    ErrorProceso,
    Fabrica,
    auditar,
    auditar_fallo,
    candado,
    fabrica_sistema,
    hoy_bolsa,
    jornada,
    para_json,
    sesion,
)

logger = logging.getLogger(__name__)

SPY = precios.REFERENCIA
AJUSTE_ACTIVO = "procesos.diario.activo"


# --- Rentabilidades del mes (compartido con el cierre) -------------------------------------------


def ultimo_dia(db: Session, j: Jornada, hasta: date | None = None) -> date | None:
    """El último día con cierre del S&P dentro de la jornada (hasta `hasta`, si se da)."""
    tope = min(hasta, j.dia_fin) if hasta else j.dia_fin
    return db.execute(text(
        "select max(dia) from precio_cierre where ticker = :t and dia between :a and :b"),
        {"t": SPY, "a": j.dia_base, "b": tope}).scalar()


def calcular(db: Session, j: Jornada, dia: date,
             cotizaciones: dict[str, list[precios.Cierre]] | None = None) -> dict:
    """Rentabilidad de cada inscripción y del S&P desde el cierre del día base hasta `dia`, con
    el motor (`rentabilidad`) y su resultado contra el S&P (`puntos`)."""
    filas = db.execute(text("""
        select i.id, i.estrategia_id, i.estado, e.nombre, e.tipo, e.casa_clave
        from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id
        where i.jornada_id = :j order by i.id
    """), {"j": j.id}).all()
    pos = datos.posiciones(db, [f.id for f in filas])
    tickers = {t for ps in pos.values() for t, _ in ps} | {SPY}
    cierres = precios.series(db, sorted(tickers), j.dia_base, dia)
    if cotizaciones:
        cierres = superponer(cierres, cotizaciones, j.dia_base, dia)
    try:
        sp = rentabilidad_sp(cierres.get(SPY, []), j.dia_base, dia)
    except ValueError as e:
        raise ErrorProceso(f"Sin cierre del S&P del día base ({j.dia_base}).") from e
    salida = []
    for f in filas:
        fila = {"inscripcion_id": f.id, "estrategia_id": f.estrategia_id, "nombre": f.nombre,
                "tipo": f.tipo, "casa_clave": f.casa_clave, "estado": f.estado}
        try:
            if f.casa_clave == "omega":
                r, sin_cierre = (omega.rentabilidad(db, j, dia, cotizaciones=cotizaciones)
                                 if cotizaciones else omega.rentabilidad(db, j, dia))
            else:
                r = rentabilidad_cartera(pos[f.id], cierres, j.dia_base, dia) if pos[f.id] \
                    else Decimal("0.0000")
                sin_cierre = sorted(t for t, _ in pos[f.id]
                                    if not any(c.dia == dia for c in cierres.get(t, [])))
        except ValueError as e:
            salida.append({**fila, "rentabilidad": None, "error": str(e)})
            continue
        res = resultado_jornada(r, sp)
        salida.append({**fila, "rentabilidad": r, "dif": res.dif, "letra": res.letra,
                       "puntos": res.puntos, "sin_cierre": sin_cierre})
    salida.sort(key=lambda x: (x["rentabilidad"] is None, -(x["rentabilidad"] or 0)))
    return {"dia": dia, "sp_rentabilidad": sp, "filas": salida}


def tabla_provisional(jornada_id: int, fabrica: Fabrica = fabrica_sistema,
                      hasta: date | None = None) -> dict:
    """La tabla del mes en curso, calculada con los cierres guardados."""
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        if j.estado == "programada":
            raise ErrorProceso("La jornada aún no está formada.")
        dia = ultimo_dia(db, j, hasta)
        if dia is None:
            raise ErrorProceso(f"Sin cierre del S&P del día base ({j.dia_base}).")
        return para_json({"jornada_id": j.id, "estado": j.estado, **calcular(db, j, dia)})


# --- La tabla viva de la jornada en juego (pública) ---------------------------------------------

_VIVO_TTL = 120.0   # segundos: la tabla pública no recalcula en cada visita
_vivo_cache: dict[int, tuple[float, dict | None]] = {}
_vivo_candado = threading.Lock()
_vivo_en_vuelo: set[int] = set()
_vivo_generacion = 0


def superponer(cierres: dict[str, list[precios.Cierre]],
               cotizaciones: dict[str, list[precios.Cierre]], desde: date,
               hasta: date) -> dict[str, list[precios.Cierre]]:
    """Solo en memoria: precios brutos, dividendos y splits sin modificar cierres oficiales."""
    resultado = {}
    for ticker in cierres.keys() | cotizaciones.keys():
        dias = {c.dia: c for c in cierres.get(ticker, []) if desde <= c.dia <= hasta}
        for c in cotizaciones.get(ticker, []):
            if desde <= c.dia <= hasta:
                anterior = dias.get(c.dia)
                dias[c.dia] = precios.Cierre(c.dia, c.cierre,
                    c.dividendo or (anterior.dividendo if anterior else 0),
                    anterior.split if anterior and c.split == 1 else c.split)
        resultado[ticker] = sorted(dias.values(), key=lambda c: c.dia)
    return resultado


def _lanzar_cotizaciones(jornada_id: int, fabrica: Fabrica) -> None:
    if jornada_id in _vivo_en_vuelo:
        return
    _vivo_en_vuelo.add(jornada_id)
    threading.Thread(target=_actualizar_cotizaciones, args=(jornada_id, fabrica, _vivo_generacion),
                     name=f"liga-cotizaciones-{jornada_id}", daemon=True).start()


def _actualizar_cotizaciones(jornada_id: int, fabrica: Fabrica, generacion: int) -> None:
    try:
        ahora = datetime.now(UTC)
        hoy = ahora.astimezone(calendario.TZ_NUEVA_YORK).date()
        with sesion(fabrica) as db:
            j = jornada(db, jornada_id)
            if j.estado != "formada":
                return
            tickers = set(db.execute(text("""
                select p.ticker from liga.posiciones p
                join liga.inscripciones i on i.id = p.inscripcion_id where i.jornada_id = :j
            """), {"j": jornada_id}).scalars()) | {SPY}
            tickers.update(o.ticker for o in omega.operaciones(db, j)
                           if o.entrada_dia <= hoy and (o.salida_dia is None or o.salida_dia > hoy))
            dia_fin = j.dia_fin
        # Yahoo entrega la barra diaria en curso; descargar conserva dividendos y splits.
        cotizaciones = precios.descargar(sorted(tickers), hoy - timedelta(days=7))
        dias_sp = [c.dia for c in cotizaciones.get(SPY, []) if c.dia <= min(hoy, dia_fin)]
        if not dias_sp:
            return
        dia = max(dias_sp)
        with sesion(fabrica) as db:
            j = jornada(db, jornada_id)
            if j.estado != "formada" or dia < j.dia_base:
                return
            r = calcular(db, j, dia, cotizaciones=cotizaciones)
        pendientes = sum(not any(c.dia == dia for c in cotizaciones.get(t, [])) for t in tickers)
        valor = {"dia": dia, "sp": r["sp_rentabilidad"], "actualizado": datetime.now(UTC),
                 "en_vivo": dia == hoy, "precios_pendientes": pendientes,
                 "por_inscripcion": {f["inscripcion_id"]: f for f in r["filas"]}}
        with _vivo_candado:
            if jornada_id in _vivo_cache and generacion == _vivo_generacion:
                _vivo_cache[jornada_id] = (_vivo_cache[jornada_id][0], valor)
    except Exception:
        logger.exception("No se pudieron actualizar las cotizaciones de la jornada %s", jornada_id)
    finally:
        with _vivo_candado:
            _vivo_en_vuelo.discard(jornada_id)


def vivo(jornada_id: int, fabrica: Fabrica = fabrica_sistema,
         reloj=time.monotonic) -> dict | None:  # noqa: ANN001 — reloj inyectable en pruebas
    """Rentabilidad y puntos de cada inscripción de una jornada formada con el último cierre
    guardado, para la clasificación pública del mes. `None` si la jornada no está en juego o no
    se pudo calcular (la web enseña entonces «sin resultados» en vez de fallar). Solo devuelve
    números por inscripción: las carteras no salen de aquí. Se guarda unos minutos en memoria."""
    with _vivo_candado:
        hit = _vivo_cache.get(jornada_id)
        if hit is not None and reloj() - hit[0] < _VIVO_TTL:
            return hit[1]
        if hit is not None and jornada_id in _vivo_en_vuelo:
            return hit[1]
        if hit is not None and hit[1] is not None:
            _vivo_cache[jornada_id] = (reloj(), hit[1])
            _lanzar_cotizaciones(jornada_id, fabrica)
            return hit[1]
        try:
            with sesion(fabrica) as db:
                j = jornada(db, jornada_id)
                dia = ultimo_dia(db, j) if j.estado == "formada" else None
                valor = None
                if dia is not None:
                    r = calcular(db, j, dia)
                    valor = {"dia": dia, "sp": r["sp_rentabilidad"],
                             "por_inscripcion": {f["inscripcion_id"]: f for f in r["filas"]}}
        except Exception:
            logger.exception("No se pudo calcular la tabla viva de la jornada %s", jornada_id)
            valor = None
        _vivo_cache[jornada_id] = (reloj(), valor)
        if valor is not None:
            _lanzar_cotizaciones(jornada_id, fabrica)
        return valor


def olvidar_vivo() -> None:
    """Vacía la caché (al cerrar la jornada o en pruebas)."""
    global _vivo_generacion
    with _vivo_candado:
        _vivo_generacion += 1
        _vivo_cache.clear()


# --- El proceso ----------------------------------------------------------------------------------


def _formadas(db: Session) -> list[Jornada]:
    return list(db.scalars(select(Jornada).where(Jornada.estado == "formada")
                           .order_by(Jornada.dia_base, Jornada.id)))


def _inicios(db: Session) -> dict[str, date]:
    """Cada ticker en cartera de una jornada formada, desde su día base; el S&P; y lo que Omega
    puede comprar o ya tiene abierto."""
    inicio = dict(db.execute(text("""
        select p.ticker, min(j.dia_base) from liga.posiciones p
        join liga.inscripciones i on i.id = p.inscripcion_id
        join liga.jornadas j on j.id = i.jornada_id
        where j.estado = 'formada' group by p.ticker
    """)).all())
    base = db.execute(text("select min(dia_base) from liga.jornadas where estado = 'formada'")
                      ).scalar()
    if base is not None:
        inicio[SPY] = min(inicio.get(SPY, base), base)
    for t, desde in omega.inicios(db, _formadas(db)).items():
        inicio[t] = min(inicio.get(t, desde), desde)
    return inicio


def activo(db: Session) -> bool:
    valor = db.execute(text("select valor from liga.ajustes where clave = :c"),
                       {"c": AJUSTE_ACTIVO}).scalar()
    return valor is True


def estado(fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        jornadas = db.execute(text(
            "select id, dia_base, dia_fin from liga.jornadas where estado = 'formada' order by id"
        )).all()
        ultimos = {j.id: db.execute(text(
            "select max(dia) from precio_cierre where ticker = :t and dia between :a and :b"),
            {"t": SPY, "a": j.dia_base, "b": j.dia_fin}).scalar() for j in jornadas}
        return para_json({"activo": activo(db), "jornadas_formadas": [
            {"jornada_id": j.id, "ultimo_cierre": ultimos[j.id]} for j in jornadas]})


def vista_previa(fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        inicio = _inicios(db)
        return para_json({"activo": activo(db), "tickers": sorted(inicio),
                          "n_tickers": len(inicio)})


def ejecutar(fabrica: Fabrica = fabrica_sistema, actor: str | None = None) -> dict:
    try:
        with candado("diario", fabrica), sesion(fabrica) as db:
            inicio = _inicios(db)
            filas = precios.al_dia(db, inicio) if inicio else 0
            huecos = [omega.sincronizar(db, j, ultimo, actor) for j in _formadas(db)
                      if (ultimo := ultimo_dia(db, j)) is not None]
            auditar(db, "proceso.diario", None, {"tickers": len(inicio), "filas": filas}, actor)
            db.commit()
            return {"tickers": len(inicio), "filas": filas, "omega": huecos}
    except Exception as e:
        auditar_fallo(fabrica, "diario", None, e, actor)
        raise


def interruptor(encender: bool, fabrica: Fabrica = fabrica_sistema,
                actor: str | None = None) -> dict:
    from app.liga.procesos.comun import como_uuid

    with sesion(fabrica) as db:
        db.execute(text("""
            insert into liga.ajustes (clave, valor, actualizado_por)
            values (:c, cast(:v as jsonb), :a)
            on conflict (clave) do update
              set valor = excluded.valor, actualizado = now(),
                  actualizado_por = excluded.actualizado_por
        """), {"c": AJUSTE_ACTIVO, "v": "true" if encender else "false", "a": como_uuid(actor)})
        auditar(db, "proceso.diario.interruptor", None, {"activo": encender}, actor)
        db.commit()
        return {"activo": encender}


def job(fabrica: Fabrica = fabrica_sistema, ahora: datetime | None = None) -> dict | None:
    """El del scheduler: solo en día de bolsa y con el interruptor encendido. Un fallo se
    registra y avisa por push; nunca tira el scheduler."""
    if not calendario.es_dia_de_bolsa(hoy_bolsa(ahora)):
        return None
    try:
        with sesion(fabrica) as db:
            if not activo(db):
                return None
        return ejecutar(fabrica)
    except Exception as e:
        logger.exception("Fallo en los cierres diarios de la liga")
        try:
            from app import push

            with sesion(fabrica) as db:
                push.send_to_all(db, title="Vennett: fallaron los cierres diarios",
                                 body=str(e)[:140], url="/admin", tag="agentic-liga")
        except Exception:
            logger.exception("Tampoco se pudo avisar por push")
        return None
