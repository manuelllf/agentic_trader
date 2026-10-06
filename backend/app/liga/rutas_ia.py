"""IA de la liga expuesta al usuario (`/liga`, plan §10 F6-A): el conversor. Solo exige identidad
(`require_usuario`): la llamada de IA en sí (switches, tope, foto, créditos) va por
`app.liga.ia`, que abre su propia sesión de sistema — nunca `db_sistema` aquí (lo vigila
`test_liga_puertas`)."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga import acceso, estrategias, limites
from app.liga.auth import Identidad, require_jugador, require_usuario
from app.liga.db import db_usuario
from app.liga.ia import conversor, lectura
from app.liga.ia.conversor import LARGO_FRASE

router = APIRouter(tags=["liga-ia"])


class ConvertirIn(BaseModel):
    frase: str = Field(min_length=1, max_length=LARGO_FRASE)
    estrategia_id: uuid.UUID | None = None   # la que se está editando, si ya existe


class ReglaSugeridaOut(BaseModel):
    clave: str
    params: dict = Field(default_factory=dict)


class InterpretacionOut(BaseModel):
    intencion: str = Field(max_length=160)
    tipo: Literal["exacta", "aproximada", "no_disponible"]
    regla: str | None = None
    motivo: str = Field(max_length=180)


class ConvertirOut(BaseModel):
    reglas: list[ReglaSugeridaOut]
    pesos: dict[str, int] | None
    pregunta: str | None
    nombre: str | None
    interpretacion: list[InterpretacionOut] = Field(default_factory=list, max_length=12)
    quedan: int   # usos que le quedan en esta estrategia y este mes, el menor de los dos


@router.post("/convertir", response_model=ConvertirOut, dependencies=[Depends(acceso.ocupar_ia)])
def convertir(body: ConvertirIn, ident: Identidad = Depends(require_usuario)) -> ConvertirOut:
    estrategia_id = str(body.estrategia_id) if body.estrategia_id else None
    sugerencia, usos = conversor.convertir(ident.uid, body.frase, estrategia_id)
    return ConvertirOut(
        reglas=[ReglaSugeridaOut(**r) for r in sugerencia.reglas], pesos=sugerencia.pesos,
        pregunta=sugerencia.pregunta, nombre=sugerencia.nombre, quedan=usos.quedan,
        interpretacion=[InterpretacionOut(
            intencion=i.intencion, tipo=i.tipo, regla=i.regla, motivo=i.motivo,
        ) for i in sugerencia.interpretacion])


# ---- «Leer a fondo» / «Leer mi cartera» (F6-B) --------------------------------------------------


class LecturaIn(BaseModel):
    idempotencia: str = Field(min_length=8, max_length=80)
    estrategia_id: uuid.UUID | None = None
    prueba_id: uuid.UUID | None = None


class LecturaOut(BaseModel):
    id: int
    ticker: str
    texto: str
    fuentes: list
    ya_comprada: bool
    creditos_cobrados: Decimal


class LecturaCarteraOut(BaseModel):
    lecturas: list[LecturaOut]
    creditos_cobrados: Decimal


@router.post("/lecturas/{ticker}", response_model=LecturaOut)
def leer_a_fondo(ticker: str, body: LecturaIn,
                 ident: Identidad = Depends(require_jugador)) -> LecturaOut:
    """Solo de una empresa entre las posiciones actuales o la última prueba del usuario (plan
    §10): el resto, 404, para no convertir esto en un buscador de informes gratis."""
    limites.exigir_lectura_disponible(ident.uid)
    t = ticker.strip().upper()
    if body.estrategia_id is not None:
        cartera = estrategias.cartera_prueba(ident.uid, body.estrategia_id, body.prueba_id)
        ctx = cartera[:2] if cartera is not None and t in cartera[2] else None
    else:
        ctx = estrategias.contexto_lectura(ident.uid, t)
    if ctx is None:
        raise HTTPException(404, "Esa empresa no está entre tus elegidas ahora mismo.")
    foto_id, scan_run_id = ctx
    lectura.exigir_saldo_para(ident.uid, t, foto_id)
    r = lectura.obtener_o_crear(t, foto_id, scan_run_id, ident.uid)
    if r is None:
        raise HTTPException(503, "No se pudo generar la lectura ahora. Prueba en un momento.")
    ya = lectura.ya_comprada(ident.uid, r.id)
    cobrados = Decimal(0) if ya else lectura.comprar(ident.uid, r.id)
    return LecturaOut(id=r.id, ticker=r.ticker, texto=r.texto, fuentes=r.fuentes,
                      ya_comprada=ya, creditos_cobrados=cobrados)


@router.get("/lecturas/{id}", response_model=LecturaOut)
def ver_lectura(id: int, db: Session = Depends(db_usuario)) -> LecturaOut:  # noqa: A002
    """RLS ya dice quién puede verla (solo quien la compró, o el admin): un intento ajeno da
    404, nunca 403 (no delatar que existe)."""
    fila = db.execute(text(
        "select id, ticker, texto, fuentes from liga.lecturas where id = :i"), {"i": id}
    ).one_or_none()
    if fila is None:
        raise HTTPException(404, "No existe esa lectura.")
    return LecturaOut(id=fila.id, ticker=fila.ticker, texto=fila.texto,
                      fuentes=list(fila.fuentes or []), ya_comprada=True,
                      creditos_cobrados=Decimal(0))


@router.get("/estrategias/{id}/lecturas", response_model=list[LecturaOut])
def lecturas_compradas(id: uuid.UUID, prueba_id: uuid.UUID | None = None,  # noqa: A002
                      ident: Identidad = Depends(require_usuario),
                      db: Session = Depends(db_usuario)) -> list[LecturaOut]:
    cartera = estrategias.cartera_prueba(ident.uid, id, prueba_id)
    if cartera is None:
        raise HTTPException(404, "No existe esa prueba de tu estrategia.")
    foto_id, _, tickers = cartera
    filas = db.execute(text("""
        select l.id, l.ticker, l.texto, l.fuentes from liga.lecturas l
        where l.foto_id = :f and l.ticker = any(:t)
          and exists (select 1 from liga.creditos_movimientos m
                      where m.lectura_id = l.id and m.usuario_id = cast(:u as uuid))
    """), {"f": foto_id, "t": tickers, "u": ident.uid}).all()
    return [LecturaOut(id=f.id, ticker=f.ticker, texto=f.texto, fuentes=list(f.fuentes or []),
                       ya_comprada=True, creditos_cobrados=Decimal(0)) for f in filas]


@router.post("/estrategias/{id}/lecturas", response_model=LecturaCarteraOut,
             dependencies=[Depends(acceso.ocupar_ia)])
def leer_cartera(id: uuid.UUID, body: LecturaIn, ident: Identidad = Depends(require_usuario),  # noqa: A002
                 db: Session = Depends(db_usuario)) -> LecturaCarteraOut:
    """«Leer mi cartera» (solo el dueño): una lectura por cada elegida de su última prueba que
    no tuviera ya comprada."""
    limites.exigir_lectura_disponible(ident.uid)
    dueno = db.execute(text("select dueno_id::text as d from liga.estrategias where id = :i"),
                       {"i": id}).one_or_none()
    if dueno is None or dueno.d != ident.uid:
        raise HTTPException(404, "No existe esa estrategia.")
    resultado = lectura.leer_cartera(ident.uid, id, body.idempotencia)
    return LecturaCarteraOut(
        lecturas=[LecturaOut(id=r.id, ticker=r.ticker, texto=r.texto, fuentes=r.fuentes,
                             ya_comprada=True, creditos_cobrados=Decimal(0))
                 for r in resultado["lecturas"]],
        creditos_cobrados=resultado["creditos_cobrados"])
