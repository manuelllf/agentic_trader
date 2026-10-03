"""Formar la jornada (programada → formada), plan §8: las carteras del día 1.

- Cada estrategia de usuario apuntada o jugando entra con la versión de su receta vigente en el
  corte (lo editado después cuenta para la jornada siguiente) y `motor.seleccion` sobre la foto
  de la jornada, con las notas de Jev de su escaneo. La pregunta propia sale solo de la caché
  `liga.respuestas_ia`: aquí no se llama a ninguna IA.
- Las «mantener» conservan sus valores con los pesos a los que llegaron al cierre del mes
  anterior (`rentabilidad.pesos_mantenidos`); si no jugaron la jornada anterior, se seleccionan.
- Los equipos de la casa, con `casa`.
- El precio de compra es el cierre del día base en `public.precio_cierre` (`precios.al_dia`, la
  única red). Una empresa sin ese cierre no se puede comprar: sale de la foto y se vuelve a
  seleccionar; en la casa, su peso va a caja.

Todo se escribe en una transacción, con la jornada bloqueada y en estado `programada`: repetirlo
no duplica nada.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import precios
from app.liga.ia import comun as ia_comun
from app.liga.ia import pregunta as ia_pregunta
from app.liga.models import Inscripcion, Jornada, Posicion, Receta
from app.liga.motor.catalogo import EmpresaFoto, RecetaNoValida
from app.liga.motor.rentabilidad import pesos_mantenidos
from app.liga.motor.seleccion import NotasJev, candidatas_pregunta, seleccionar
from app.liga.procesos import casa, datos
from app.liga.procesos.comun import (
    ErrorProceso,
    Fabrica,
    ahora_utc,
    auditar,
    auditar_fallo,
    candado,
    fabrica_sistema,
    hoy_bolsa,
    jornada,
    jornada_bloqueada,
    para_json,
    sesion,
)
from app.liga.procesos.foto import es_plan_b

logger = logging.getLogger(__name__)

SPY = precios.REFERENCIA
_VUELTAS_PRECIOS = 4
_MIN_CAIDA_FUENTE = 5    # sin cierre para más de esto (y más de un 20 %): la fuente está caída


@dataclass
class Entrada:
    """Una inscripción por escribir. Sin posiciones, juega en caja (`sin_empresas`)."""

    estrategia_id: uuid.UUID
    nombre: str
    receta_id: int | None
    posiciones: list[tuple[str, Decimal]]
    n_pasan: int | None
    origen: str

    @property
    def estado(self) -> str:
        return "formada" if self.posiciones else "sin_empresas"


@dataclass(frozen=True)
class Contexto:
    """Lo que la jornada lee una vez: la foto, las notas y el corte."""

    jornada_id: int
    foto_id: int
    scan_run_id: int
    plan_b: bool
    corte: datetime
    dia_base: date
    empresas: tuple[EmpresaFoto, ...]
    notas: dict[str, NotasJev]


@dataclass
class Plan:
    entradas: list[Entrada] = field(default_factory=list)
    omitidas: list[dict] = field(default_factory=list)
    casa: dict[str, casa.CarteraCasa] = field(default_factory=dict)
    avisos: list[str] = field(default_factory=list)

    @property
    def tickers(self) -> set[str]:
        t = {tk for e in self.entradas for tk, _ in e.posiciones}
        t |= {tk for c in self.casa.values() for tk, _ in (c.posiciones or ())}
        return t


def motivos_no_lista(j: Jornada, ahora: datetime | None) -> list[str]:
    motivos = []
    if j.estado != "programada":
        motivos.append(f"La jornada ya está {j.estado}.")
    if j.foto_id is None or j.scan_run_id is None:
        motivos.append("Falta designar la foto y el escaneo de la jornada.")
    if ahora_utc(ahora) < j.cierre_inscripcion:
        motivos.append("Aún no ha pasado el corte de inscripción.")
    return motivos


def contexto(db: Session, j: Jornada) -> Contexto:
    return Contexto(j.id, j.foto_id, j.scan_run_id, bool(es_plan_b(db, j)), j.cierre_inscripcion,
                    j.dia_base, tuple(datos.cargar_empresas(db, j.foto_id)),
                    datos.cargar_notas(db, j.scan_run_id))


_ESTRATEGIAS = text("""
    select e.id, e.nombre, e.cada_dia_1,
           coalesce(
             (select r.id from liga.recetas r where r.id = e.receta_id and r.creada <= :corte),
             (select r.id from liga.recetas r where r.estrategia_id = e.id and r.creada <= :corte
              order by r.creada desc, r.id desc limit 1)) as receta_id
    from liga.estrategias e
    where e.tipo = 'usuario' and e.estado in ('apuntada', 'jugando') and e.dueno_id is not null
      and exists (select 1 from liga.roles_usuario r
                  where r.usuario_id = e.dueno_id and r.rol = 'usuario')   -- no suspendida
    order by e.creada, e.id
""")


_TOKENS_ESTIMADOS_PREGUNTA = 200  # bloque de estado + pregunta, medida de sobra (F6-B)


def _preguntas_de_las_estrategias(db: Session, ctx: Contexto) -> dict[str, set[str]]:
    """Pregunta propia -> candidatas (unión de todas las recetas vigentes que la comparten). Las
    «mantener» no vuelven a preguntar: conservan lo del mes pasado, sin selección nueva."""
    preguntas: dict[str, set[str]] = {}
    for fila in db.execute(_ESTRATEGIAS, {"corte": ctx.corte}).all():
        if fila.receta_id is None or fila.cada_dia_1 == "mantener":
            continue
        receta = db.get(Receta, fila.receta_id)
        if receta is None or not receta.pregunta:
            continue
        candidatas = candidatas_pregunta(list(ctx.empresas), datos.receta_motor(receta), ctx.notas)
        preguntas.setdefault(receta.pregunta, set()).update(candidatas)
    return preguntas


def preview_preguntas(db: Session, ctx: Contexto, fabrica: Fabrica | None = None) -> dict:
    """Cuántas respuestas de la pregunta propia faltan en caché y un coste estimado en dólares
    (no exacto: el precio real de Jev depende de los tokens de cada llamada, que no se conocen
    sin llamar; se estima con un tamaño de estado típico). `fabrica`: ver `rellenar_preguntas`."""
    faltan = 0
    for texto, tickers in _preguntas_de_las_estrategias(db, ctx).items():
        info = ia_pregunta.coste_pendiente(pregunta=texto, foto_id=ctx.foto_id,
                                           candidatas=sorted(tickers), fabrica=fabrica)
        faltan += info["faltan"]
    coste_usd = round(faltan * _TOKENS_ESTIMADOS_PREGUNTA * 0.042 / 1_000_000, 4)
    return {"pregunta_pendientes": faltan, "pregunta_coste_estimado_usd": str(coste_usd)}


def rellenar_preguntas(db: Session, ctx: Contexto, fabrica: Fabrica | None = None) -> None:
    """Antes de formar, rellena lo que falte de la pregunta propia a coste del sistema (nunca se
    cobra créditos en la jornada, plan §10). Si la IA está apagada o el tope mensual ya se gastó,
    se sigue solo con lo que ya haya en caché -- el motor ya sabe tratar una empresa
    `SIN_RESPUESTA`. `fabrica`: por defecto la del sistema, igual en producción a la que usa la
    propia jornada; un proceso con la suya propia (tests, savepoints) la pasa para leer y
    escribir en la misma conexión."""
    preguntas = _preguntas_de_las_estrategias(db, ctx)
    if not preguntas:
        return
    try:
        ia_comun.verificar_disponible("pregunta", fabrica)
    except Exception:  # noqa: BLE001 -- apagado, tope gastado o sistema de IA no alcanzable:
        # se forma igual, solo con lo que ya haya en caché (nunca bloquea la jornada por esto).
        return
    empresas = {e.ticker: e for e in ctx.empresas}
    for texto, tickers in preguntas.items():
        try:
            ia_pregunta.responder_pendientes(pregunta=texto, foto_id=ctx.foto_id,
                                             empresas=empresas, candidatas=sorted(tickers),
                                             usuario_id=None, fabrica=fabrica)
        except HTTPException:
            # El tope mensual se gastó (o se apagó la IA) a mitad: el resto sigue con la caché.
            logger.warning("Formar: la IA dejó de estar disponible; el resto de preguntas "
                           "sigue con lo que hay en caché")
            return


def _mantenidas(db: Session, estrategia_id: uuid.UUID,
                ctx: Contexto) -> list[tuple[str, Decimal]] | None:
    """Los pesos con que acabó la jornada anterior (la que cerró el día base); None si no jugó."""
    prev = db.execute(text("""
        select i.id, j.dia_base, j.dia_fin from liga.inscripciones i
        join liga.jornadas j on j.id = i.jornada_id
        where i.estrategia_id = :e and j.estado = 'cerrada' and j.dia_fin = :d
    """), {"e": estrategia_id, "d": ctx.dia_base}).one_or_none()
    if prev is None:
        return None
    pos = datos.posiciones(db, [prev.id])[prev.id]
    if not pos:
        return []
    cierres = precios.series(db, [t for t, _ in pos], prev.dia_base, prev.dia_fin)
    return pesos_mantenidos(pos, cierres, prev.dia_base, prev.dia_fin)


def planificar(db: Session, ctx: Contexto, excluir: set[str]) -> Plan:
    """Todas las carteras, sin escribir nada. `excluir`: tickers sin precio de compra."""
    plan = Plan()
    empresas = [e for e in ctx.empresas if e.ticker not in excluir]
    for fila in db.execute(_ESTRATEGIAS, {"corte": ctx.corte}).all():
        if fila.receta_id is None:
            plan.omitidas.append({"estrategia_id": fila.id, "nombre": fila.nombre,
                                  "motivo": "No tenía receta antes del corte."})
            continue
        if fila.cada_dia_1 == "mantener":
            try:
                mantenidas = _mantenidas(db, fila.id, ctx)
            except ValueError as e:
                mantenidas = None
                plan.avisos.append(f"{fila.nombre}: no se pudieron mantener sus valores ({e}); "
                                   "se selecciona de nuevo.")
            if mantenidas is not None:
                quedan = [(t, p) for t, p in mantenidas if t not in excluir]
                plan.entradas.append(Entrada(fila.id, fila.nombre, fila.receta_id, quedan, None,
                                             "mantener"))
                continue
        receta = db.get(Receta, fila.receta_id)
        try:
            sel = seleccionar(empresas, datos.receta_motor(receta), ctx.notas,
                              datos.cargar_respuestas(db, receta.pregunta, ctx.foto_id))
        except RecetaNoValida as e:
            plan.omitidas.append({"estrategia_id": fila.id, "nombre": fila.nombre,
                                  "motivo": f"Receta no válida: {e}"})
            continue
        plan.entradas.append(Entrada(fila.id, fila.nombre, fila.receta_id,
                                     [(el.ticker, el.peso) for el in sel.elegidas],
                                     len(sel.pasan), "seleccion"))

    plan.casa["lambda"] = casa.cartera_lambda(db, ctx.scan_run_id, ctx.plan_b)
    plan.casa["alpha"] = casa.cartera_alpha(db, ctx.scan_run_id, ctx.plan_b)
    # Omega ya no es sus posiciones reales del corte (omega_huecos.md): nace con los 4 huecos
    # vacíos (juega en caja) y `diario` los va llenando con sus alertas según llegan durante el
    # mes -- así juega aunque nada se ejecute de verdad en la sala.
    plan.casa["omega"] = casa.CarteraCasa("omega", ())
    for clave in ("lambda", "alpha"):
        c = plan.casa[clave]
        if c.posiciones is None:
            continue
        fuera = sorted(t for t, _ in c.posiciones if t in excluir)
        if fuera:
            plan.casa[clave] = casa.CarteraCasa(
                clave, tuple((t, p) for t, p in c.posiciones if t not in excluir), c.motivo,
                c.avisos + tuple(f"{t}: sin cierre del día base, su peso va a caja."
                                 for t in fuera))
    return plan


def entradas_casa(plan: Plan, ids: dict[str, uuid.UUID]) -> list[Entrada]:
    return [Entrada(ids[clave], casa.CASAS[clave][0], None, list(c.posiciones), None,
                    f"casa:{clave}")
            for clave, c in plan.casa.items() if c.posiciones is not None and clave in ids]


def _precios_y_plan(fabrica: Fabrica, ctx: Contexto) -> tuple[Plan, set[str]]:
    """Trae los cierres del día base de lo que entraría y vuelve a seleccionar sin lo que no
    tenga precio, hasta que no cambie nada."""
    sin_precio: set[str] = set()
    pedidos: set[str] = set()
    with sesion(fabrica) as db:
        plan = planificar(db, ctx, sin_precio)
    for _ in range(_VUELTAS_PRECIOS):
        tickers = plan.tickers | {SPY}
        faltan = tickers - pedidos
        if faltan:
            with sesion(fabrica) as db:
                precios.al_dia(db, dict.fromkeys(sorted(faltan), ctx.dia_base))
            pedidos |= faltan
        with sesion(fabrica) as db:
            nuevos = tickers - datos.con_cierre(db, tickers, ctx.dia_base) - sin_precio
        if nuevos:
            # La fuente falla a ratos y `al_dia` lo traga: un segundo intento antes de dar un
            # valor por sin precio (la jornada, una vez formada, ya no se corrige).
            with sesion(fabrica) as db:
                precios.al_dia(db, dict.fromkeys(sorted(nuevos), ctx.dia_base))
            with sesion(fabrica) as db:
                nuevos = tickers - datos.con_cierre(db, tickers, ctx.dia_base) - sin_precio
        if len(nuevos) > max(_MIN_CAIDA_FUENTE, len(tickers) // 5):
            raise ErrorProceso(
                f"La fuente de precios no responde para {len(nuevos)} de {len(tickers)} valores: "
                "no se forma la jornada con tantos huecos. Vuelve a intentarlo en un rato.")
        if SPY in nuevos:
            raise ErrorProceso(f"No hay cierre del S&P (SPY) del {ctx.dia_base}: espera al "
                               "cierre de ese día.")
        if not nuevos:
            return plan, sin_precio
        sin_precio |= nuevos
        with sesion(fabrica) as db:
            plan = planificar(db, ctx, sin_precio)
    raise ErrorProceso("Los precios del día base no terminan de cuadrar: revisa la fuente de "
                       f"precios (sin cierre: {', '.join(sorted(sin_precio))}).")


def _caja(posiciones: list[tuple[str, Decimal]] | tuple[tuple[str, Decimal], ...]) -> Decimal:
    return Decimal(100) - sum((p for _, p in posiciones), Decimal(0))


def _resumen(plan: Plan) -> dict:
    return {
        "estrategias": [{"estrategia_id": e.estrategia_id, "nombre": e.nombre,
                         "origen": e.origen, "estado": e.estado, "n_pasan": e.n_pasan,
                         "posiciones": [{"ticker": t, "peso": p} for t, p in e.posiciones],
                         "caja": _caja(e.posiciones)}
                        for e in plan.entradas],
        "omitidas": plan.omitidas,
        "casa": {c.clave: {"juega": c.posiciones is not None, "motivo": c.motivo,
                           "avisos": list(c.avisos),
                           "posiciones": [{"ticker": t, "peso": p}
                                          for t, p in (c.posiciones or ())],
                           "caja": _caja(c.posiciones) if c.posiciones is not None else None}
                 for c in plan.casa.values()},
        "avisos": plan.avisos,
    }


def estado(jornada_id: int, fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        cuenta = dict(db.execute(text(
            "select estado, count(*) from liga.inscripciones where jornada_id = :j "
            "group by estado"), {"j": j.id}).all())
        return para_json({"jornada_id": j.id, "estado": j.estado, "inscripciones": cuenta,
                          "motivos": motivos_no_lista(j, None)})


def vista_previa(jornada_id: int, fabrica: Fabrica = fabrica_sistema,
                 ahora: datetime | None = None) -> dict:
    """Qué se formaría con lo guardado ahora mismo: sin escribir y sin pedir precios."""
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        motivos = motivos_no_lista(j, ahora)
        if j.foto_id is None or j.scan_run_id is None or j.estado != "programada":
            return para_json({"jornada_id": j.id, "listo": False, "motivos": motivos})
        ctx = contexto(db, j)
        plan = planificar(db, ctx, set())
        tickers = plan.tickers | {SPY}
        sin_precio = sorted(tickers - datos.con_cierre(db, tickers, j.dia_base))
        return para_json({
            "jornada_id": j.id, "listo": not motivos, "motivos": motivos,
            "foto_id": ctx.foto_id, "scan_run_id": ctx.scan_run_id, "plan_b": ctx.plan_b,
            "empresas": len(ctx.empresas), "con_notas": len(ctx.notas),
            "n_estrategias": len(plan.entradas), "n_omitidas": len(plan.omitidas),
            "tickers": len(tickers), "sin_precio": sin_precio,
            "casa_por_crear": casa.casas_que_faltan(db),
            **preview_preguntas(db, ctx, fabrica),
            **_resumen(plan),
        })


def ejecutar(jornada_id: int, fabrica: Fabrica = fabrica_sistema, actor: str | None = None,
             ahora: datetime | None = None) -> dict:
    try:
        with candado("formar", fabrica):
            with sesion(fabrica) as db:
                j = jornada(db, jornada_id)
                motivos = motivos_no_lista(j, ahora)
                if motivos:
                    raise ErrorProceso(" ".join(motivos))
                ctx = contexto(db, j)
                rellenar_preguntas(db, ctx, fabrica)
            plan, sin_precio = _precios_y_plan(fabrica, ctx)
            with sesion(fabrica) as db:
                return _escribir(db, jornada_id, ctx, plan, sin_precio, ahora, actor)
    except Exception as e:
        auditar_fallo(fabrica, "formar", f"jornada:{jornada_id}", e, actor)
        raise


def _escribir(db: Session, jornada_id: int, ctx: Contexto, plan: Plan, sin_precio: set[str],
              ahora: datetime | None, actor: str | None) -> dict:
    j = jornada_bloqueada(db, jornada_id)
    motivos = motivos_no_lista(j, ahora)
    if motivos:
        raise ErrorProceso(" ".join(motivos))
    if (j.foto_id, j.scan_run_id) != (ctx.foto_id, ctx.scan_run_id):
        raise ErrorProceso("La foto de la jornada cambió mientras se formaba: vuelve a lanzarlo.")
    ids = casa.asegurar(db)["ids"]
    for c in plan.casa.values():
        if c.posiciones is None:
            logger.info("Jornada %s: %s no juega. %s", j.id, c.clave, c.motivo)
    entradas = plan.entradas + entradas_casa(plan, ids)
    for e in entradas:
        ins = Inscripcion(jornada_id=j.id, estrategia_id=e.estrategia_id, receta_id=e.receta_id,
                          n_pasan=e.n_pasan, estado=e.estado)
        db.add(ins)
        db.flush()
        db.add_all(Posicion(inscripcion_id=ins.id, ticker=t, peso=p) for t, p in e.posiciones)
    usuarios = [e.estrategia_id for e in plan.entradas]
    if usuarios:
        db.execute(text("update liga.estrategias set estado = 'jugando' "
                        "where id = any(:ids) and tipo = 'usuario' and estado = 'apuntada'"),
                   {"ids": usuarios})
    j.estado = "formada"
    db.execute(text("update liga.temporadas set estado = 'en_juego' "
                    "where id = :t and estado = 'programada'"), {"t": j.temporada_id})
    auditar(db, "proceso.formar", f"jornada:{j.id}",
            {"inscripciones": len(entradas), "omitidas": len(plan.omitidas),
             "sin_precio": sorted(sin_precio),
             "casa": {c.clave: c.motivo for c in plan.casa.values()}}, actor)
    db.commit()
    return para_json({"jornada_id": j.id, "estado": j.estado, "inscripciones": len(entradas),
                      "sin_precio": sorted(sin_precio), "plan_b": ctx.plan_b, **_resumen(plan)})



# --- El del scheduler ---------------------------------------------------------------------------

AJUSTE_AUTO = "procesos.formar.auto"
_AVISO_CADA_S = 1800.0     # si algo impide formar: un aviso cada media hora, no cada 5 min
VENTANA_AUTO = timedelta(minutes=30)  # solo se intenta formar sola la media hora tras el corte
_ultimo_aviso: dict[int, float] = {}
_abandonadas_avisadas: set[int] = set()


def _avisar(db: Session, titulo: str, cuerpo: str) -> None:
    """Aviso por push a los administradores; nunca deja que un fallo de aviso tire el proceso."""
    try:
        from app import push

        push.send_to_all(db, title=titulo, body=cuerpo, url="/admin", tag="agentic-liga")
    except Exception:
        logger.exception("No se pudo avisar por push")


def _auto_activo(db: Session) -> bool:
    """Encendido salvo que alguien lo apague a propósito (interruptor de emergencia)."""
    valor = db.execute(text("select valor from liga.ajustes where clave = :c"),
                       {"c": AJUSTE_AUTO}).scalar()
    return valor is not False


def job(fabrica: Fabrica = fabrica_sistema, ahora: datetime | None = None,
        reloj=time.monotonic) -> dict | None:  # noqa: ANN001 — reloj inyectable en pruebas
    """Forma sola la jornada que ya puede formarse: sigue programada, está dentro de sus fechas y ha
    pasado su corte, hasta media hora después. Corre cada 5 minutos (unos 6 intentos), así que un
    reinicio o una fuente de precios caída se resuelven solos, pero no hay reintentos infinitos:
    pasada la media hora deja de intentarlo y avisa una sola vez: hay que formarla desde Admin.

    Las entradas de cada estrategia son las del corte (receta vigente, foto y escaneo designados),
    así que formarla con unos minutos u horas de retraso no cambia el resultado. Si falta la foto o
    el escaneo, o falla la fuente de precios, se registra y avisa por push (como mucho cada media
    hora); nunca tira el scheduler. El botón de Admin queda como salvavidas."""
    jornada_id = None
    try:
        hoy = hoy_bolsa(ahora)
        with sesion(fabrica) as db:
            if not _auto_activo(db):
                return None
            ahora_t = ahora_utc(ahora)
            vivas = db.scalars(select(Jornada).where(
                Jornada.estado == "programada", Jornada.dia_inicio <= hoy, Jornada.dia_fin >= hoy,
                Jornada.cierre_inscripcion <= ahora_t).order_by(Jornada.dia_inicio)).all()
            listas = [j for j in vivas if ahora_t - j.cierre_inscripcion <= VENTANA_AUTO]
            for j in vivas:
                if j not in listas and j.id not in _abandonadas_avisadas:
                    _abandonadas_avisadas.add(j.id)
                    _avisar(db, "Vennett: la jornada no se formó sola",
                            f"La jornada {j.numero} sigue sin formar media hora después del corte: "
                            "fórmala desde Admin.")
            if not listas:
                return None
            jornada_id = listas[0].id
        hecho = ejecutar(jornada_id, fabrica=fabrica, ahora=ahora)
        _ultimo_aviso.pop(jornada_id, None)
        return hecho
    except Exception as e:
        logger.exception("No se pudo formar la jornada %s", jornada_id)
        clave = jornada_id or 0
        ahora_s = reloj()
        if ahora_s - _ultimo_aviso.get(clave, -_AVISO_CADA_S) < _AVISO_CADA_S:
            return None
        _ultimo_aviso[clave] = ahora_s
        with sesion(fabrica) as db:
            _avisar(db, "Vennett: no se pudo formar la jornada", str(e)[:140])
        return None
