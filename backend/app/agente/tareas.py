"""Tareas del agente sin IA (F1): reclamo único, despertar, ejecución, vigía previo y consolidación.
Cada tarea se reclama en la base antes de correr, así dos procesos nunca hacen la misma."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import replace
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import CursorResult, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.agente import avisos, base, datos, despertares, libro, vigia
from app.agente.config import ajustes
from app.agente.datos import Barra, Extendido, Franja
from app.agente.models import Ejecucion, Estado, Evento, Fundamentales, Orden, Seguimiento
from app.agente.reloj import Tarea
from app.ledger.money import D

logger = logging.getLogger(__name__)

Descargar = Callable[[list[str], date], dict[str, list[Barra]]]
DescargarExtendido = Callable[[list[str], Franja, date], dict[str, Extendido]]

PREFIJO_REINTENTO = "reintento: "
MAX_ERROR = 2000
MINUTOS_HUERFANA = 90
ERROR_HUERFANA = "interrumpida: el proceso murió antes de terminar"
DIAS_HISTORIA = 400
DIAS_EJECUCION = 10


def reclamar(s: Session, tarea: Tarea, fecha: date) -> Ejecucion | None:
    """Reclama la tarea del día; solo una fallida admite un único reintento."""
    id_ = s.execute(
        insert(Ejecucion).values(tarea=tarea.value, fecha_ny=fecha)
        .on_conflict_do_nothing(index_elements=["tarea", "fecha_ny"])
        .returning(Ejecucion.id)).scalar()
    if id_ is None:
        # El UPDATE condicionado evita que dos procesos reintenten a la vez.
        id_ = s.execute(text(
            "update agente.ejecuciones set estado = 'en_curso', empezada = now(), "
            "terminada = null, error = :prefijo || coalesce(error, '') "
            "where tarea = :t and fecha_ny = :f and estado = 'fallida' "
            "and (error is null or not starts_with(error, :prefijo)) returning id"),
            {"t": tarea.value, "f": fecha, "prefijo": PREFIJO_REINTENTO}).scalar()
    if id_ is None:
        return None
    return s.execute(select(Ejecucion).where(Ejecucion.id == id_)
                     .execution_options(populate_existing=True)).scalar_one()


def liberar_huerfanas(s: Session) -> int:
    """Pasa a `fallida` las tareas que llevan demasiado `en_curso`: su proceso murió sin
    terminarlas. Así el reintento único las puede reclamar."""
    r = cast(CursorResult, s.execute(text(
        "update agente.ejecuciones set estado = 'fallida', terminada = now(), error = :e "
        "where estado = 'en_curso' and empezada < now() - make_interval(mins => :m)"),
        {"e": ERROR_HUERFANA, "m": MINUTOS_HUERFANA}))
    return r.rowcount


def terminar(s: Session, ej: Ejecucion, error: str | None) -> None:
    if error is not None and (ej.error or "").startswith(PREFIJO_REINTENTO):
        # Un fallo en el reintento conserva la marca: no se reclama una tercera vez.
        error = PREFIJO_REINTENTO + error
    ej.estado = "hecha" if error is None else "fallida"
    ej.terminada = func.now()
    ej.error = None if error is None else error[:MAX_ERROR]
    s.flush()


def evento(s: Session, origen: str, tipo: str, *, ticker: str | None = None,
           datos: dict[str, Any] | None = None, ejecucion_id: int | None = None) -> None:
    s.add(Evento(origen=origen, tipo=tipo, ticker=ticker, datos=datos or {},
                 ejecucion_id=ejecucion_id))
    s.flush()


def tickers_vigilados(s: Session) -> list[str]:
    """Posiciones actuales más seguimiento activo, sin duplicados y ordenados."""
    posiciones = set(libro.estado_posiciones(s))
    seguidos = set(s.execute(
        select(Seguimiento.ticker).where(Seguimiento.hasta.is_(None))).scalars())
    return sorted(posiciones | seguidos)


def _guardar_barras(s: Session, barras: dict[str, list[Barra]], hoy: date) -> None:
    acciones: list[libro.Accion] = []
    for ticker, lista in sorted(barras.items()):
        validas = [b for b in lista if b.dia <= hoy]
        libro.guardar_precios(s, ticker, [
            (b.dia, b.apertura, b.maximo, b.minimo, b.cierre, b.volumen) for b in validas])
        acciones += [libro.Accion(ticker, b.dia, b.dividendo, b.split) for b in validas
                     if b.dividendo > 0 or b.split != 1]
    if acciones:
        libro.registrar_acciones(s, acciones)


def _cierres(s: Session, tickers: list[str], hoy: date) -> tuple[dict[str, Decimal],
                                                                 dict[str, Decimal]]:
    de_hoy = {t: D(c) for t, c in s.execute(text(
        "select ticker, cierre from agente.precios where fecha = :h and ticker = any(:t)"),
        {"h": hoy, "t": tickers}).all()}
    previos = {t: D(c) for t, c in s.execute(text(
        "select distinct on (ticker) ticker, cierre from agente.precios "
        "where fecha < :h and ticker = any(:t) order by ticker, fecha desc"),
        {"h": hoy, "t": tickers}).all()}
    return de_hoy, previos


def _cargar_precios(s: Session, ej: Ejecucion, hoy: date, tickers: list[str],
                    descargar: Descargar) -> None:
    """Descarga desde el último cierre guardado de cada empresa; si la preparación ya lo hizo,
    el despertar solo trae lo que falte."""
    ultimos: dict[str, date] = {t: f for t, f in s.execute(text(
        "select ticker, max(fecha) from agente.precios where ticker = any(:t) group by ticker"),
        {"t": tickers}).all()}
    por_defecto = hoy - timedelta(days=DIAS_HISTORIA)
    desde = min(ultimos.get(t, por_defecto) for t in tickers)
    barras = descargar(tickers, desde)
    sin_datos = sorted(set(tickers) - set(barras))
    # Con la mayoría sin precios no hay revisión fiable: la tarea falla y se reintenta, en vez de
    # darse por hecha con la base vacía. Unos pocos (una empresa deslistada) solo se anotan.
    if len(sin_datos) * 2 > len(tickers):
        raise RuntimeError(f"Yahoo sin precios para {len(sin_datos)} de {len(tickers)} empresas")
    if sin_datos:
        evento(s, "sistema", "sin_datos", datos={"tickers": sin_datos}, ejecucion_id=ej.id)
    _guardar_barras(s, barras, hoy)


LeerFundamentales = Callable[[str], dict]


def hacer_preparacion(s: Session, ej: Ejecucion, hoy: date,
                      descargar: Descargar = datos.descargar,
                      leer: LeerFundamentales | None = None) -> None:
    """Una hora antes del despertar: precios y fundamentales de la watchlist, ya guardados, para
    que `screen` enseñe las empresas enteras sin descargar nada en mitad del ciclo."""
    from app.agente import herramientas

    tickers = tickers_vigilados(s)
    if not tickers:
        evento(s, "sistema", "preparacion", datos={"empresas": 0}, ejecucion_id=ej.id)
        return
    _cargar_precios(s, ej, hoy, tickers, descargar)
    leidos, fallidos = herramientas.leer_fundamentales_lote(
        tickers, leer or herramientas.fundamentales_yahoo)
    if len(fallidos) * 2 > len(tickers):
        raise RuntimeError(
            f"Yahoo sin fundamentales para {len(fallidos)} de {len(tickers)} empresas")
    for ticker, datos_empresa in leidos.items():
        s.execute(insert(Fundamentales).values(ticker=ticker, fecha_ny=hoy, datos=datos_empresa)
                  .on_conflict_do_update(index_elements=["ticker"],
                                         set_={"fecha_ny": hoy, "datos": datos_empresa}))
    s.flush()
    evento(s, "sistema", "preparacion", ejecucion_id=ej.id,
           datos={"empresas": len(tickers), "fundamentales": len(leidos),
                  "sin_fundamentales": fallidos})


def _fechas_de_resultados(s: Session, tickers: list[str]) -> dict[str, date]:
    """La próxima fecha de resultados que trae Yahoo en los fundamentales; sin fecha, sin fila."""
    filas = s.execute(text(
        "select ticker, datos->>'next_earnings_date' from agente.fundamentales "
        "where ticker = any(:t)"), {"t": tickers}).all()
    fechas: dict[str, date] = {}
    for ticker, bruto in filas:
        try:
            fechas[ticker] = date.fromisoformat(str(bruto)[:10])
        except ValueError:
            continue
    return fechas


def _mirar_extendido(s: Session, ej: Ejecucion, franja: Franja, tickers: list[str],
                     referencias: dict[str, Decimal], resultados: dict[str, date], hoy: date,
                     pedir: DescargarExtendido | None) -> list[vigia.Movimiento]:
    """Mira la franja fuera de sesión y deja cada movimiento fuerte en el registro, sin decidir."""
    precios = (pedir or datos.descargar_extendido)(tickers, franja, hoy)
    movimientos = vigia.movimientos_extendidos(franja.value, referencias, precios, resultados, hoy)
    for m in movimientos:
        evento(s, "vigia", f"movimiento_{franja.value}", ticker=m.ticker, datos=m.datos(),
               ejecucion_id=ej.id)
    evento(s, "sistema", franja.value, ejecucion_id=ej.id,
           datos={"empresas": len(tickers), "con_precio": len(precios),
                  "movimientos": len(movimientos)})
    return movimientos


def hacer_despertar(s: Session, ej: Ejecucion, hoy: date,
                    descargar: Descargar = datos.descargar,
                    extendido: DescargarExtendido | None = None) -> None:
    libro.abrir_libro(s, hoy)
    tickers = tickers_vigilados(s)
    if not tickers:
        libro.guardar_valor_diario(s, hoy)
        _ciclo_del_cierre(s, ej, hoy, hay_alertas=False)
        return
    _cargar_precios(s, ej, hoy, tickers, descargar)

    cierres, previos = _cierres(s, tickers, hoy)
    faltan = sorted(t for t in libro.estado_posiciones(s) if t not in cierres)
    if faltan:
        # Sin el cierre de hoy el valor del día saldría con precios viejos: no se guarda.
        evento(s, "sistema", "sin_cierre", datos={"tickers": faltan}, ejecucion_id=ej.id)
        return
    libro.guardar_valor_diario(s, hoy)

    niveles: list[vigia.Nivel] = []
    for seg in s.execute(select(Seguimiento).where(Seguimiento.hasta.is_(None))).scalars():
        niveles += vigia.niveles_desde_json(seg.ticker, seg.niveles)
    resultados = _fechas_de_resultados(s, tickers)
    eventos = [vigia.Evento(t, f, "resultados") for t, f in resultados.items()]
    alertas = vigia.revisar(libro.cartera(s, hoy), cierres, previos, niveles, eventos, hoy)
    for a in alertas:
        evento(s, "vigia", a.codigo, ticker=a.ticker, datos={"valor": str(a.valor)},
               ejecucion_id=ej.id)
    movimientos: list[vigia.Movimiento] = []
    try:
        with s.begin_nested():  # un fallo aquí no deja la transacción del cierre abortada
            movimientos = _mirar_extendido(s, ej, Franja.POSTMARKET, tickers, cierres,
                                           resultados, hoy, extendido)
    except Exception as exc:
        # El postmarket es un añadido: sin él el agente decide igual con el cierre.
        logger.exception("Postmarket no disponible")
        error = f"{type(exc).__name__}: {exc}"[:200]
        evento(s, "sistema", "sin_postmarket", datos={"error": error}, ejecucion_id=ej.id)
    _ciclo_del_cierre(s, ej, hoy,
                      hay_alertas=vigia.hay_que_despertar(alertas) or bool(movimientos))


def _ciclo_del_cierre(s: Session, ej: Ejecucion, hoy: date, hay_alertas: bool) -> None:
    """Revisión diaria del cierre, con las alertas y los despertares propios del día."""
    razones = despertares.razones(s, hoy, ej.id, hay_alertas)
    evento(s, "vigia", "ciclo_pendiente", datos=razones, ejecucion_id=ej.id)
    _lanzar_ciclo(s, ej, hoy)


def _lanzar_ciclo(s: Session, ej: Ejecucion, hoy: date) -> None:
    """El ciclo con IA solo corre si está activada; si no, queda constancia."""
    if not ajustes.ia_activa:
        evento(s, "sistema", "ia_apagada", ejecucion_id=ej.id)
        return
    from app.agente import busqueda, ciclo, herramientas, puerta

    llm, revisor_llm = _modelos()
    ctx = herramientas.Contexto(hoy=hoy, ejecucion_id=ej.id,
                                buscar=busqueda.buscador(s, hoy, ej.id))
    ciclo.despertar(s, hoy, llm=llm, revisor_llm=revisor_llm, ctx=ctx, sombra=ajustes.sombra)
    prueba = puerta.en_sombra(s)
    if prueba is not None:
        # La candidata decide sobre el mismo día, sin escribir ni crear órdenes.
        evento(s, "sistema", "ciclo_candidata", datos={"version": prueba[1].version},
               ejecucion_id=ej.id)
        ciclo.despertar(s, hoy, llm=llm, revisor_llm=revisor_llm,
                        ctx=replace(ctx, solo_lectura=True), candidata=prueba[1])


def _modelos() -> tuple[Any, Any]:
    from app.llm import get_llm

    llm = get_llm(model=ajustes.modelo, reasoning_effort=ajustes.razonamiento,
                  stage="agente_ciclo", timeout=ajustes.timeout_llm_s)
    revisor_llm = get_llm(model=ajustes.modelo_revisor,
                          reasoning_effort=ajustes.razonamiento_revisor,
                          stage="agente_revisor", timeout=ajustes.timeout_llm_s)
    return llm, revisor_llm


def hacer_ejecucion(s: Session, ej: Ejecucion, hoy: date, ahora: datetime,
                    descargar: Descargar = datos.descargar) -> None:
    pendientes = set(s.execute(select(Orden.ticker).where(
        Orden.estado == "pendiente", Orden.fecha_objetivo == hoy)).scalars())
    tickers = sorted(pendientes | set(libro.estado_posiciones(s)))
    if not tickers:
        return
    barras = descargar(tickers, hoy - timedelta(days=DIAS_EJECUCION))
    precios: dict[str, libro.PrecioApertura] = {}
    for ticker, lista in barras.items():
        de_hoy = next((b for b in lista if b.dia == hoy), None)
        previas = [b for b in lista if b.dia < hoy]
        # Sin apertura de hoy o sin cierre previo no hay precio fiable: la orden espera.
        if de_hoy is None or de_hoy.apertura is None or not previas:
            continue
        previo = max(previas, key=lambda b: b.dia)
        precios[ticker] = libro.PrecioApertura(ticker, previo.cierre, de_hoy.apertura)

    parada = bool(s.execute(select(Estado.parada).where(Estado.id == 1)).scalar())
    resultado = libro.ejecutar_pendientes(s, hoy, precios, ahora, parada)
    por_id: dict[int, str] = {i: t for i, t in s.execute(select(Orden.id, Orden.ticker).where(
        Orden.id.in_([i for i, _ in resultado]))).all()} if resultado else {}
    for orden_id, estado in resultado:
        evento(s, "ejecutor", f"orden_{estado}", ticker=por_id.get(orden_id),
               datos={"orden_id": orden_id}, ejecucion_id=ej.id)


def hacer_vigia_previo(s: Session, ej: Ejecucion, hoy: date,
                       extendido: DescargarExtendido | None = None) -> None:
    """Antes de abrir: el premarket de la watchlist frente al último cierre, solo registrado."""
    tickers = tickers_vigilados(s)
    if not tickers:
        evento(s, "sistema", Franja.PREMARKET.value, datos={"empresas": 0}, ejecucion_id=ej.id)
        return
    _, previos = _cierres(s, tickers, hoy)
    _mirar_extendido(s, ej, Franja.PREMARKET, tickers, previos,
                     _fechas_de_resultados(s, tickers), hoy, extendido)


def hacer_consolidacion(s: Session, ej: Ejecucion, hoy: date,
                        revisor_llm: Any = None) -> None:  # noqa: ANN401
    r = cast(CursorResult, s.execute(text("delete from agente.noticias where caduca < now()")))
    datos_ev: dict[str, Any] = {"noticias_borradas": r.rowcount}
    if ajustes.ia_activa or revisor_llm is not None:
        datos_ev.update(_juicios_de_la_noche(s, ej, hoy, revisor_llm))
    evento(s, "sistema", "consolidacion", datos=datos_ev, ejecucion_id=ej.id)


def _juicios_de_la_noche(s: Session, ej: Ejecucion, hoy: date,
                         revisor_llm: Any) -> dict[str, Any]:  # noqa: ANN401
    """Lecciones propuestas, cambios de filosofía y sombras vencidas, con el revisor."""
    from app.agente import ciclo, interruptor, memoria, puerta

    if revisor_llm is None:
        revisor_llm = _modelos()[1]
    medido = ciclo.Medido(ciclo.presupuesto(s, hoy, ej.id), revisor_llm, ajustes.modelo_revisor,
                          "juicios")
    try:
        return {"lecciones_aprobadas": memoria.revisar_lecciones(s, medido),
                "propuestas_en_sombra": puerta.revisar_propuestas(s, hoy, medido),
                "filosofias_adoptadas": puerta.cerrar_sombras(s, hoy, medido)}
    except (ciclo.SinPresupuesto, ciclo.Fallo, interruptor.EnPausa) as exc:
        # Lo que quede pendiente se juzga la noche siguiente.
        return {"juicios_aplazados": f"{type(exc).__name__}: {str(exc)[:200]}"}


def _marcar_fallida(ej_id: int, tarea: Tarea, error: str) -> None:
    with base.sesion() as s:
        ej = s.get(Ejecucion, ej_id)
        if ej is not None:
            terminar(s, ej, error)
            avisos.avisar(s, "agente_tarea_fallida",
                          {"tarea": tarea.value, "error": error[:200]}, ej_id)


def _entregar_avisos() -> None:
    """Después de confirmar la tarea y en su propia sesión: un Vennett caído no la tumba."""
    if not avisos.configurado():
        return
    try:
        with base.con_actor("agente"), base.sesion() as s:
            avisos.entregar_pendientes(s)
    except Exception:
        logger.exception("Entrega de avisos fallida; se reintenta en la siguiente tarea")


def correr(tarea: Tarea, fecha: date, ahora: datetime,
           descargar: Descargar = datos.descargar,
           extendido: DescargarExtendido | None = None) -> bool:
    """Hace la tarea y, ya confirmada, entrega los avisos pendientes."""
    hecha = _hacer(tarea, fecha, ahora, descargar, extendido)
    _entregar_avisos()
    return hecha


def _hacer(tarea: Tarea, fecha: date, ahora: datetime, descargar: Descargar,
           extendido: DescargarExtendido | None) -> bool:
    """Reclama y hace la tarea; si falla, deshace lo hecho y la deja `fallida`."""
    error = ""
    with base.con_actor("agente"):
        with base.sesion() as s:
            ej = reclamar(s, tarea, fecha)
            if ej is None:
                logger.info("Tarea %s de %s ya reclamada: se omite", tarea.value, fecha)
                return False
            ej_id = ej.id
            # El reclamo se confirma antes de trabajar para que nadie más entre.
            s.commit()
            try:
                if tarea is Tarea.DESPERTAR:
                    hacer_despertar(s, ej, fecha, descargar, extendido)
                elif tarea is Tarea.EJECUCION:
                    hacer_ejecucion(s, ej, fecha, ahora, descargar)
                elif tarea is Tarea.PREPARACION:
                    hacer_preparacion(s, ej, fecha, descargar)
                elif tarea is Tarea.VIGIA_PREVIO:
                    hacer_vigia_previo(s, ej, fecha, extendido)
                else:
                    hacer_consolidacion(s, ej, fecha)
                terminar(s, ej, None)
                logger.info("Tarea %s de %s hecha", tarea.value, fecha)
                return True
            except Exception as exc:
                logger.exception("Tarea %s de %s fallida", tarea.value, fecha)
                s.rollback()
                error = f"{type(exc).__name__}: {exc}"
        _marcar_fallida(ej_id, tarea, error)
    return False
