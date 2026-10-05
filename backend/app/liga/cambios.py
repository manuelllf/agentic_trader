"""La ventana de cambios: desde el corte del último día hasta las 09:00 de Nueva York del primero,
la estrategia ya tiene su cartera formada y su dueño solo puede Cambiar y Recuperar empresas.

Cada cambio crea una versión de la receta (solo cambian las quitadas) y recalcula la cartera con la
misma foto, las mismas notas y las respuestas guardadas: no usa IA. Pasadas las 09:00, quitar o
recuperar solo prepara la jornada siguiente, como siempre.

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


@dataclass(frozen=True)
class Ventana:
    fase: str
    jornada_id: int
    cierra: datetime
    inscripcion_id: int | None = None
    receta_inscripcion: int | None = None


def ventana_de(db: Session, estrategia_id: uuid.UUID | str,
               ahora: datetime | None = None) -> Ventana | None:
    """En qué punto de la ventana está la estrategia: `formando` (pasó el corte y su cartera aún
    se está formando), `cambios` (ya formada, se puede cambiar) o None (nada lo impide). Vale con
    la sesión de usuario: jornadas, inscripciones y la propia estrategia se leen."""
    fila = db.execute(_VENTANA, {"e": estrategia_id, "ahora": ahora or datetime.now(UTC)}
                      ).one_or_none()
    if fila is None:
        return None
    base = {"jornada_id": fila.jornada_id, "cierra": fila.cierra}
    if fila.estado == "formada" and fila.inscripcion_id is not None:
        return Ventana(FASE_CAMBIOS, inscripcion_id=fila.inscripcion_id,
                       receta_inscripcion=fila.receta_inscripcion, **base)
    if fila.estado == "programada" and fila.estado_estrategia in ("apuntada", "jugando"):
        return Ventana(FASE_FORMANDO, **base)
    return None


def exigir_fuera_de_la_ventana(db: Session, estrategia_id: uuid.UUID | str,
                               ahora: datetime | None = None) -> None:
    """Hasta que abra la jornada, esta estrategia solo admite Cambiar y Recuperar."""
    if ventana_de(db, estrategia_id, ahora) is not None:
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
    """Quita (`quitar`) o recupera una empresa de la cartera formada. Devuelve la receta nueva."""
    with sesion(fabrica) as db:
        fila = _la_suya(db, usuario_id, estrategia_id)
        v = _ventana_de_cambios(db, estrategia_id, ahora)
        if fila.receta_id != v.receta_inscripcion:
            raise HTTPException(409, translate("liga_changes_locked"))
        # Allí `quitar` es quitarla de la lista de quitadas, o sea recuperarla.
        nueva = estrategias.nueva_version_excluidas(db, estrategia_id, ticker, quitar=not quitar)
        if nueva.id != fila.receta_id:
            _fijar_cartera(db, v, fila, nueva.id)
            _apuntar(db, "cambios.quitar" if quitar else "cambios.recuperar", usuario_id,
                     estrategia_id, v, nueva.id, ticker)
        salida = estrategias.receta_salida(nueva)
        db.commit()
        return salida


def volver_a_la_formacion(usuario_id: str, estrategia_id: uuid.UUID,
                          fabrica: Fabrica = fabrica_sistema,
                          ahora: datetime | None = None) -> dict:
    """Deja la cartera como salió de la formación: las quitadas de entonces y ninguna más."""
    with sesion(fabrica) as db:
        fila = _la_suya(db, usuario_id, estrategia_id)
        v = _ventana_de_cambios(db, estrategia_id, ahora)
        original = receta_de_la_formacion(db, v)
        if original != v.receta_inscripcion:
            _fijar_cartera(db, v, fila, original)
            _apuntar(db, "cambios.volver", usuario_id, estrategia_id, v, original)
        salida = estrategias.receta_salida(db.get(Receta, original))
        db.commit()
        return salida


def _apuntar(db: Session, accion: str, usuario_id: str, estrategia_id: uuid.UUID, v: Ventana,
             receta_despues: int, ticker: str | None = None) -> None:
    """Cada cambio queda en la auditoría con la receta que había antes: la primera de la ventana
    es la de la formación, a la que vuelve «Volver»."""
    auditar(db, accion, f"estrategia:{estrategia_id}",
            {"ticker": ticker, "jornada_id": v.jornada_id, "inscripcion_id": v.inscripcion_id,
             "receta_antes": v.receta_inscripcion, "receta_despues": receta_despues}, usuario_id)


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


def quitadas_de_la_formacion(v: Ventana, fabrica: Fabrica = fabrica_sistema) -> list[str]:
    """Las quitadas con las que salió la cartera de la formación (para saber cuáles son nuevas).
    Sesión de sistema: `liga.auditoria` le está vetada a `authenticated`."""
    with sesion(fabrica) as db:
        return list(db.get(Receta, receta_de_la_formacion(db, v)).excluidas or [])
