"""Formar la jornada (programada → formada), plan §8: las carteras del día 1.

- Cada estrategia de usuario apuntada o jugando entra con la versión de su receta vigente en el
  corte (lo editado después cuenta para la jornada siguiente) y `motor.seleccion` sobre la foto
  de la jornada, con las notas de Jev de su escaneo. La pregunta propia sale de la caché
  `liga.respuestas_ia`, que se completa antes: con Pro va incluida y sin Pro se paga con créditos.
  La estrategia a la que le falte alguna respuesta, o el saldo, juega sin la pregunta y queda
  apuntado (`liga.formaciones_degradadas`).
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
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import precios
from app.liga.ia import comun as ia_comun
from app.liga.ia import precios as ia_precios
from app.liga.ia import pregunta as ia_pregunta
from app.liga.models import FormacionDegradada, Inscripcion, Jornada, Posicion, Receta
from app.liga.motor.catalogo import EmpresaFoto, RecetaNoValida
from app.liga.motor.rentabilidad import pesos_mantenidos
from app.liga.motor.seleccion import (
    NotasJev,
    candidatas_pregunta,
    seleccionar,
    seleccionar_o_sin_pregunta,
    sin_pregunta,
)
from app.liga.procesos import casa, datos
from app.liga.procesos.comun import (
    ErrorProceso,
    Fabrica,
    ahora_utc,
    auditar,
    auditar_fallo,
    avisar_admin,
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
LIMITE_PREGUNTAS_S = 600
AJUSTE_LIMITE_PREGUNTAS = "procesos.formar.limite_preguntas_s"
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
    sin_pregunta: str | None = None   # por qué jugó sin su pregunta: sin_ia, tope, sin_saldo...
    quitadas_vaciadas: bool = False   # la configuración cambió: no se aplican sus quitadas

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


def motivos_no_lista(j: Jornada, ahora: datetime | None, db: Session | None = None) -> list[str]:
    motivos = []
    if j.estado != "programada":
        motivos.append(f"La jornada ya está {j.estado}.")
    if j.foto_id is None or j.scan_run_id is None:
        motivos.append("Falta designar la foto y el escaneo de la jornada.")
    if ahora_utc(ahora) < j.cierre_inscripcion:
        motivos.append("Aún no ha pasado el corte de inscripción.")
    if db is not None and _anterior_sin_cerrar(db, j):
        motivos.append("La jornada anterior aún no está cerrada: ciérrala antes, las «mantener» "
                       "parten de sus resultados.")
    if db is not None and j.scan_run_id is not None and _foto_distinta_del_escaneo(db, j):
        motivos.append("La foto de la jornada no es la que usó su escaneo: vuelve a designarlas.")
    return motivos


def _foto_distinta_del_escaneo(db: Session, j: Jornada) -> bool:
    foto_escaneo = db.execute(text("select foto_id from scan_runs where id = :s"),
                              {"s": j.scan_run_id}).scalar()
    return foto_escaneo != j.foto_id


def _anterior_sin_cerrar(db: Session, j: Jornada) -> bool:
    return db.execute(text(
        "select 1 from liga.jornadas where dia_fin = :d and estado = 'formada' and id <> :j"),
        {"d": j.dia_base, "j": j.id}).first() is not None


def contexto(db: Session, j: Jornada) -> Contexto:
    return Contexto(j.id, j.foto_id, j.scan_run_id, bool(es_plan_b(db, j)), j.cierre_inscripcion,
                    j.dia_base, tuple(datos.cargar_empresas(db, j.foto_id)),
                    datos.cargar_notas(db, j.scan_run_id))


_ESTRATEGIAS = text("""
    select e.id, e.nombre, e.cada_dia_1, e.dueno_id::text as dueno,
           liga.tiene_pro(e.dueno_id) as incluida,
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


@dataclass(frozen=True)
class PreguntaDeEstrategia:
    """La pregunta propia de una estrategia en juego y las empresas por las que se pregunta."""

    estrategia_id: uuid.UUID
    dueno: str
    receta_id: int
    pregunta: str
    candidatas: frozenset[str]
    incluida: bool   # con Pro va en la jornada; sin Pro se paga con créditos

    @property
    def precio(self) -> Decimal:
        return ia_precios.precio_pregunta(len(self.candidatas))


def _preguntas_por_estrategia(db: Session, ctx: Contexto) -> list[PreguntaDeEstrategia]:
    """Las «mantener» no vuelven a preguntar: conservan lo del mes pasado, sin selección nueva."""
    preguntas = []
    for fila in db.execute(_ESTRATEGIAS, {"corte": ctx.corte}).all():
        if fila.receta_id is None or fila.cada_dia_1 == "mantener":
            continue
        receta = db.get(Receta, fila.receta_id)
        if receta is None or not receta.pregunta:
            continue
        candidatas = candidatas_pregunta(list(ctx.empresas), datos.receta_motor(receta), ctx.notas)
        preguntas.append(PreguntaDeEstrategia(fila.id, fila.dueno, receta.id, receta.pregunta,
                                              frozenset(candidatas), fila.incluida))
    return preguntas


def _agrupar(preguntas: Iterable[PreguntaDeEstrategia]) -> dict[str, set[str]]:
    """Pregunta propia -> candidatas (unión de todas las recetas vigentes que la comparten)."""
    agrupadas: dict[str, set[str]] = {}
    for p in preguntas:
        agrupadas.setdefault(p.pregunta, set()).update(p.candidatas)
    return agrupadas


def _preguntas_de_las_estrategias(db: Session, ctx: Contexto) -> dict[str, set[str]]:
    """Las preguntas que van incluidas en la jornada (cuentas Pro)."""
    return _agrupar(p for p in _preguntas_por_estrategia(db, ctx) if p.incluida)


def _reservar_las_de_pago(preguntas: list[PreguntaDeEstrategia], ctx: Contexto,
                          fabrica: Fabrica | None) -> tuple[set[uuid.UUID], list[tuple]]:
    """Sin Pro la pregunta se paga con créditos: se reserva su precio antes de preguntar. Quien
    no tiene saldo juega sin ella. Devuelve esas estrategias y las reservas hechas con su clave."""
    sin_saldo: set[uuid.UUID] = set()
    reservas: list[tuple[PreguntaDeEstrategia, str]] = []
    for p in preguntas:
        if p.incluida or not p.candidatas:
            continue
        clave = ia_comun.clave_cobro("formacion", f"jornada:{ctx.jornada_id}", p.receta_id,
                                     ctx.foto_id)
        try:
            ia_comun.reservar_creditos(p.dueno, p.precio, f"reserva:{clave}", fabrica)
        except HTTPException:
            sin_saldo.add(p.estrategia_id)
            continue
        reservas.append((p, clave))
    return sin_saldo, reservas


def _liquidar_las_de_pago(reservas: list[tuple], ctx: Contexto, fabrica: Fabrica | None) -> None:
    """Se cobra solo a quien de verdad juega con su pregunta, con todas sus respuestas; al resto
    se le devuelve la reserva entera."""
    for p, clave in reservas:
        faltan = ia_pregunta.coste_pendiente(
            pregunta=p.pregunta, foto_id=ctx.foto_id, candidatas=sorted(p.candidatas),
            fabrica=fabrica)["faltan"]
        if faltan:
            ia_comun.devolver_reserva(p.dueno, p.precio, clave, fabrica)
        else:
            ia_comun.liquidar_creditos(p.dueno, p.precio, p.precio, "formacion", clave,
                                       fabrica=fabrica)


def _devolver_las_de_pago(reservas: list[tuple], fabrica: Fabrica | None) -> None:
    for p, clave in reservas:
        ia_comun.devolver_reserva(p.dueno, p.precio, clave, fabrica)


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


def limite_preguntas_s(db: Session) -> int:
    """Segundos que se espera, como mucho, a las respuestas de la pregunta propia al formar; lo
    guardado en `liga.ajustes` solo vale si es un entero positivo."""
    valor = db.execute(text("select valor from liga.ajustes where clave = :c"),
                       {"c": AJUSTE_LIMITE_PREGUNTAS}).scalar()
    if isinstance(valor, bool) or not isinstance(valor, int) or valor < 1:
        return LIMITE_PREGUNTAS_S
    return valor


def _motivo_ia_no_disponible(fabrica: Fabrica | None) -> str | None:
    """`sin_ia` (apagada, sin clave o sin poder comprobarlo), `tope` (gasto del mes) o `None`."""
    try:
        razon = ia_comun.razon_no_disponible("formacion", fabrica)
    except Exception:  # noqa: BLE001 -- sistema de IA no alcanzable: igual que apagada
        return "sin_ia"
    if razon is None:
        return None
    return "tope" if razon == ia_comun.RAZON_TOPE else "sin_ia"


def rellenar_preguntas(db: Session, ctx: Contexto, fabrica: Fabrica | None = None,
                       limite_s: int = LIMITE_PREGUNTAS_S) -> str | None:
    """Rellena lo que falte de las preguntas que van incluidas en la jornada (cuentas Pro), a coste
    del sistema. Devuelve por qué no se pudo contestar todo (`sin_ia`,
    `tope` o `tiempo`) o `None`; la jornada se forma igual y cada estrategia a la que le falte
    alguna respuesta juega sin la pregunta (`planificar`). Necesita la sesión solo para leer qué
    preguntar: las llamadas a Jev se hacen con `contestar_preguntas`, sin ella abierta."""
    return contestar_preguntas(_preguntas_de_las_estrategias(db, ctx), ctx, fabrica, limite_s)


def contestar_preguntas(preguntas: dict[str, set[str]], ctx: Contexto,
                        fabrica: Fabrica | None = None,
                        limite_s: int = LIMITE_PREGUNTAS_S) -> str | None:
    """Las llamadas a Jev de `rellenar_preguntas`, con una hora límite común a todas. `fabrica`:
    por defecto la del sistema, igual en producción a la que usa la propia jornada; un proceso con
    la suya propia (tests, savepoints) la pasa para leer y escribir en la misma conexión."""
    if not preguntas:
        return None
    motivo = _motivo_ia_no_disponible(fabrica)
    if motivo is not None:
        return motivo
    empresas = {e.ticker: e for e in ctx.empresas}
    hasta = time.monotonic() + limite_s
    for texto, tickers in preguntas.items():
        try:
            res = ia_pregunta.responder_pendientes(
                pregunta=texto, foto_id=ctx.foto_id, empresas=empresas,
                candidatas=sorted(tickers), usuario_id=None, fabrica=fabrica,
                finalidad="formacion", hasta=hasta)
        except HTTPException:
            # El tope mensual se gastó (o se apagó la IA) a mitad: el resto sigue con la caché.
            logger.warning("Formar: la IA dejó de estar disponible; el resto de preguntas "
                           "sigue con lo que hay en caché")
            return "tope"
        if res.cortada:
            logger.warning("Formar: se acabó el tiempo para contestar (%s s); se forma con lo "
                           "que hay en caché", limite_s)
            return "tiempo"
    return None


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


_CONFIGURACION = ("reglas", "peso_negocio", "peso_precio", "peso_deuda", "peso_pronto",
                  "peso_pregunta", "pregunta", "n_empresas", "reparto", "max_por_sector")


def _configuracion(receta: Receta) -> tuple:
    """Lo que define cómo se elige la cartera, sin las quitadas ni la idea (que solo propone)."""
    return tuple(getattr(receta, c) for c in _CONFIGURACION)


def _receta_anterior(db: Session, estrategia_id: uuid.UUID, ctx: Contexto) -> Receta | None:
    """La receta con la que jugó la jornada anterior (la que acabó el día base), si jugó."""
    receta_id = db.execute(text("""
        select i.receta_id from liga.inscripciones i
        join liga.jornadas j on j.id = i.jornada_id
        where i.estrategia_id = :e and j.dia_fin = :d and i.receta_id is not null
    """), {"e": estrategia_id, "d": ctx.dia_base}).scalar()
    return db.get(Receta, receta_id) if receta_id is not None else None


def _con_cambios(base: list[tuple[str, Decimal]], empresas: list[EmpresaFoto], receta,  # noqa: ANN001
                 notas: dict[str, NotasJev], respuestas: dict) -> list[tuple[str, Decimal]]:
    """La cartera que se mantiene con las quitadas sustituidas: cada una cede su peso a la
    siguiente de la selección que no esté ya en cartera; si no quedan alternativas, va a caja."""
    quitadas = set(receta.excluidas)
    if not any(t in quitadas for t, _ in base):
        return base
    try:
        sel, _ = seleccionar_o_sin_pregunta(empresas, receta, notas, respuestas)
        alternativas = [f.ticker for f in sel.pasan]
    except RecetaNoValida:
        alternativas = []
    tenidas = {t for t, _ in base}
    libres = iter(t for t in alternativas if t not in tenidas)
    cartera: list[tuple[str, Decimal]] = []
    for t, p in base:
        if t not in quitadas:
            cartera.append((t, p))
        elif (nuevo := next(libres, None)) is not None:
            cartera.append((nuevo, p))
    return cartera


def entrada_de(db: Session, ctx: Contexto, empresas: list[EmpresaFoto], excluir: set[str],
               fila, motivo_ia: str | None = None,  # noqa: ANN001 — fila de SQL: id, nombre, ...
               forzar_sin_pregunta: str | None = None,
               vaciar_si_cambio: bool = True) -> tuple[Entrada | None, dict | None, str | None]:
    """La cartera de una estrategia: (entrada, omitida, aviso). `fila`: id, nombre, cada_dia_1 y
    receta_id. `forzar_sin_pregunta`: el motivo con el que ya jugó sin su pregunta, para
    recalcularla igual. `vaciar_si_cambio`: si la configuración cambió desde la jornada anterior,
    las quitadas no se aplican."""
    receta = db.get(Receta, fila.receta_id)
    motor = datos.receta_motor(receta)
    vaciar = False
    if vaciar_si_cambio and motor.excluidas:
        anterior = _receta_anterior(db, fila.id, ctx)
        if anterior is not None and _configuracion(anterior) != _configuracion(receta):
            motor, vaciar = replace(motor, excluidas=()), True
    respuestas = datos.cargar_respuestas(db, receta.pregunta, ctx.foto_id)
    aviso = None
    if fila.cada_dia_1 == "mantener":
        try:
            mantenidas = _mantenidas(db, fila.id, ctx)
        except ValueError as e:
            mantenidas = None
            aviso = (f"{fila.nombre}: no se pudieron mantener sus valores ({e}); "
                     "se selecciona de nuevo.")
        if mantenidas is not None:
            base = [(t, p) for t, p in mantenidas if t not in excluir]
            cartera = _con_cambios(base, empresas, motor, ctx.notas, respuestas)
            return Entrada(fila.id, fila.nombre, fila.receta_id, cartera, None, "mantener",
                           None, vaciar), None, aviso
    try:
        if forzar_sin_pregunta:
            sel, motivo = seleccionar(empresas, sin_pregunta(motor), ctx.notas), forzar_sin_pregunta
        else:
            sel, motivo = seleccionar_o_sin_pregunta(empresas, motor, ctx.notas, respuestas,
                                                     motivo_ia or "incompleta")
    except RecetaNoValida as e:
        return None, {"estrategia_id": fila.id, "nombre": fila.nombre,
                      "motivo": f"Receta no válida: {e}"}, aviso
    return Entrada(fila.id, fila.nombre, fila.receta_id,
                   [(el.ticker, el.peso) for el in sel.elegidas], len(sel.pasan), "seleccion",
                   motivo, vaciar), None, aviso


def planificar(db: Session, ctx: Contexto, excluir: set[str], motivo_ia: str | None = None,
               sin_saldo: set[uuid.UUID] | frozenset = frozenset()) -> Plan:
    """Todas las carteras, sin escribir nada. `excluir`: tickers sin precio de compra.
    `motivo_ia`: por qué no se pudo contestar todo (`rellenar_preguntas`); sin él, el motivo de
    una pregunta sin todas sus respuestas es `incompleta`. `sin_saldo`: las estrategias que no
    pudieron pagar su pregunta y juegan sin ella aunque otra cuenta ya la tenga en caché."""
    plan = Plan()
    empresas = [e for e in ctx.empresas if e.ticker not in excluir]
    for fila in db.execute(_ESTRATEGIAS, {"corte": ctx.corte}).all():
        if fila.receta_id is None:
            plan.omitidas.append({"estrategia_id": fila.id, "nombre": fila.nombre,
                                  "motivo": "No tenía receta antes del corte."})
            continue
        entrada, omitida, aviso = entrada_de(
            db, ctx, empresas, excluir, fila, motivo_ia,
            "sin_saldo" if fila.id in sin_saldo else None)
        if aviso:
            plan.avisos.append(aviso)
        if omitida:
            plan.omitidas.append(omitida)
        if entrada:
            plan.entradas.append(entrada)

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


def _precios_y_plan(fabrica: Fabrica, ctx: Contexto, motivo_ia: str | None = None,
                    sin_saldo: set[uuid.UUID] | frozenset = frozenset()) -> tuple[Plan, set[str]]:
    """Trae los cierres del día base de lo que entraría y vuelve a seleccionar sin lo que no
    tenga precio, hasta que no cambie nada."""
    sin_precio: set[str] = set()
    pedidos: set[str] = set()
    with sesion(fabrica) as db:
        plan = planificar(db, ctx, sin_precio, motivo_ia, sin_saldo)
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
            plan = planificar(db, ctx, sin_precio, motivo_ia, sin_saldo)
    raise ErrorProceso("Los precios del día base no terminan de cuadrar: revisa la fuente de "
                       f"precios (sin cierre: {', '.join(sorted(sin_precio))}).")


def _caja(posiciones: list[tuple[str, Decimal]] | tuple[tuple[str, Decimal], ...]) -> Decimal:
    return Decimal(100) - sum((p for _, p in posiciones), Decimal(0))


def _resumen(plan: Plan) -> dict:
    return {
        "estrategias": [{"estrategia_id": e.estrategia_id, "nombre": e.nombre,
                         "origen": e.origen, "estado": e.estado, "n_pasan": e.n_pasan,
                         "sin_pregunta": e.sin_pregunta,
                         "quitadas_vaciadas": e.quitadas_vaciadas,
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
                          "motivos": motivos_no_lista(j, None, db)})


def vista_previa(jornada_id: int, fabrica: Fabrica = fabrica_sistema,
                 ahora: datetime | None = None) -> dict:
    """Qué se formaría con lo guardado ahora mismo: sin escribir y sin pedir precios."""
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        motivos = motivos_no_lista(j, ahora, db)
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
                motivos = motivos_no_lista(j, ahora, db)
                if motivos:
                    raise ErrorProceso(" ".join(motivos))
                ctx = contexto(db, j)
                deseadas = _preguntas_por_estrategia(db, ctx)
                limite_s = limite_preguntas_s(db)
            sin_saldo, reservas = _reservar_las_de_pago(deseadas, ctx, fabrica)
            preguntas = _agrupar(p for p in deseadas if p.estrategia_id not in sin_saldo)
            # Sin la conexión abierta: Jev tarda y la jornada no debe retener una de la base.
            try:
                motivo_ia = contestar_preguntas(preguntas, ctx, fabrica, limite_s)
                _liquidar_las_de_pago(reservas, ctx, fabrica)
            except Exception:
                _devolver_las_de_pago(reservas, fabrica)
                raise
            plan, sin_precio = _precios_y_plan(fabrica, ctx, motivo_ia, sin_saldo)
            with sesion(fabrica) as db:
                hecho = _escribir(db, jornada_id, ctx, plan, sin_precio, ahora, actor)
            _avisar_sin_pregunta(fabrica, plan)
            from app.liga import avisos

            avisos.avisar_formacion(jornada_id, fabrica)
            return hecho
    except Exception as e:
        auditar_fallo(fabrica, "formar", f"jornada:{jornada_id}", e, actor)
        raise


def copiar_con_quitadas(db: Session, receta: Receta, excluidas: list[str]) -> Receta:
    """Una versión nueva de la receta, igual salvo por sus quitadas (las recetas no se editan)."""
    nueva = Receta(
        estrategia_id=receta.estrategia_id, idea=receta.idea, reglas=receta.reglas,
        excluidas=sorted(excluidas), catalogo_version=receta.catalogo_version,
        pregunta=receta.pregunta, peso_negocio=receta.peso_negocio, peso_precio=receta.peso_precio,
        peso_deuda=receta.peso_deuda, peso_pronto=receta.peso_pronto,
        peso_pregunta=receta.peso_pregunta, n_empresas=receta.n_empresas, reparto=receta.reparto,
        max_por_sector=receta.max_por_sector)
    db.add(nueva)
    db.flush()
    return nueva


def _version_sin_quitadas(db: Session, estrategia_id: uuid.UUID, receta_id: int) -> int:
    """La versión sin quitadas con la que juega la jornada. Si la estrategia sigue en la misma
    versión, queda como la vigente; si ya tiene una posterior, esa se respeta."""
    nueva = copiar_con_quitadas(db, db.get(Receta, receta_id), [])
    db.execute(text("update liga.estrategias set receta_id = :n where id = :e and receta_id = :o"),
               {"n": nueva.id, "e": estrategia_id, "o": receta_id})
    return nueva.id


def _escribir(db: Session, jornada_id: int, ctx: Contexto, plan: Plan, sin_precio: set[str],
              ahora: datetime | None, actor: str | None) -> dict:
    j = jornada_bloqueada(db, jornada_id)
    motivos = motivos_no_lista(j, ahora, db)
    if motivos:
        raise ErrorProceso(" ".join(motivos))
    if (j.foto_id, j.scan_run_id) != (ctx.foto_id, ctx.scan_run_id):
        raise ErrorProceso("La foto de la jornada cambió mientras se formaba: vuelve a lanzarlo.")
    ids = casa.asegurar(db)["ids"]
    for c in plan.casa.values():
        if c.posiciones is None:
            logger.info("Jornada %s: %s no juega. %s", j.id, c.clave, c.motivo)
    entradas = plan.entradas + entradas_casa(plan, ids)
    db.execute(text("select liga.completar_premio()"))
    optan = set(db.execute(text("select id from liga.estrategias where opta_premio")).scalars())
    for e in entradas:
        if e.quitadas_vaciadas:
            e.receta_id = _version_sin_quitadas(db, e.estrategia_id, e.receta_id)
        ins = Inscripcion(jornada_id=j.id, estrategia_id=e.estrategia_id, receta_id=e.receta_id,
                          n_pasan=e.n_pasan, estado=e.estado,
                          optaba_premio=e.estrategia_id in optan)
        db.add(ins)
        db.flush()
        db.add_all(Posicion(inscripcion_id=ins.id, ticker=t, peso=p) for t, p in e.posiciones)
        if e.sin_pregunta:
            db.add(FormacionDegradada(inscripcion_id=ins.id, motivo=e.sin_pregunta))
        if e.quitadas_vaciadas:
            db.add(FormacionDegradada(inscripcion_id=ins.id, motivo="quitadas_vaciadas"))
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
             "sin_pregunta": {str(e.estrategia_id): e.sin_pregunta
                              for e in plan.entradas if e.sin_pregunta},
             "quitadas_vaciadas": [str(e.estrategia_id) for e in plan.entradas
                                   if e.quitadas_vaciadas],
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


def _avisar_sin_pregunta(fabrica: Fabrica, plan: Plan) -> None:
    """Un solo aviso al administrador con cuántas estrategias jugaron sin su pregunta."""
    sin = [e for e in plan.entradas if e.sin_pregunta]
    if not sin:
        return
    motivos = ", ".join(sorted({e.sin_pregunta for e in sin}))
    with sesion(fabrica) as db:
        avisar_admin(db, "Vennett: jornada formada con estrategias sin su pregunta",
                     f"{len(sin)} de {len(plan.entradas)} jugaron sin su pregunta ({motivos}).")


def _auto_activo(db: Session) -> bool:
    """Encendido salvo que alguien lo apague a propósito (interruptor de emergencia)."""
    valor = db.execute(text("select valor from liga.ajustes where clave = :c"),
                       {"c": AJUSTE_AUTO}).scalar()
    return valor is not False


def job(fabrica: Fabrica = fabrica_sistema, ahora: datetime | None = None,
        reloj=time.monotonic) -> dict | None:  # noqa: ANN001 — reloj inyectable en pruebas
    """Forma sola la jornada que ya puede formarse: sigue programada, ya llegó su día base y ha
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
                Jornada.estado == "programada", Jornada.dia_base <= hoy, Jornada.dia_fin >= hoy,
                Jornada.cierre_inscripcion <= ahora_t).order_by(Jornada.dia_inicio)).all()
            listas = [j for j in vivas if ahora_t - j.cierre_inscripcion <= VENTANA_AUTO]
            for j in vivas:
                if j not in listas and j.id not in _abandonadas_avisadas:
                    _abandonadas_avisadas.add(j.id)
                    avisar_admin(
                        db, "Vennett: la jornada no se formó sola",
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
            avisar_admin(db, "Vennett: no se pudo formar la jornada", str(e)[:140])
        return None
