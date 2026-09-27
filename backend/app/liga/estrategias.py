"""Servicio de estrategias: valida recetas con el motor, mapea errores de la BD a mensajes claros
y hace de puente hacia lo que RLS le veta a `authenticated` (la foto, las notas de Jev y la caché
de la pregunta propia — plan §7.3: «lo lee el sistema y la API sirve solo lo necesario: buscador y
porqués»). Cada lectura o escritura de sistema abre su propia sesión y la cierra, como
`acceso._email_de`: nunca se expone `db_sistema` a una ruta (lo vigila `test_liga_puertas`).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.liga.models import Receta as RecetaModelo
from app.liga.motor.catalogo import CATALOGO, CATALOGO_VERSION, SECTORES_ES, EmpresaFoto
from app.liga.motor.seleccion import (
    ETIQUETAS_PESO,
    MAX_EXCLUIDAS,
    MAX_POR_SECTOR,
    N_EMPRESAS,
    PASO_PESO,
    PESO_MAXIMO,
    PESOS,
    REPARTOS,
    SIN_NOTAS,
    SIN_RESPUESTA,
    TOPE_PREGUNTA,
    NotasJev,
    Respuesta,
    Seleccion,
)
from app.liga.motor.seleccion import Receta as RecetaMotor
from app.liga.motor.seleccion import validar_receta as _validar_receta_motor
from app.liga.procesos import datos as procesos_datos
from app.liga.procesos.comun import ErrorProceso, fabrica_sistema
from app.liga.procesos.foto import _escaneo, _foto  # noqa: PLC2701 — reuso deliberado (plan §7)

# --- Errores de la BD a 4xx en castellano --------------------------------------------------------


def mapear_error(e: DBAPIError) -> HTTPException:
    """El texto ya viene en castellano (lo pone el disparador o el `check`); solo hace falta
    elegir el código HTTP según el tipo de violación."""
    orig = e.orig
    sqlstate = getattr(orig, "sqlstate", None)
    diag = getattr(orig, "diag", None)
    mensaje = str(getattr(diag, "message_primary", None) or orig)
    if sqlstate == "42501":
        return HTTPException(403, mensaje)
    if sqlstate == "23505":
        return HTTPException(409, mensaje)
    return HTTPException(422, mensaje)


# --- Catálogo para el constructor -----------------------------------------------------------------


def catalogo_payload() -> dict:
    reglas = [
        {
            "clave": r.clave,
            "titulo": r.titulo,
            "parametros": [
                {"nombre": p.nombre, "etiqueta": p.etiqueta, "tipo": p.tipo,
                 "minimo": p.minimo, "maximo": p.maximo, "paso": p.paso, "defecto": p.defecto}
                for p in r.parametros
            ],
        }
        for r in CATALOGO.values()
    ]
    return {
        "version": CATALOGO_VERSION,
        "sectores": dict(SECTORES_ES),
        "reglas": reglas,
        "pesos": {"claves": list(PESOS), "etiquetas": dict(ETIQUETAS_PESO),
                  "maximo": PESO_MAXIMO, "paso": PASO_PESO},
        "n_empresas": list(N_EMPRESAS),
        "repartos": list(REPARTOS),
        "max_por_sector": MAX_POR_SECTOR,
        "max_excluidas": MAX_EXCLUIDAS,
        "tope_pregunta": TOPE_PREGUNTA,
    }


def validar_entrada(idea: str | None, reglas: list[dict], excluidas: list[str],
                    pregunta: str | None, pesos: dict[str, int], n_empresas: int, reparto: str,
                    max_por_sector: int) -> RecetaMotor:
    """La receta de la petición, validada con el motor; `HTTPException(422)` si no vale."""
    limpias = tuple(sorted({t.strip().upper() for t in excluidas if t.strip()}))
    receta = RecetaMotor(reglas=reglas, excluidas=limpias, pesos=pesos, n_empresas=n_empresas,
                         reparto=reparto, max_por_sector=max_por_sector,
                         catalogo_version=CATALOGO_VERSION)
    errores = _validar_receta_motor(receta)
    if errores:
        raise HTTPException(422, " ".join(errores))
    return receta


def receta_salida(r) -> dict:  # noqa: ANN001 — vale para la fila ORM y para la de SQL crudo
    return {
        "id": r.id, "idea": r.idea, "reglas": list(r.reglas or []),
        "excluidas": list(r.excluidas or []), "catalogo_version": r.catalogo_version,
        "pregunta": r.pregunta,
        "pesos": {"negocio": r.peso_negocio, "precio": r.peso_precio, "deuda": r.peso_deuda,
                  "pronto": r.peso_pronto, "pregunta": r.peso_pregunta},
        "n_empresas": r.n_empresas, "reparto": r.reparto, "max_por_sector": r.max_por_sector,
        "creada": r.creada,
    }


# --- Exclusiones («Quitar»): las recetas no se editan, se versionan -------------------------------


def nueva_version_excluidas(db: Session, estrategia_id: uuid.UUID, ticker: str,
                            quitar: bool) -> RecetaModelo:
    """La receta vigente, igual salvo por un ticker más o menos en `excluidas`. Si el ticker ya
    estaba (o ya no estaba), no hace falta versión nueva: se devuelve la vigente tal cual."""
    fila = db.execute(text("select receta_id from liga.estrategias where id = :e"),
                      {"e": estrategia_id}).one_or_none()
    if fila is None:
        raise HTTPException(404, "No existe esa estrategia.")
    if fila.receta_id is None:
        raise HTTPException(409, "Todavía no has guardado ninguna receta.")
    r = db.get(RecetaModelo, fila.receta_id)
    if r is None:
        raise HTTPException(404, "No existe esa receta.")
    excluidas = set(r.excluidas or [])
    si_esta = ticker in excluidas
    if quitar == (not si_esta):
        return r
    if not quitar and len(excluidas) >= MAX_EXCLUIDAS:
        raise HTTPException(422, f"Puedes quitar a mano hasta {MAX_EXCLUIDAS} empresas.")
    excluidas.discard(ticker) if quitar else excluidas.add(ticker)
    nueva = RecetaModelo(
        estrategia_id=estrategia_id, idea=r.idea, reglas=r.reglas, excluidas=sorted(excluidas),
        catalogo_version=r.catalogo_version, pregunta=r.pregunta, peso_negocio=r.peso_negocio,
        peso_precio=r.peso_precio, peso_deuda=r.peso_deuda, peso_pronto=r.peso_pronto,
        peso_pregunta=r.peso_pregunta, n_empresas=r.n_empresas, reparto=r.reparto,
        max_por_sector=r.max_por_sector)
    db.add(nueva)
    db.flush()
    db.execute(text("update liga.estrategias set receta_id = :r where id = :e"),
              {"r": nueva.id, "e": estrategia_id})
    return nueva


# --- Lo que RLS le veta a `authenticated`: foto, notas y caché de la pregunta ---------------------


@dataclass(frozen=True)
class Contexto:
    """La foto y las notas de una jornada, ya en la forma del motor (plan §8)."""

    foto_id: int
    scan_run_id: int
    plan_b: bool
    empresas: tuple[EmpresaFoto, ...]
    notas: dict[str, NotasJev]


def _contexto_desde(db: Session, foto_id: int | None) -> Contexto:
    try:
        foto = _foto(db, foto_id)
        scan_run_id, avisos = _escaneo(db, foto, None)
    except ErrorProceso as e:
        raise HTTPException(e.codigo, str(e)) from e
    empresas = tuple(procesos_datos.cargar_empresas(db, foto.id))
    notas = procesos_datos.cargar_notas(db, scan_run_id)
    return Contexto(foto.id, scan_run_id, bool(avisos), empresas, notas)


def foto_y_notas_actuales() -> Contexto:
    """La última foto completa y las notas de su escaneo de decisión (o el plan B, plan §8)."""
    db = fabrica_sistema()
    try:
        return _contexto_desde(db, None)
    finally:
        db.close()


def foto_y_notas_de(foto_id: int) -> Contexto:
    """Para recomputar una prueba pasada: la misma foto, con el mejor escaneo de hoy para ella."""
    db = fabrica_sistema()
    try:
        return _contexto_desde(db, foto_id)
    finally:
        db.close()


def respuestas_sistema(pregunta: str | None, foto_id: int) -> dict[str, Respuesta]:
    """Solo de la caché (`liga.respuestas_ia`, vetada a `authenticated`): aquí no se llama a IA."""
    if not pregunta:
        return {}
    db = fabrica_sistema()
    try:
        return procesos_datos.cargar_respuestas(db, pregunta, foto_id)
    finally:
        db.close()


def buscar_universo(q: str, limite: int = 20) -> list[dict]:
    """Ticker, nombre y sector de la última foto completa: nunca el resto de las métricas."""
    termino = q.strip()
    if not termino:
        return []
    db = fabrica_sistema()
    try:
        try:
            foto = _foto(db, None)
        except ErrorProceso as e:
            raise HTTPException(e.codigo, str(e)) from e
        filas = db.execute(text("""
            select ticker, name, sector from (
                select distinct on (s.ticker) s.ticker, s.name, s.sector
                from fundamentals_snapshot s
                where s.foto_id = :f and (s.ticker ilike :q or s.name ilike :q)
                order by s.ticker, s.id desc
            ) u
            order by u.ticker
            limit :lim
        """), {"f": foto.id, "q": f"%{termino}%", "lim": limite}).all()
        return [{"ticker": f.ticker, "nombre": f.name, "sector": f.sector} for f in filas]
    finally:
        db.close()


# --- Escrituras que la BD reserva al sistema (plan §7.2 y §11) ------------------------------------


def crear_prueba_sistema(usuario_id: str, receta_id: int, foto_id: int,
                         n_evaluadas: int) -> uuid.UUID:
    """`liga.pruebas` no tiene INSERT para `authenticated`: lo escribe el backend como sistema."""
    db = fabrica_sistema()
    try:
        fila = db.execute(text("""
            insert into liga.pruebas (usuario_id, receta_id, foto_id, estado, n_evaluadas,
                                      idempotencia)
            values (:u, :r, :f, 'hecha', :n, :idem)
            returning id
        """), {"u": usuario_id, "r": receta_id, "f": foto_id, "n": n_evaluadas,
               "idem": uuid.uuid4().hex}).one()
        db.commit()
        return fila.id
    finally:
        db.close()


def resultado_prueba(prueba_id: uuid.UUID, ctx: Contexto, seleccion: Seleccion, receta) -> dict:  # noqa: ANN001
    """La cartera que saldría hoy, con el porqué de cada elegida y los recuentos de la maqueta."""
    elegidas = [
        {"ticker": el.ticker, "nombre": el.fila.empresa.nombre, "sector": el.fila.empresa.sector,
         "peso": el.peso, "porque": el.porque}
        for el in seleccion.elegidas
    ]
    sin_notas = sum(1 for f in seleccion.filas if f.fallo == SIN_NOTAS)
    sin_respuesta = sum(1 for f in seleccion.filas if f.fallo == SIN_RESPUESTA)
    return {
        "id": str(prueba_id), "foto_id": ctx.foto_id, "scan_run_id": ctx.scan_run_id,
        "plan_b": ctx.plan_b, "catalogo_version": receta.catalogo_version,
        "evaluadas": len(seleccion.filas), "pasan": len(seleccion.pasan),
        "elegidas": elegidas, "saltadas_por_sector": len(seleccion.saltadas_por_sector),
        "sin_peso": len(seleccion.sin_peso), "sin_notas": sin_notas,
        "sin_respuesta": sin_respuesta, "caja_pct": seleccion.caja_pct,
    }
