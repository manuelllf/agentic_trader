"""Modelos ORM del esquema `agente` (la fuente de verdad es sql/agente/001_esquema.sql).

Las vistas y `foto_cartera` no se mapean: se leen con SQL."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from app.agente.base import Base

try:
    from pgvector.sqlalchemy import Vector
except ImportError:  # pgvector no instalado: tipo mínimo con la misma declaración SQL

    class Vector(UserDefinedType):  # type: ignore[no-redef]
        cache_ok = True

        def __init__(self, dim: int = 384) -> None:
            self.dim = dim

        def get_col_spec(self, **kw: Any) -> str:  # noqa: ANN401, ARG002
            return f"vector({self.dim})"


_TS = DateTime(timezone=True)


def _creado() -> Mapped[datetime]:
    return mapped_column(_TS, server_default=func.now())


def _creado_por() -> Mapped[str]:
    return mapped_column(Text, server_default=text("agente.actor()"))


def _act_en() -> Mapped[datetime | None]:
    return mapped_column(_TS)


def _act_por() -> Mapped[str | None]:
    return mapped_column(Text)


class Estado(Base):
    __tablename__ = "estado"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, server_default=text("1"))
    parada: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    parada_motivo: Mapped[str | None] = mapped_column(Text)
    modo: Mapped[str] = mapped_column(Text, server_default=text("'papel'"))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class Ejecucion(Base):
    __tablename__ = "ejecuciones"
    __table_args__ = (UniqueConstraint("tarea", "fecha_ny"),)
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    tarea: Mapped[str] = mapped_column(Text)
    fecha_ny: Mapped[date] = mapped_column(Date)
    estado: Mapped[str] = mapped_column(Text, server_default=text("'en_curso'"))
    empezada: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    terminada: Mapped[datetime | None] = mapped_column(_TS)
    error: Mapped[str | None] = mapped_column(Text)
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class Evento(Base):
    __tablename__ = "eventos"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ocurrido: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    origen: Mapped[str] = mapped_column(Text)
    tipo: Mapped[str] = mapped_column(Text)
    ticker: Mapped[str | None] = mapped_column(Text)
    datos: Mapped[Any] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    ejecucion_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agente.ejecuciones.id")
    )
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()


class Seguimiento(Base):
    __tablename__ = "seguimiento"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ticker: Mapped[str] = mapped_column(Text)
    motivo: Mapped[str] = mapped_column(Text)
    desde: Mapped[date] = mapped_column(Date, server_default=text("current_date"))
    hasta: Mapped[date | None] = mapped_column(Date)
    niveles: Mapped[Any] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class Ficha(Base):
    __tablename__ = "fichas"
    ticker: Mapped[str] = mapped_column(Text, primary_key=True)
    contenido: Mapped[Any] = mapped_column(JSONB)
    certeza: Mapped[str] = mapped_column(Text, server_default=text("'conjetura'"))
    version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class PlaybookVersion(Base):
    __tablename__ = "playbook_versiones"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, unique=True)
    contenido: Mapped[str] = mapped_column(Text)
    diferencia: Mapped[str | None] = mapped_column(Text)
    motivo: Mapped[str] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(Text)
    adoptada_en: Mapped[datetime | None] = mapped_column(_TS)
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class FichaMejora(Base):
    __tablename__ = "fichas_mejora"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    hipotesis: Mapped[str] = mapped_column(Text)
    cambio: Mapped[str] = mapped_column(Text)
    criterio_exito: Mapped[str] = mapped_column(Text)
    regla_parada: Mapped[str] = mapped_column(Text)
    playbook_candidata_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agente.playbook_versiones.id")
    )
    estado: Mapped[str] = mapped_column(Text, server_default=text("'propuesta'"))
    revisor_veredicto: Mapped[str | None] = mapped_column(Text)
    revisor_motivo: Mapped[str | None] = mapped_column(Text)
    sombra_desde: Mapped[date | None] = mapped_column(Date)
    sombra_hasta: Mapped[date | None] = mapped_column(Date)
    resultado: Mapped[Any | None] = mapped_column(JSONB)
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class Decision(Base):
    __tablename__ = "decisiones"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ejecucion_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agente.ejecuciones.id")
    )
    fecha_ny: Mapped[date] = mapped_column(Date)
    tipo: Mapped[str] = mapped_column(Text)
    sombra: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    playbook_version_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agente.playbook_versiones.id")
    )
    propuesta: Mapped[Any] = mapped_column(JSONB)
    razonamiento: Mapped[str] = mapped_column(Text)
    previsiones: Mapped[Any] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    revisor_veredicto: Mapped[str | None] = mapped_column(Text)
    revisor_motivo: Mapped[str | None] = mapped_column(Text)
    modelo: Mapped[str] = mapped_column(Text)
    ciclo: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    embedding: Mapped[Any | None] = mapped_column(Vector(384))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()


class Leccion(Base):
    __tablename__ = "lecciones"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    texto: Mapped[str] = mapped_column(Text)
    decision_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger))
    estado: Mapped[str] = mapped_column(Text, server_default=text("'propuesta'"))
    revisor_motivo: Mapped[str | None] = mapped_column(Text)
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class Noticia(Base):
    __tablename__ = "noticias"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ticker: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text, unique=True)
    titulo: Mapped[str] = mapped_column(Text)
    fuente: Mapped[str] = mapped_column(Text)
    resumen: Mapped[str] = mapped_column(Text)
    publicada: Mapped[datetime | None] = mapped_column(_TS)
    caduca: Mapped[datetime] = mapped_column(_TS, server_default=text("now() + interval '30 days'"))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()


class Orden(Base):
    __tablename__ = "ordenes"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    decision_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("agente.decisiones.id"))
    ticker: Mapped[str] = mapped_column(Text)
    lado: Mapped[str] = mapped_column(Text)
    acciones: Mapped[Decimal | None] = mapped_column(Numeric(asdecimal=True))
    importe_objetivo: Mapped[Decimal | None] = mapped_column(Numeric(asdecimal=True))
    fecha_objetivo: Mapped[date] = mapped_column(Date)
    clave: Mapped[str] = mapped_column(Text, unique=True)
    estado: Mapped[str] = mapped_column(Text, server_default=text("'pendiente'"))
    motivo: Mapped[str | None] = mapped_column(Text)
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class Ejecutada(Base):
    __tablename__ = "ejecutadas"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    orden_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("agente.ordenes.id"), unique=True)
    ejecutada_en: Mapped[datetime] = mapped_column(_TS)
    acciones: Mapped[Decimal] = mapped_column(Numeric(asdecimal=True))
    precio: Mapped[Decimal] = mapped_column(Numeric(asdecimal=True))
    comision: Mapped[Decimal] = mapped_column(Numeric(asdecimal=True), server_default=text("0"))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()


class MovimientoCaja(Base):
    __tablename__ = "movimientos_caja"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    fecha: Mapped[date] = mapped_column(Date)
    tipo: Mapped[str] = mapped_column(Text)
    importe: Mapped[Decimal] = mapped_column(Numeric(asdecimal=True))
    ticker: Mapped[str | None] = mapped_column(Text)
    motivo: Mapped[str] = mapped_column(Text)
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()


class Split(Base):
    __tablename__ = "splits"
    __table_args__ = (UniqueConstraint("ticker", "fecha"),)
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ticker: Mapped[str] = mapped_column(Text)
    fecha: Mapped[date] = mapped_column(Date)
    ratio: Mapped[Decimal] = mapped_column(Numeric(asdecimal=True))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()


class Precio(Base):
    __tablename__ = "precios"
    ticker: Mapped[str] = mapped_column(Text, primary_key=True)
    fecha: Mapped[date] = mapped_column(Date, primary_key=True)
    apertura: Mapped[Decimal | None] = mapped_column(Numeric(asdecimal=True))
    maximo: Mapped[Decimal | None] = mapped_column(Numeric(asdecimal=True))
    minimo: Mapped[Decimal | None] = mapped_column(Numeric(asdecimal=True))
    cierre: Mapped[Decimal] = mapped_column(Numeric(asdecimal=True))
    volumen: Mapped[int | None] = mapped_column(BigInteger)
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class Despertar(Base):
    __tablename__ = "despertares"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    fecha_ny: Mapped[date] = mapped_column(Date)
    motivo: Mapped[str] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(Text, server_default=text("'pendiente'"))
    programado_el: Mapped[date] = mapped_column(Date)
    programado_en_ejecucion: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agente.ejecuciones.id"))
    cerrado_en_ejecucion: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agente.ejecuciones.id"))
    cancelado_motivo: Mapped[str | None] = mapped_column(Text)
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class ValorDiario(Base):
    __tablename__ = "valor_diario"
    fecha: Mapped[date] = mapped_column(Date, primary_key=True)
    caja: Mapped[Decimal] = mapped_column(Numeric(asdecimal=True))
    valor_posiciones: Mapped[Decimal] = mapped_column(Numeric(asdecimal=True))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class Informe(Base):
    __tablename__ = "informes"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    tipo: Mapped[str] = mapped_column(Text)
    fecha_ny: Mapped[date] = mapped_column(Date)
    decision_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("agente.decisiones.id"))
    estado: Mapped[str] = mapped_column(Text, server_default=text("'borrador'"))
    titulo: Mapped[str] = mapped_column(Text)
    cuerpo: Mapped[str] = mapped_column(Text)
    cifras: Mapped[Any] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    modelo: Mapped[str | None] = mapped_column(Text)
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class Gasto(Base):
    __tablename__ = "gasto"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    fecha_ny: Mapped[date] = mapped_column(Date)
    tipo: Mapped[str] = mapped_column(Text)
    proveedor: Mapped[str] = mapped_column(Text)
    modelo: Mapped[str | None] = mapped_column(Text)
    unidades: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    coste_usd: Mapped[Decimal] = mapped_column(Numeric(asdecimal=True))
    ejecucion_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agente.ejecuciones.id")
    )
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()


class Fundamentales(Base):
    __tablename__ = "fundamentales"
    ticker: Mapped[str] = mapped_column(Text, primary_key=True)
    fecha_ny: Mapped[date] = mapped_column(Date)
    datos: Mapped[Any] = mapped_column(JSONB)
    fuente: Mapped[str] = mapped_column(Text, server_default=text("'yahoo'"))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
    actualizado_en: Mapped[datetime | None] = _act_en()
    actualizado_por: Mapped[str | None] = _act_por()


class LlamadaModelo(Base):
    __tablename__ = "llamadas_modelo"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ejecucion_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agente.ejecuciones.id")
    )
    etapa: Mapped[str] = mapped_column(Text)
    paso: Mapped[int] = mapped_column(Integer)
    modelo: Mapped[str] = mapped_column(Text)
    enviado: Mapped[Any] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    respuesta: Mapped[str | None] = mapped_column(Text)
    razonamiento: Mapped[str | None] = mapped_column(Text)
    herramientas_pedidas: Mapped[Any] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    coste_usd: Mapped[Decimal | None] = mapped_column(Numeric(asdecimal=True))
    latencia_ms: Mapped[int | None] = mapped_column(Integer)
    ok: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    error: Mapped[str | None] = mapped_column(Text)
    ciclo: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    creado: Mapped[datetime] = _creado()
    creado_por: Mapped[str] = _creado_por()
