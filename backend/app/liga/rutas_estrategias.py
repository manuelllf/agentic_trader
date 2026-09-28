"""Rutas de estrategias (`/liga`): catálogo, crear/editar, recetas, apuntarse, exclusiones,
«ver qué entraría hoy», «¿por qué no sale X?», buscador de empresas y la ficha pública.

Cada ruta corre como el usuario (`db_usuario`): RLS decide qué ve y qué toca, así que el mismo
`SELECT`/`UPDATE` que deniega a un ajeno basta para las pruebas de IDOR. Lo que RLS le veta a
`authenticated` sin excepción (la foto, las notas de Jev, la caché de la pregunta) y lo que la BD
reserva al sistema (`liga.pruebas`) pasan por `estrategias.py`, que abre su propia sesión — nunca
`db_sistema` aquí (lo vigila `test_liga_puertas`)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.liga import acceso, estrategias
from app.liga.auth import Identidad, require_usuario
from app.liga.db import db_anon, db_usuario
from app.liga.ia import moderacion
from app.liga.models import Receta as RecetaModelo
from app.liga.motor.catalogo import RecetaNoValida
from app.liga.motor.seleccion import explicar, seleccionar
from app.liga.procesos import datos
from app.liga.rutas_publicas import EscudoOut

router = APIRouter(tags=["liga-estrategias"])

# Las expuestas y abusables si se piden sin freno: recorren la foto entera cada vez.
_LIMITE_PRUEBAS = acceso.LimiteFrecuencia(tope=20, ventana_s=60)
_LIMITE_BUSCAR = acceso.LimiteFrecuencia(tope=30, ventana_s=60)

_CAMPOS_ESTRATEGIA = """
    id, nombre, forma, dibujo, color1, color2, iniciales, visibilidad, declara_posiciones,
    destacable, estado, cada_dia_1, oculta, receta_id, creada, actualizada
"""


# ---- Esquemas ------------------------------------------------------------------------------------


class EscudoIn(BaseModel):
    forma: Literal["circulo", "escudo", "hexagono"]
    dibujo: Literal["liso", "mitades", "diagonal", "franja"]
    color1: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    color2: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    iniciales: str | None = Field(default=None, pattern=r"^[A-ZÑ0-9]{1,2}$")


class EstrategiaCrear(BaseModel):
    nombre: str = Field(min_length=1, max_length=28)
    escudo: EscudoIn


class EstrategiaPatch(BaseModel):
    """Solo lo que edita el dueño desde la ficha: el estado va por `apuntar`/`desapuntar`, la
    receta por su propia ruta y `oculta` es cosa de moderación (la BD lo bloquea igualmente)."""

    nombre: str | None = Field(default=None, min_length=1, max_length=28)
    forma: Literal["circulo", "escudo", "hexagono"] | None = None
    dibujo: Literal["liso", "mitades", "diagonal", "franja"] | None = None
    color1: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    color2: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    iniciales: str | None = Field(default=None, pattern=r"^[A-ZÑ0-9]{1,2}$")
    visibilidad: Literal["privada", "publicada"] | None = None
    declara_posiciones: Literal["si", "no"] | None = None
    destacable: bool | None = None
    cada_dia_1: Literal["revisar", "mantener"] | None = None


class EstrategiaOut(BaseModel):
    id: str
    nombre: str
    escudo: EscudoOut
    visibilidad: str
    declara_posiciones: str | None
    destacable: bool
    estado: str
    cada_dia_1: str
    oculta: bool
    receta_id: int | None
    creada: datetime
    actualizada: datetime


class ReglaIn(BaseModel):
    clave: str
    params: dict = Field(default_factory=dict)


class RecetaIn(BaseModel):
    idea: str | None = Field(default=None, max_length=400)
    reglas: list[ReglaIn] = Field(default_factory=list)
    excluidas: list[str] = Field(default_factory=list)
    pregunta: str | None = Field(default=None, max_length=160)
    pesos: dict[str, int]
    n_empresas: int
    reparto: str
    max_por_sector: int


class RecetaOut(BaseModel):
    id: int
    idea: str | None
    reglas: list[dict]
    excluidas: list[str]
    catalogo_version: int
    pregunta: str | None
    pesos: dict[str, int]
    n_empresas: int
    reparto: str
    max_por_sector: int
    creada: datetime


class CadaDia1In(BaseModel):
    opcion: Literal["revisar", "mantener"]


class EmpresaElegidaOut(BaseModel):
    ticker: str
    nombre: str | None
    sector: str | None
    peso: Decimal
    porque: str


class PruebaOut(BaseModel):
    id: str
    foto_id: int
    scan_run_id: int
    plan_b: bool
    catalogo_version: int
    evaluadas: int
    pasan: int
    elegidas: list[EmpresaElegidaOut]
    saltadas_por_sector: int
    sin_peso: int
    sin_notas: int
    sin_respuesta: int
    caja_pct: Decimal


class PorQueOut(BaseModel):
    ticker: str
    motivo: str


class EmpresaBusquedaOut(BaseModel):
    ticker: str
    nombre: str | None
    sector: str | None


class JornadaFichaOut(BaseModel):
    numero: int
    rentabilidad: Decimal | None
    puntos: int | None


class PosicionOut(BaseModel):
    ticker: str
    peso: Decimal


class FichaOut(BaseModel):
    id: str
    nombre: str
    escudo: EscudoOut
    casa: Literal["alpha", "omega", "lambda"] | None
    autor: str | None
    estado: str
    visibilidad: str
    es_dueno: bool
    jornadas: list[JornadaFichaOut]
    receta: RecetaOut | None
    posiciones: list[PosicionOut]


# ---- Ayudas de conversión ------------------------------------------------------------------------


def _a_salida(f) -> EstrategiaOut:  # noqa: ANN001
    return EstrategiaOut(
        id=str(f.id), nombre=f.nombre,
        escudo=EscudoOut(forma=f.forma, dibujo=f.dibujo, color1=f.color1, color2=f.color2,
                         iniciales=f.iniciales),
        visibilidad=f.visibilidad, declara_posiciones=f.declara_posiciones,
        destacable=f.destacable, estado=f.estado, cada_dia_1=f.cada_dia_1, oculta=f.oculta,
        receta_id=f.receta_id, creada=f.creada, actualizada=f.actualizada)


def _receta_out(r) -> RecetaOut:  # noqa: ANN001
    return RecetaOut(**estrategias.receta_salida(r))


# ---- Catálogo (público) -----------------------------------------------------------------------


@router.get("/catalogo", dependencies=[Depends(db_anon)])
def catalogo() -> dict:
    return estrategias.catalogo_payload()


# ---- Estrategias ------------------------------------------------------------------------------


@router.get("/estrategias", response_model=list[EstrategiaOut])
def mis_estrategias(db: Session = Depends(db_usuario)) -> list[EstrategiaOut]:
    filas = db.execute(text(f"""
        select {_CAMPOS_ESTRATEGIA} from liga.estrategias
        where dueno_id = (select auth.uid()) and tipo = 'usuario'
        order by creada desc
    """)).all()
    return [_a_salida(f) for f in filas]


@router.post("/estrategias", response_model=EstrategiaOut, status_code=201)
def crear_estrategia(body: EstrategiaCrear, db: Session = Depends(db_usuario)) -> EstrategiaOut:
    try:
        with db.begin_nested():
            fila = db.execute(text(f"""
                insert into liga.estrategias (nombre, forma, dibujo, color1, color2, iniciales)
                values (:nombre, :forma, :dibujo, :color1, :color2, :iniciales)
                returning {_CAMPOS_ESTRATEGIA}
            """), {"nombre": body.nombre, "forma": body.escudo.forma,
                   "dibujo": body.escudo.dibujo, "color1": body.escudo.color1,
                   "color2": body.escudo.color2, "iniciales": body.escudo.iniciales}).one()
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    moderacion.evaluar("estrategia", str(fila.id), body.nombre)
    return _a_salida(fila)


@router.get("/estrategias/{id}", response_model=EstrategiaOut)
def ver_estrategia(id: uuid.UUID, db: Session = Depends(db_usuario)) -> EstrategiaOut:
    fila = db.execute(text(f"select {_CAMPOS_ESTRATEGIA} from liga.estrategias where id = :i"),
                      {"i": id}).one_or_none()
    if fila is None:
        raise HTTPException(404, "No existe esa estrategia.")
    return _a_salida(fila)


@router.patch("/estrategias/{id}", response_model=EstrategiaOut)
def actualizar_estrategia(id: uuid.UUID, body: EstrategiaPatch,
                          db: Session = Depends(db_usuario)) -> EstrategiaOut:
    cambios = body.model_dump(exclude_unset=True)
    if not cambios:
        raise HTTPException(422, "No hay ningún cambio que guardar.")
    set_sql = ", ".join(f"{c} = :{c}" for c in cambios)
    try:
        with db.begin_nested():
            fila = db.execute(text(f"""
                update liga.estrategias set {set_sql} where id = :id
                returning {_CAMPOS_ESTRATEGIA}
            """), {**cambios, "id": id}).one_or_none()
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    if fila is None:
        raise HTTPException(404, "No existe esa estrategia.")
    if "nombre" in cambios:
        moderacion.evaluar("estrategia", str(fila.id), cambios["nombre"])
    return _a_salida(fila)


@router.delete("/estrategias/{id}", status_code=204, response_class=Response)
def borrar_estrategia(id: uuid.UUID, db: Session = Depends(db_usuario)) -> Response:
    fila = db.execute(text("select estado from liga.estrategias where id = :i"),
                      {"i": id}).one_or_none()
    if fila is None:
        raise HTTPException(404, "No existe esa estrategia.")
    if fila.estado != "borrador":
        raise HTTPException(409, "Solo puedes borrar un borrador.")
    try:
        with db.begin_nested():
            db.execute(text("delete from liga.estrategias where id = :i"), {"i": id})
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    return Response(status_code=204)


# ---- Receta (versión inmutable) ------------------------------------------------------------------


@router.post("/estrategias/{id}/receta", response_model=RecetaOut, status_code=201)
def crear_receta(id: uuid.UUID, body: RecetaIn, db: Session = Depends(db_usuario)) -> RecetaOut:
    validada = estrategias.validar_entrada(
        body.idea, [r.model_dump() for r in body.reglas], body.excluidas, body.pregunta,
        body.pesos, body.n_empresas, body.reparto, body.max_por_sector)
    nueva = RecetaModelo(
        estrategia_id=id, idea=body.idea, reglas=validada.reglas,
        excluidas=list(validada.excluidas), catalogo_version=validada.catalogo_version,
        pregunta=body.pregunta, peso_negocio=validada.pesos["negocio"],
        peso_precio=validada.pesos["precio"], peso_deuda=validada.pesos["deuda"],
        peso_pronto=validada.pesos["pronto"], peso_pregunta=validada.pesos["pregunta"],
        n_empresas=validada.n_empresas, reparto=validada.reparto,
        max_por_sector=validada.max_por_sector)
    try:
        with db.begin_nested():
            db.add(nueva)
            db.flush()
            db.execute(text("update liga.estrategias set receta_id = :r where id = :e"),
                      {"r": nueva.id, "e": id})
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    db.refresh(nueva)
    if body.pregunta:
        moderacion.evaluar("pregunta", str(id), body.pregunta)
    return _receta_out(nueva)


# ---- Apuntarse / cada día 1 ----------------------------------------------------------------------


def _cambiar_estado(db: Session, id: uuid.UUID, estado: str) -> EstrategiaOut:  # noqa: A002
    try:
        with db.begin_nested():
            fila = db.execute(text(f"""
                update liga.estrategias set estado = :estado where id = :id
                returning {_CAMPOS_ESTRATEGIA}
            """), {"estado": estado, "id": id}).one_or_none()
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    if fila is None:
        raise HTTPException(404, "No existe esa estrategia.")
    return _a_salida(fila)


@router.post("/estrategias/{id}/apuntar", response_model=EstrategiaOut)
def apuntar(id: uuid.UUID, db: Session = Depends(db_usuario)) -> EstrategiaOut:
    return _cambiar_estado(db, id, "apuntada")


@router.post("/estrategias/{id}/desapuntar", response_model=EstrategiaOut)
def desapuntar(id: uuid.UUID, db: Session = Depends(db_usuario)) -> EstrategiaOut:
    return _cambiar_estado(db, id, "borrador")


@router.post("/estrategias/{id}/cada-dia-1", response_model=EstrategiaOut)
def cada_dia_1(id: uuid.UUID, body: CadaDia1In, db: Session = Depends(db_usuario)) -> EstrategiaOut:
    try:
        with db.begin_nested():
            fila = db.execute(text(f"""
                update liga.estrategias set cada_dia_1 = :opcion where id = :id
                returning {_CAMPOS_ESTRATEGIA}
            """), {"opcion": body.opcion, "id": id}).one_or_none()
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    if fila is None:
        raise HTTPException(404, "No existe esa estrategia.")
    return _a_salida(fila)


# ---- Exclusiones («Quitar») ----------------------------------------------------------------------


def _ticker(t: str) -> str:
    t = t.strip().upper()
    if not t or len(t) > 16:
        raise HTTPException(422, "Ese ticker no es válido.")
    return t


@router.post("/estrategias/{id}/exclusiones/{ticker}", response_model=RecetaOut)
def excluir(id: uuid.UUID, ticker: str, db: Session = Depends(db_usuario)) -> RecetaOut:
    t = _ticker(ticker)
    try:
        with db.begin_nested():
            r = estrategias.nueva_version_excluidas(db, id, t, quitar=False)
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    return _receta_out(r)


@router.delete("/estrategias/{id}/exclusiones/{ticker}", response_model=RecetaOut)
def quitar_exclusion(id: uuid.UUID, ticker: str, db: Session = Depends(db_usuario)) -> RecetaOut:
    t = _ticker(ticker)
    try:
        with db.begin_nested():
            r = estrategias.nueva_version_excluidas(db, id, t, quitar=True)
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    return _receta_out(r)


# ---- «Ver qué entraría hoy» y su histórico -------------------------------------------------------


def _receta_de(db: Session, estrategia_id: uuid.UUID, dueno: str | None = None) -> RecetaModelo:
    fila = db.execute(text("select receta_id, dueno_id::text as dueno from liga.estrategias "
                           "where id = :e"), {"e": estrategia_id}).one_or_none()
    # Un Pro ve recetas publicadas ajenas, pero las pruebas quedan a nombre de quien las lanza.
    if fila is None or (dueno is not None and fila.dueno != dueno):
        raise HTTPException(404, "No existe esa estrategia.")
    if fila.receta_id is None:
        raise HTTPException(409, "Todavía no has guardado ninguna receta.")
    receta = db.get(RecetaModelo, fila.receta_id)
    if receta is None:
        raise HTTPException(404, "No existe esa receta.")
    return receta


def _seleccionar_con(ctx: estrategias.Contexto, receta: RecetaModelo):  # noqa: ANN202
    respuestas = estrategias.respuestas_sistema(receta.pregunta, ctx.foto_id)
    try:
        return seleccionar(list(ctx.empresas), datos.receta_motor(receta), ctx.notas, respuestas)
    except RecetaNoValida as e:
        raise HTTPException(422, " ".join(e.errores)) from e


@router.post("/estrategias/{id}/pruebas", response_model=PruebaOut)
def probar(id: uuid.UUID, ident: Identidad = Depends(require_usuario),
          db: Session = Depends(db_usuario)) -> PruebaOut:
    if not _LIMITE_PRUEBAS.permitido(ident.uid):
        raise HTTPException(429, "Demasiadas pruebas seguidas. Espera un poco.")
    receta = _receta_de(db, id, dueno=ident.uid)
    ctx = estrategias.foto_y_notas_actuales()
    seleccion = _seleccionar_con(ctx, receta)
    prueba_id = estrategias.crear_prueba_sistema(ident.uid, receta.id, ctx.foto_id,
                                                 len(seleccion.filas))
    return PruebaOut(**estrategias.resultado_prueba(prueba_id, ctx, seleccion, receta))


@router.get("/pruebas/{id}", response_model=PruebaOut)
def ver_prueba(id: uuid.UUID, db: Session = Depends(db_usuario)) -> PruebaOut:
    fila = db.execute(text("select id, receta_id, foto_id from liga.pruebas where id = :i"),
                      {"i": id}).one_or_none()
    if fila is None:
        raise HTTPException(404, "No existe esa prueba.")
    receta = db.get(RecetaModelo, fila.receta_id)
    if receta is None:
        raise HTTPException(404, "No existe la receta de esa prueba.")
    ctx = estrategias.foto_y_notas_de(fila.foto_id)
    seleccion = _seleccionar_con(ctx, receta)
    return PruebaOut(**estrategias.resultado_prueba(fila.id, ctx, seleccion, receta))


# ---- «¿Por qué no sale X?» --------------------------------------------------------------------


@router.get("/estrategias/{id}/por-que/{ticker}", response_model=PorQueOut)
def por_que(id: uuid.UUID, ticker: str, db: Session = Depends(db_usuario)) -> PorQueOut:
    t = _ticker(ticker)
    receta = _receta_de(db, id)
    ctx = estrategias.foto_y_notas_actuales()
    seleccion = _seleccionar_con(ctx, receta)
    return PorQueOut(ticker=t, motivo=explicar(t, seleccion, datos.receta_motor(receta)))


# ---- Buscador del universo ----------------------------------------------------------------------


@router.get("/universo/buscar", response_model=list[EmpresaBusquedaOut])
def buscar(q: str = Query(min_length=1, max_length=60),
          ident: Identidad = Depends(require_usuario)) -> list[dict]:
    if not _LIMITE_BUSCAR.permitido(ident.uid):
        raise HTTPException(429, "Demasiadas búsquedas seguidas. Espera un poco.")
    return estrategias.buscar_universo(q)


# ---- Ficha (proyección según quién mira) ---------------------------------------------------------


@router.get("/fichas/{id}", response_model=FichaOut)
def ficha(id: uuid.UUID, ident: Identidad = Depends(require_usuario),
         db: Session = Depends(db_usuario)) -> FichaOut:
    f = db.execute(text("""
        select e.id::text as eid, e.nombre, e.forma, e.dibujo, e.color1, e.color2, e.iniciales,
               e.casa_clave, e.visibilidad, e.dueno_id::text as dueno, e.estado, e.receta_id,
               p.alias
        from liga.estrategias e left join liga.perfiles p on p.id = e.dueno_id
        where e.id = :i
    """), {"i": id}).one_or_none()
    if f is None:
        raise HTTPException(404, "No existe esa estrategia.")
    jornadas = db.execute(text("""
        select j.numero, r.rentabilidad, r.puntos
        from liga.inscripciones i join liga.jornadas j on j.id = i.jornada_id
        left join liga.resultados r on r.inscripcion_id = i.id
        where i.estrategia_id = :i order by j.numero
    """), {"i": id}).all()
    receta_out = None
    if f.receta_id is not None:
        rf = db.execute(text("""
            select id, idea, reglas, excluidas, catalogo_version, pregunta, peso_negocio,
                   peso_precio, peso_deuda, peso_pronto, peso_pregunta, n_empresas, reparto,
                   max_por_sector, creada
            from liga.recetas where id = :r
        """), {"r": f.receta_id}).one_or_none()
        receta_out = _receta_out(rf) if rf is not None else None
    ins = db.execute(text("""
        select id from liga.inscripciones where estrategia_id = :i order by jornada_id desc limit 1
    """), {"i": id}).one_or_none()
    posiciones = []
    if ins is not None:
        posiciones = db.execute(text(
            "select ticker, peso from liga.posiciones where inscripcion_id = :i order by peso desc"
        ), {"i": ins.id}).all()
    return FichaOut(
        id=f.eid, nombre=f.nombre,
        escudo=EscudoOut(forma=f.forma, dibujo=f.dibujo, color1=f.color1, color2=f.color2,
                         iniciales=f.iniciales),
        casa=f.casa_clave, autor=f.alias, estado=f.estado, visibilidad=f.visibilidad,
        es_dueno=(f.dueno == ident.uid),
        jornadas=[JornadaFichaOut(numero=j.numero, rentabilidad=j.rentabilidad, puntos=j.puntos)
                 for j in jornadas],
        receta=receta_out,
        posiciones=[PosicionOut(ticker=p.ticker, peso=p.peso) for p in posiciones])


# ---- Copiar (Pro) ---------------------------------------------------------------------------


@router.post("/estrategias/{id}/copiar", response_model=EstrategiaOut, status_code=201)
def copiar(id: uuid.UUID, db: Session = Depends(db_usuario)) -> EstrategiaOut:
    try:
        with db.begin_nested():
            nueva_receta = estrategias.copiar_estrategia(db, id)
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    fila = db.execute(text(f"select {_CAMPOS_ESTRATEGIA} from liga.estrategias where id = :i"),
                      {"i": nueva_receta.estrategia_id}).one()
    moderacion.evaluar("estrategia", str(fila.id), fila.nombre)
    return _a_salida(fila)
