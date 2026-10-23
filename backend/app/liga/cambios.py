"""La ventana de cambios. Del corte a las 09:00 de Nueva York del primer día de la semana,
la cartera ya está formada y «Cambiar» la rehace con la misma foto, las mismas notas y las
respuestas guardadas, al precio del día base: no usa IA. El resto de la semana, «Cambiar» prepara
la receta del siguiente corte; si ya hay escaneo nuevo del mes, se ve la cartera de la semana
que viene.

Va con una sesión de sistema (las inscripciones y sus posiciones no se escriben como usuario), así
que la propiedad de la estrategia se comprueba aquí, no con RLS."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import precios
from app.i18n import translate
from app.liga import estrategias
from app.liga.models import Jornada, Posicion, Receta
from app.liga.procesos import datos, formar
from app.liga.procesos.comun import Fabrica, auditar, fabrica_sistema, sesion

FASE_FORMANDO = "formando"
FASE_CAMBIOS = "cambios"
FASE_SIGUIENTE = "siguiente"
_VUELTAS_PRECIOS = 4

_VENTANA = text("""
    select j.id as jornada_id, j.estado, j.dia_inicio,
           ((j.dia_inicio + time '09:00') at time zone 'America/New_York') as cierra,
           i.id as inscripcion_id, i.receta_id as receta_inscripcion,
           e.estado as estado_estrategia
    from liga.jornadas j
    join liga.estrategias e on e.id = cast(:e as uuid)
    left join liga.inscripciones i on i.jornada_id = j.id and i.estrategia_id = e.id
    where j.estado in ('programada', 'formada')
      and j.cierre_inscripcion <= :ahora
      and :ahora < ((j.dia_inicio + time '09:00') at time zone 'America/New_York')
    order by j.dia_inicio
    limit 1
""")


_SIGUIENTE = text("""
    select j.id as jornada_id, j.cierre_inscripcion as cierra,
           actual.id as inscripcion_id, actual.receta_id as receta_inscripcion
    from liga.jornadas j
    join liga.estrategias e on e.id = cast(:e as uuid)
    left join lateral (
        select i.id, i.receta_id from liga.inscripciones i
        join liga.jornadas formada on formada.id = i.jornada_id
        where i.estrategia_id = e.id and formada.estado = 'formada'
        order by formada.dia_base desc limit 1
    ) actual on true
    where j.estado = 'programada' and e.estado in ('apuntada', 'jugando')
      and j.cierre_inscripcion > :ahora
    order by j.dia_base limit 1
""")


@dataclass(frozen=True)
class Ventana:
    fase: str
    jornada_id: int
    cierra: datetime
    inscripcion_id: int | None = None
    receta_inscripcion: int | None = None
    estrategia_id: uuid.UUID | str | None = None


def ventana_de(db: Session, estrategia_id: uuid.UUID | str,
               ahora: datetime | None = None) -> Ventana | None:
    """Formando bloquea; cambios rehace la cartera hasta la apertura;
    siguiente prepara la receta del próximo corte."""
    ahora = ahora or datetime.now(UTC)
    parametros = {"e": estrategia_id, "ahora": ahora}
    fila = db.execute(_VENTANA, parametros).one_or_none()
    if fila is not None:
        base = {"jornada_id": fila.jornada_id, "cierra": fila.cierra,
                "estrategia_id": estrategia_id}
        if fila.estado == "formada" and fila.inscripcion_id is not None:
            return Ventana(FASE_CAMBIOS, inscripcion_id=fila.inscripcion_id,
                           receta_inscripcion=fila.receta_inscripcion, **base)
        if fila.estado == "programada" and fila.estado_estrategia in ("apuntada", "jugando"):
            return Ventana(FASE_FORMANDO, **base)
    fila = db.execute(_SIGUIENTE, parametros).one_or_none()
    if fila is None:
        return None
    return Ventana(FASE_SIGUIENTE, fila.jornada_id, fila.cierra, fila.inscripcion_id,
                   fila.receta_inscripcion, estrategia_id)


def exigir_fuera_de_la_ventana(db: Session, estrategia_id: uuid.UUID | str,
                               ahora: datetime | None = None) -> None:
    """Mientras se forma y hasta que abre la semana, la estrategia solo admite
    Cambiar y Recuperar."""
    v = ventana_de(db, estrategia_id, ahora)
    if v is not None and v.fase in (FASE_FORMANDO, FASE_CAMBIOS):
        raise HTTPException(409, translate("liga_changes_locked"))


# --- Cambiar y Recuperar ------------------------------------------------------------------------


def _la_suya(db: Session, usuario_id: str, estrategia_id: uuid.UUID) -> SimpleNamespace:
    fila = db.execute(text("""
        select id, nombre, dueno_id::text as dueno, tipo, cada_dia_1, receta_id
        from liga.estrategias where id = :e for update
    """), {"e": estrategia_id}).one_or_none()
    if fila is None or fila.dueno != usuario_id or fila.tipo != "usuario":
        raise HTTPException(404, "No existe esa estrategia.")
    return SimpleNamespace(**fila._mapping)


def _sin_precio_de_la_formacion(db: Session, jornada_id: int) -> set[str]:
    """Los valores a los que la formación no pudo poner precio de compra."""
    lista = db.execute(text("""
        select detalle -> 'sin_precio' from liga.auditoria
        where accion = 'proceso.formar' and objeto = :o order by id desc limit 1
    """), {"o": f"jornada:{jornada_id}"}).scalar()
    return set(lista or [])


def _cartera(db: Session, ctx: formar.Contexto, fila: SimpleNamespace, sin_precio: set[str],
             sin_pregunta: str | None) -> formar.Entrada:
    """La cartera con esta receta sobre la foto de la jornada. Un valor nuevo sin precio de compra
    se descarta y entra el siguiente, como en la formación."""
    excluir = set(sin_precio)
    for _ in range(_VUELTAS_PRECIOS):
        empresas = [e for e in ctx.empresas if e.ticker not in excluir]
        entrada, _omitida, _aviso = formar.entrada_de(
            db, ctx, empresas, excluir, fila, forzar_sin_pregunta=sin_pregunta,
            vaciar_si_cambio=False)
        if entrada is None:
            raise HTTPException(422, translate("liga_changes_invalid_recipe"))
        tickers = {t for t, _ in entrada.posiciones}
        faltan = tickers - datos.con_cierre(db, tickers, ctx.dia_base) - excluir
        if not faltan:
            return entrada
        precios.al_dia(db, dict.fromkeys(sorted(faltan), ctx.dia_base))
        nuevos = tickers - datos.con_cierre(db, tickers, ctx.dia_base) - excluir
        if not nuevos:
            return entrada
        excluir |= nuevos
    raise HTTPException(503, translate("liga_changes_prices"))


def _fijar_cartera(db: Session, v: Ventana, fila: SimpleNamespace, receta_id: int) -> None:
    """Deja la inscripción con esa receta y la cartera que sale de ella."""
    ctx = formar.contexto(db, db.get(Jornada, v.jornada_id))
    sin_pregunta = db.execute(text("""
        select motivo from liga.formaciones_degradadas
        where inscripcion_id = :i and motivo <> 'quitadas_vaciadas'
    """), {"i": v.inscripcion_id}).scalar()
    fila.receta_id = receta_id
    entrada = _cartera(db, ctx, fila, _sin_precio_de_la_formacion(db, v.jornada_id), sin_pregunta)
    db.execute(text("delete from liga.posiciones where inscripcion_id = :i"),
               {"i": v.inscripcion_id})
    db.add_all(Posicion(inscripcion_id=v.inscripcion_id, ticker=t, peso=p)
               for t, p in entrada.posiciones)
    db.execute(text("""
        update liga.inscripciones set receta_id = :r, n_pasan = :n, estado = :s where id = :i
    """), {"r": receta_id, "n": entrada.n_pasan, "s": entrada.estado, "i": v.inscripcion_id})
    db.execute(text("update liga.estrategias set receta_id = :r where id = :e"),
               {"r": receta_id, "e": fila.id})


def _ventana_de_cambios(db: Session, estrategia_id: uuid.UUID, ahora: datetime | None) -> Ventana:
    v = ventana_de(db, estrategia_id, ahora)
    if v is None:
        raise HTTPException(409, translate("liga_changes_closed"))
    if v.fase == FASE_FORMANDO:
        raise HTTPException(409, translate("liga_changes_forming"))
    return v


def aplicar(usuario_id: str, estrategia_id: uuid.UUID, ticker: str, quitar: bool,
            fabrica: Fabrica = fabrica_sistema, ahora: datetime | None = None) -> dict:
    """Quita o recupera una empresa: rehace la cartera hasta la apertura;
    entre semana prepara la receta del siguiente corte. Devuelve la receta nueva."""
    with sesion(fabrica) as db:
        fila = _la_suya(db, usuario_id, estrategia_id)
        v = _ventana_de_cambios(db, estrategia_id, ahora)
        if v.fase == FASE_CAMBIOS and fila.receta_id != v.receta_inscripcion:
            raise HTTPException(409, translate("liga_changes_locked"))
        # Allí `quitar` es quitarla de la lista de quitadas, o sea recuperarla.
        nueva = estrategias.nueva_version_excluidas(db, estrategia_id, ticker, quitar=not quitar)
        if nueva.id != fila.receta_id:
            if v.fase == FASE_CAMBIOS:
                _fijar_cartera(db, v, fila, nueva.id)
            else:
                db.execute(text("update liga.estrategias set receta_id = :r where id = :e"),
                           {"r": nueva.id, "e": estrategia_id})
            _apuntar(db, "cambios.quitar" if quitar else "cambios.recuperar", usuario_id,
                     estrategia_id, v,
                     v.receta_inscripcion if v.fase == FASE_CAMBIOS else fila.receta_id,
                     nueva.id, ticker)
        salida = estrategias.receta_salida(nueva)
        db.commit()
        return salida


def volver_a_la_formacion(usuario_id: str, estrategia_id: uuid.UUID,
                          fabrica: Fabrica = fabrica_sistema,
                          ahora: datetime | None = None) -> dict:
    """Restaura la receta de la formación y deshace los cambios pendientes."""
    with sesion(fabrica) as db:
        fila = _la_suya(db, usuario_id, estrategia_id)
        v = _ventana_de_cambios(db, estrategia_id, ahora)
        original = (receta_de_la_formacion(db, v) if v.fase == FASE_CAMBIOS
                    else v.receta_inscripcion)
        if original is None:
            raise HTTPException(409, translate("liga_changes_closed"))
        anterior = v.receta_inscripcion if v.fase == FASE_CAMBIOS else fila.receta_id
        if original != anterior:
            if v.fase == FASE_CAMBIOS:
                _fijar_cartera(db, v, fila, original)
            else:
                db.execute(text("update liga.estrategias set receta_id = :r where id = :e"),
                           {"r": original, "e": estrategia_id})
            _apuntar(db, "cambios.volver", usuario_id, estrategia_id, v, anterior, original)
        salida = estrategias.receta_salida(db.get(Receta, original))
        db.commit()
        return salida


def _apuntar(db: Session, accion: str, usuario_id: str, estrategia_id: uuid.UUID, v: Ventana,
             receta_antes: int, receta_despues: int, ticker: str | None = None) -> None:
    """Registra la receta vigente anterior y la nueva receta pendiente."""
    auditar(db, accion, f"estrategia:{estrategia_id}",
            {"ticker": ticker, "jornada_id": v.jornada_id, "inscripcion_id": v.inscripcion_id,
             "receta_antes": receta_antes, "receta_despues": receta_despues}, usuario_id)


def receta_de_la_formacion(db: Session, v: Ventana) -> int:
    """La receta con la que se formó la cartera: la de antes del primer cambio de la ventana, o la
    actual si todavía no hay ninguno."""
    primera = db.execute(text("""
        select (detalle ->> 'receta_antes')::bigint from liga.auditoria
        where accion in ('cambios.quitar', 'cambios.recuperar', 'cambios.volver')
          and (detalle ->> 'inscripcion_id')::bigint = :i
        order by id limit 1
    """), {"i": v.inscripcion_id}).scalar()
    return primera if primera is not None else v.receta_inscripcion


def detalle(v: Ventana, fabrica: Fabrica = fabrica_sistema) -> dict:
    """Muestra la cartera en curso y las exclusiones vigentes y de la formación."""
    with sesion(fabrica) as db:
        if v.fase == FASE_CAMBIOS:
            foto_id = db.get(Jornada, v.jornada_id).foto_id
        else:
            foto_id = db.execute(text("""
                select j.foto_id from liga.jornadas j
                join liga.inscripciones i on i.jornada_id = j.id where i.id = :i
            """), {"i": v.inscripcion_id}).scalar()
        cartera = [dict(f._mapping) for f in db.execute(text("""
            select p.ticker, p.peso, s.name as nombre, s.sector
            from liga.posiciones p
            left join lateral (
              select f.name, f.sector from fundamentals_snapshot f
              where f.foto_id = :f and f.ticker = p.ticker order by f.id desc limit 1) s on true
            where p.inscripcion_id = :i order by p.peso desc, p.ticker
        """), {"f": foto_id, "i": v.inscripcion_id})]
        vigente = db.execute(text("select receta_id from liga.estrategias where id = :e"),
                             {"e": v.estrategia_id}).scalar()
        receta_id = v.receta_inscripcion if v.fase == FASE_CAMBIOS else vigente
        quitadas = list(db.get(Receta, receta_id).excluidas or []) if receta_id else []
        nombres = dict(db.execute(text("""
            select distinct on (ticker) ticker, name from fundamentals_snapshot
            where foto_id = :f and ticker = any(:t) order by ticker, id desc
        """), {"f": foto_id, "t": quitadas}).all()) if quitadas else {}
        original = (receta_de_la_formacion(db, v) if v.fase == FASE_CAMBIOS
                    else v.receta_inscripcion)
        de_la_formacion = list(db.get(Receta, original).excluidas or []) if original else []
        proxima = _proxima(db, v) if v.fase == FASE_SIGUIENTE else None
    return {"cartera": cartera,
            "quitadas": [{"ticker": t, "nombre": nombres.get(t)} for t in quitadas],
            "quitadas_formacion": de_la_formacion, "proxima": proxima}


def _proxima(db: Session, v: Ventana) -> list[dict] | None:
    """La cartera de la semana que viene con la receta vigente, solo si estrena escaneo;
    sin pedir precios ni escribir nada."""
    j = db.get(Jornada, v.jornada_id)
    if j.foto_id is None or j.scan_run_id is None:
        return None
    ctx = formar.contexto(db, j)
    if not ctx.cambio_de_mes:
        return None
    fila = db.execute(text("""
        select id, nombre, cada_dia_1, receta_id from liga.estrategias where id = :e
    """), {"e": v.estrategia_id}).one()
    if fila.receta_id is None:
        return None
    if fila.cada_dia_1 == "mantener":
        if v.inscripcion_id is None:
            return None
        posiciones = db.execute(text("""
            select ticker, peso from liga.posiciones where inscripcion_id = :i
        """), {"i": v.inscripcion_id}).all()
    else:
        entrada, _o, _a = formar.entrada_de(
            db, ctx, list(ctx.empresas), set(), fila, vaciar_si_cambio=False)
        if entrada is None:
            return None
        posiciones = entrada.posiciones
    nombres = {f.ticker: (f.name, f.sector) for f in db.execute(text("""
        select distinct on (ticker) ticker, name, sector from fundamentals_snapshot
        where foto_id = :f and ticker = any(:t) order by ticker, id desc
    """), {"f": j.foto_id, "t": [t for t, _ in posiciones]})}
    return [{"ticker": t, "peso": p, "nombre": nombres.get(t, (None, None))[0],
             "sector": nombres.get(t, (None, None))[1]}
            for t, p in sorted(posiciones, key=lambda posicion: (-posicion[1], posicion[0]))]
