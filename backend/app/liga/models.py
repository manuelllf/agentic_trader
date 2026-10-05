"""Modelos ORM del esquema `liga` (backend/sql/liga/). La BD manda: esto la refleja.

Metadata propia: el `create_all` de SQLite (tests e `init_db`) no sabe de esquemas y nunca debe
tocar estas tablas. Las FK hacia `auth.users` y `public` viven solo en el SQL; los valores por
defecto (`auth.uid()`, `now()`…) los pone la BD.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    FetchedValue,
    ForeignKey,
    Identity,
    Integer,
    MetaData,
    Numeric,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

ESQUEMA = "liga"

Rol = ENUM("usuario", "moderador", "admin", name="rol", schema=ESQUEMA, create_type=False)
Permiso = ENUM("liga.jugar", "moderacion.revisar", "admin.liga", "admin.salas",
               name="permiso", schema=ESQUEMA, create_type=False)
Plan = ENUM("gratis", "pro", name="plan", schema=ESQUEMA, create_type=False)

TSTZ = DateTime(timezone=True)
DB = FetchedValue()  # valor por defecto de la BD


class LigaBase(DeclarativeBase):
    metadata = MetaData(schema=ESQUEMA)


# ---- Identidad y RBAC ----------------------------------------------------------------------------

class Perfil(LigaBase):
    __tablename__ = "perfiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    alias: Mapped[str] = mapped_column(Text)
    oculto: Mapped[bool] = mapped_column(Boolean, server_default=DB)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class PerfilPrivado(LigaBase):
    __tablename__ = "perfiles_privados"

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    tema: Mapped[str] = mapped_column(Text, server_default=DB)
    idioma: Mapped[str | None] = mapped_column(Text)
    baja_solicitada: Mapped[datetime | None] = mapped_column(TSTZ)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class RolUsuario(LigaBase):
    __tablename__ = "roles_usuario"

    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    rol: Mapped[str] = mapped_column(Rol, primary_key=True)
    concedido: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)


class PermisoRol(LigaBase):
    __tablename__ = "permisos_rol"

    rol: Mapped[str] = mapped_column(Rol, primary_key=True)
    permiso: Mapped[str] = mapped_column(Permiso, primary_key=True)


class PlanUsuario(LigaBase):
    """Pro con fechas; sin pasarela lo concede el admin."""

    __tablename__ = "planes_usuario"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID)
    plan: Mapped[str] = mapped_column(Plan, server_default=DB)
    desde: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    hasta: Mapped[datetime | None] = mapped_column(TSTZ)
    origen: Mapped[str] = mapped_column(Text)
    concedido_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class Consentimiento(LigaBase):
    __tablename__ = "consentimientos"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID, server_default=DB)
    documento: Mapped[str] = mapped_column(Text)
    version: Mapped[str] = mapped_column(Text)
    aceptado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)


# ---- Competición -------------------------------------------------------------------------------

class Temporada(LigaBase):
    __tablename__ = "temporadas"

    id: Mapped[int] = mapped_column(SmallInteger, Identity(always=True), primary_key=True)
    nombre: Mapped[str] = mapped_column(Text)
    n_jornadas: Mapped[int] = mapped_column(SmallInteger)
    cuenta: Mapped[bool] = mapped_column(Boolean)
    estado: Mapped[str] = mapped_column(Text, server_default=DB)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class Jornada(LigaBase):
    __tablename__ = "jornadas"

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    temporada_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("liga.temporadas.id"))
    numero: Mapped[int] = mapped_column(SmallInteger)
    dia_base: Mapped[date] = mapped_column(Date)
    dia_inicio: Mapped[date] = mapped_column(Date)
    dia_fin: Mapped[date] = mapped_column(Date)
    cierre_inscripcion: Mapped[datetime] = mapped_column(TSTZ)
    estado: Mapped[str] = mapped_column(Text, server_default=DB)
    foto_id: Mapped[int | None] = mapped_column(BigInteger)
    scan_run_id: Mapped[int | None] = mapped_column(BigInteger)
    sp_rentabilidad: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class Estrategia(LigaBase):
    __tablename__ = "estrategias"

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, server_default=DB)
    dueno_id: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    tipo: Mapped[str] = mapped_column(Text, server_default=DB)
    casa_clave: Mapped[str | None] = mapped_column(Text)
    nombre: Mapped[str] = mapped_column(Text)
    forma: Mapped[str] = mapped_column(Text)
    dibujo: Mapped[str] = mapped_column(Text)
    color1: Mapped[str] = mapped_column(Text)
    color2: Mapped[str] = mapped_column(Text)
    iniciales: Mapped[str | None] = mapped_column(Text)
    visibilidad: Mapped[str] = mapped_column(Text, server_default=DB)
    declara_posiciones: Mapped[str | None] = mapped_column(Text)
    destacable: Mapped[bool] = mapped_column(Boolean, server_default=DB)
    estado: Mapped[str] = mapped_column(Text, server_default=DB)
    cada_dia_1: Mapped[str] = mapped_column(Text, server_default=DB)
    oculta: Mapped[bool] = mapped_column(Boolean, server_default=DB)
    receta_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("liga.recetas.id", use_alter=True))
    creada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    actualizada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class Receta(LigaBase):
    """Cada fila es una versión, de solo añadir: editar es insertar y mover `receta_id`."""

    __tablename__ = "recetas"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    estrategia_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("liga.estrategias.id"))
    idea: Mapped[str | None] = mapped_column(Text)
    reglas: Mapped[list] = mapped_column(JSONB, server_default=DB)
    excluidas: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=DB)
    catalogo_version: Mapped[int] = mapped_column(SmallInteger)
    pregunta: Mapped[str | None] = mapped_column(Text)
    peso_negocio: Mapped[int] = mapped_column(SmallInteger)
    peso_precio: Mapped[int] = mapped_column(SmallInteger)
    peso_deuda: Mapped[int] = mapped_column(SmallInteger)
    peso_pronto: Mapped[int] = mapped_column(SmallInteger)
    peso_pregunta: Mapped[int] = mapped_column(SmallInteger)
    n_empresas: Mapped[int] = mapped_column(SmallInteger)
    reparto: Mapped[str] = mapped_column(Text)
    max_por_sector: Mapped[int] = mapped_column(SmallInteger)
    creada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)


class Inscripcion(LigaBase):
    """`receta_id` nulo solo en los equipos de la casa (lo guarda `liga.inscripciones_guarda`)."""

    __tablename__ = "inscripciones"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    jornada_id: Mapped[int] = mapped_column(Integer, ForeignKey("liga.jornadas.id"))
    estrategia_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("liga.estrategias.id"))
    receta_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("liga.recetas.id"))
    n_pasan: Mapped[int | None] = mapped_column(Integer)
    estado: Mapped[str] = mapped_column(Text, server_default=DB)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class Posicion(LigaBase):
    """Solo ticker y peso: el resto sale de la foto y de `public.precio_cierre`."""

    __tablename__ = "posiciones"

    inscripcion_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("liga.inscripciones.id"), primary_key=True)
    ticker: Mapped[str] = mapped_column(String(16), primary_key=True)
    peso: Mapped[Decimal] = mapped_column(Numeric(10, 4))


class Resultado(LigaBase):
    """Registro oficial del cierre, de solo añadir."""

    __tablename__ = "resultados"

    inscripcion_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("liga.inscripciones.id"), primary_key=True)
    rentabilidad: Mapped[Decimal] = mapped_column(Numeric(10, 4))
    puntos: Mapped[int] = mapped_column(SmallInteger)


# ---- Ligas privadas ------------------------------------------------------------------------------

class LigaPrivada(LigaBase):
    __tablename__ = "ligas_privadas"

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, server_default=DB)
    dueno_id: Mapped[uuid.UUID] = mapped_column(UUID, server_default=DB)
    nombre: Mapped[str] = mapped_column(Text)
    codigo: Mapped[str] = mapped_column(Text)
    cupo: Mapped[int] = mapped_column(SmallInteger, server_default=DB)
    oculta: Mapped[bool] = mapped_column(Boolean, server_default=DB)
    creada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class MiembroLiga(LigaBase):
    __tablename__ = "miembros_liga"

    liga_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("liga.ligas_privadas.id"), primary_key=True)
    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    unido: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)


# ---- IA y créditos -------------------------------------------------------------------------------

class Prueba(LigaBase):
    __tablename__ = "pruebas"

    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, server_default=DB)
    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID)
    receta_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("liga.recetas.id"))
    foto_id: Mapped[int] = mapped_column(BigInteger)
    scan_run_id: Mapped[int | None] = mapped_column(BigInteger)
    estado: Mapped[str] = mapped_column(Text, server_default=DB)
    n_evaluadas: Mapped[int] = mapped_column(Integer, server_default=DB)
    idempotencia: Mapped[str] = mapped_column(Text)
    creada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class FormacionDegradada(LigaBase):
    """Inscripción formada sin la pregunta propia (`motivo`: sin_ia, tope, incompleta o tiempo)."""

    __tablename__ = "formaciones_degradadas"

    inscripcion_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("liga.inscripciones.id"), primary_key=True)
    motivo: Mapped[str] = mapped_column(Text)
    creada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)


class RespuestaIA(LigaBase):
    """Caché compartida de la pregunta propia por pregunta normalizada, empresa y foto."""

    __tablename__ = "respuestas_ia"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    pregunta_hash: Mapped[str] = mapped_column(Text)
    ticker: Mapped[str] = mapped_column(String(16))
    foto_id: Mapped[int] = mapped_column(BigInteger)
    si: Mapped[bool] = mapped_column(Boolean)
    seguridad: Mapped[str] = mapped_column(Text)
    llm_call_id: Mapped[int | None] = mapped_column(BigInteger)
    creada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)


class Lectura(LigaBase):
    __tablename__ = "lecturas"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ticker: Mapped[str] = mapped_column(String(16))
    foto_id: Mapped[int] = mapped_column(BigInteger)
    texto: Mapped[str] = mapped_column(Text)
    fuentes: Mapped[list] = mapped_column(JSONB, server_default=DB)
    llm_call_id: Mapped[int | None] = mapped_column(BigInteger)
    creada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)


class MovimientoCredito(LigaBase):
    """Libro de créditos en euros, de solo añadir; se escribe con `liga.cargar_creditos`."""

    __tablename__ = "creditos_movimientos"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID)
    importe: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    motivo: Mapped[str] = mapped_column(Text)
    prueba_id: Mapped[uuid.UUID | None] = mapped_column(UUID)
    lectura_id: Mapped[int | None] = mapped_column(BigInteger)
    idempotencia: Mapped[str] = mapped_column(Text)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


# ---- Operación -----------------------------------------------------------------------------------

class Ajuste(LigaBase):
    __tablename__ = "ajustes"

    clave: Mapped[str] = mapped_column(Text, primary_key=True)
    valor: Mapped[dict] = mapped_column(JSONB)
    actualizado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)


class Auditoria(LigaBase):
    __tablename__ = "auditoria"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID)
    accion: Mapped[str] = mapped_column(Text)
    objeto: Mapped[str | None] = mapped_column(Text)
    detalle: Mapped[dict] = mapped_column(JSONB, server_default=DB)
    creada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)


class Borrador(LigaBase):
    __tablename__ = "borradores"

    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    clave: Mapped[str] = mapped_column(Text, primary_key=True)
    contenido: Mapped[dict] = mapped_column(JSONB)
    revision: Mapped[int] = mapped_column(BigInteger, server_default=DB)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    actualizado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)


class Visita(LigaBase):
    __tablename__ = "visitas"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID)
    inicio: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    ultima_actividad: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)


class EstrategiaRevisada(LigaBase):
    __tablename__ = "estrategias_revisadas"

    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, server_default=DB)
    estrategia_id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    inscripcion_id: Mapped[int | None] = mapped_column(BigInteger)
    resultado_inscripcion_id: Mapped[int | None] = mapped_column(BigInteger)
    revisada_en: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creada: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creada_por: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class OmegaOperacion(LigaBase):
    """Una operación (compra→venta) de un hueco virtual de Omega en la liga. `salida_dia` nulo =
    sigue abierta (se actualiza la misma fila el día que cierra, no nace una nueva)."""

    __tablename__ = "omega_operaciones"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    jornada_id: Mapped[int] = mapped_column(Integer, ForeignKey("liga.jornadas.id"))
    numero: Mapped[int] = mapped_column(SmallInteger)
    senal_id: Mapped[int | None] = mapped_column(BigInteger)
    ticker: Mapped[str] = mapped_column(Text)
    entrada_dia: Mapped[date] = mapped_column(Date)
    entrada_precio: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    market_cap_usd: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    salida_dia: Mapped[date | None] = mapped_column(Date)
    salida_precio: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    motivo: Mapped[str | None] = mapped_column(Text)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class AvisoError(LigaBase):
    """Un error que alguien reportó desde la web, con el código que vio. Solo admin."""

    __tablename__ = "avisos_error"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    codigo: Mapped[str | None] = mapped_column(Text)
    usuario_id: Mapped[uuid.UUID | None] = mapped_column(UUID)
    pantalla: Mapped[str] = mapped_column(Text)
    mensaje: Mapped[str] = mapped_column(Text)
    nota: Mapped[str | None] = mapped_column(Text)
    contexto: Mapped[dict] = mapped_column(JSONB, server_default=DB)
    estado: Mapped[str] = mapped_column(Text, server_default=DB)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    creado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)
    actualizado_en: Mapped[datetime | None] = mapped_column(TSTZ)
    actualizado_por: Mapped[uuid.UUID | None] = mapped_column(UUID)


class Reporte(LigaBase):
    __tablename__ = "reportes"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    autor_id: Mapped[uuid.UUID | None] = mapped_column(UUID, server_default=DB)
    tipo: Mapped[str] = mapped_column(Text)
    objeto_id: Mapped[str] = mapped_column(Text)
    motivo: Mapped[str] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(Text, server_default=DB)
    creado: Mapped[datetime] = mapped_column(TSTZ, server_default=DB)
    resuelto_por: Mapped[uuid.UUID | None] = mapped_column(UUID)
    resuelto: Mapped[datetime | None] = mapped_column(TSTZ)
