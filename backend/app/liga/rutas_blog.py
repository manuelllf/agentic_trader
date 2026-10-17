"""Lectura pública, suscripción y administración del blog."""

import logging
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy.orm import Session

from app import correo, correo_plantilla
from app.config import settings
from app.i18n import translate
from app.liga import acceso, blog, turnstile
from app.liga.auth import require_admin
from app.liga.db import db_anon, db_usuario

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/blog", tags=["blog"])
router_admin = APIRouter(prefix="/blog/admin", tags=["blog-admin"],
                         dependencies=[Depends(require_admin)])
_limite = acceso.LimiteFrecuencia(tope=10, ventana_s=15 * 60)
Slug = Annotated[str, Field(min_length=3, max_length=120, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]
Idioma = Literal["es", "en"]
Estado = Literal["borrador", "programado", "publicado"]


class OkOut(BaseModel):
    ok: bool


class ArticuloOut(BaseModel):
    slug: str
    titulo: str
    resumen: str
    publicado_en: datetime
    palabras: int


class LecturaOut(ArticuloOut):
    cuerpo: str


class BoletinIn(BaseModel):
    correo: str
    idioma: str = "es"
    turnstile: str | None = None


class TokenIn(BaseModel):
    token: str = Field(min_length=1, max_length=200)


class CrearIn(BaseModel):
    slug: Slug


class IdOut(BaseModel):
    id: int


class TextoIn(BaseModel):
    titulo: str = Field(max_length=160)
    resumen: str = Field(max_length=160)
    cuerpo: str = Field(max_length=40000)


class EditarIn(BaseModel):
    slug: Slug | None = None
    es: TextoIn | None = None
    en: TextoIn | None = None


class PublicarIn(BaseModel):
    avisar_boletin: bool = False


class ProgramarIn(PublicarIn):
    programado_para: AwareDatetime


class EnvioIn(BaseModel):
    idioma: Idioma


class DestinatariosOut(BaseModel):
    destinatarios: int


class AdminArticuloOut(BaseModel):
    id: int
    slug: str
    estado: Estado
    programado_para: datetime | None
    publicado_en: datetime | None
    titulo_es: str
    titulo_en: str
    completo_es: bool
    completo_en: bool


class DetalleOut(BaseModel):
    avisar_boletin: bool
    id: int
    slug: str
    estado: Estado
    programado_para: datetime | None
    publicado_en: datetime | None
    creado: datetime
    creado_por: UUID | None
    actualizado_en: datetime | None
    actualizado_por: UUID | None
    textos: dict[Idioma, TextoIn]


class RecuentoOut(BaseModel):
    estado: str
    idioma: Idioma
    total: int


class EnvioOut(BaseModel):
    id: int
    articulo_id: int
    idioma: Idioma
    estado: str
    creado: datetime
    terminado_en: datetime | None
    pendiente: int
    aceptada: int
    fallida: int


class BoletinOut(BaseModel):
    suscriptores: list[RecuentoOut]
    envios: list[EnvioOut]


class SuscriptorOut(BaseModel):
    correo: str
    idioma: Idioma
    estado: str
    creado: datetime
    confirmado_en: datetime | None
    baja_en: datetime | None
    actualizado_en: datetime | None


def _correo_confirmacion(destino, idioma, alta, baja):
    def t(clave):
        return translate(clave, locale=idioma)

    asunto = t("blog_correo_confirmar_asunto")
    prefijo = "/en" if idioma == "en" else ""
    texto, html = correo_plantilla.render(
        idioma=idioma, asunto=asunto, intro=t("blog_correo_confirmar_intro"),
        enlace_texto=t("blog_correo_confirmar_enlace"),
        ruta=prefijo + "/blog/boletin/confirmar?token=" + alta,
        pie=t("blog_correo_confirmar_pie"), ajustes_texto=t("blog_correo_baja_enlace"),
        ajustes_ruta=prefijo + "/blog/boletin/baja?token=" + baja, legal_texto=t("correo_legal"))
    if not correo.enviar(destino, asunto, texto, html):
        logger.warning("No se pudo enviar la confirmación del boletín")


@router.get("/articulos", response_model=list[ArticuloOut])
def articulos(idioma: str = "es", db: Session = Depends(db_anon)):
    return blog.listar_publicados(db, idioma)


@router.get("/articulos/{slug}", response_model=LecturaOut)
def articulo(slug: str, idioma: str = "es", db: Session = Depends(db_anon)):
    return blog.leer_publicado(db, slug, idioma)


@router.post("/boletin", status_code=202, response_model=OkOut)
def alta(body: BoletinIn, request: Request, db: Session = Depends(db_anon)):
    if not settings.turnstile_secret_key:
        raise HTTPException(503, translate("api_error_blog_boletin_no_disponible"))
    turnstile.verificar(body.turnstile, request.client.host if request.client else None)
    if not _limite.permitido(acceso.ip_cliente(request)):
        raise HTTPException(429, translate("api_error_demasiados_intentos_espera_unos_minutos"))
    enviar, token_alta, token_baja = blog.alta_boletin(db, body.correo, body.idioma)
    if enviar:
        _correo_confirmacion(blog.normalizar_correo(body.correo), body.idioma,
                             token_alta, token_baja)
    return {"ok": True}


@router.post("/boletin/confirmar", response_model=OkOut)
def confirmar(body: TokenIn, db: Session = Depends(db_anon)):
    return {"ok": blog.confirmar_boletin(db, body.token)}


@router.post("/boletin/baja", response_model=OkOut)
def baja(body: TokenIn, db: Session = Depends(db_anon)):
    return {"ok": blog.dar_de_baja(db, body.token)}


@router_admin.get("/articulos", response_model=list[AdminArticuloOut])
def admin_articulos(db: Session = Depends(db_usuario)):
    return blog.listar_admin(db)


@router_admin.post("/articulos", status_code=201, response_model=IdOut)
def crear(body: CrearIn, db: Session = Depends(db_usuario)):
    return {"id": blog.crear_articulo(db, body.slug)}


@router_admin.get("/articulos/{id}", response_model=DetalleOut)
def detalle(id: int, db: Session = Depends(db_usuario)):
    return blog.detalle_admin(db, id)


@router_admin.put("/articulos/{id}", response_model=DetalleOut)
def editar(id: int, body: EditarIn, db: Session = Depends(db_usuario)):
    textos = {idioma: getattr(body, idioma).model_dump() for idioma in blog.IDIOMAS
              if getattr(body, idioma) is not None}
    return blog.editar(db, id, body.slug, textos)


@router_admin.post("/articulos/{id}/publicar", response_model=DetalleOut)
def publicar(id: int, body: PublicarIn | None = None, db: Session = Depends(db_usuario)):
    return blog.publicar(db, id, body.avisar_boletin if body else False)


@router_admin.post("/articulos/{id}/programar", response_model=DetalleOut)
def programar(id: int, body: ProgramarIn, db: Session = Depends(db_usuario)):
    return blog.programar(db, id, body.programado_para, body.avisar_boletin)


@router_admin.post("/articulos/{id}/despublicar", response_model=DetalleOut)
def despublicar(id: int, db: Session = Depends(db_usuario)):
    return blog.despublicar(db, id)


@router_admin.post("/articulos/{id}/boletin", response_model=DestinatariosOut)
def enviar_boletin(id: int, body: EnvioIn, db: Session = Depends(db_usuario)):
    return {"destinatarios": blog.lanzar_boletin(db, id, body.idioma)}


@router_admin.post("/boletin/prueba", response_model=OkOut)
def prueba_boletin(request: Request, ident=Depends(require_admin),
                   db: Session = Depends(db_usuario)):
    if not _limite.permitido(acceso.ip_cliente(request)):
        raise HTTPException(429, translate("api_error_demasiados_intentos_espera_unos_minutos"))
    destino = ident.claims.get("email")
    if not destino:
        blog.error("sin_correo_admin")
    articulo = blog.correo_prueba(db, destino)
    if articulo is None:
        blog.error("sin_articulo_para_prueba")
    texto, html = correo_plantilla.render(
        idioma="es", asunto=articulo["titulo"], intro=articulo["resumen"],
        enlace_texto=translate("blog_correo_articulo_enlace", "es"),
        ruta="/blog/" + articulo["slug"],
        pie=translate("blog_correo_articulo_pie", "es"),
        ajustes_texto=translate("blog_correo_baja_enlace", "es"), ajustes_ruta="/blog",
        legal_texto=translate("correo_legal", "es"))
    if not correo.enviar(destino, articulo["titulo"], texto, html):
        logger.warning("No se pudo enviar la prueba del boletín")
    return {"ok": True}


@router_admin.get("/boletin", response_model=BoletinOut)
def boletin(db: Session = Depends(db_usuario)):
    return blog.resumen_boletin(db)


@router_admin.get("/suscriptores", response_model=list[SuscriptorOut])
def suscriptores(estado: Literal["pendiente", "confirmado", "baja"] | None = None,
                 idioma: Idioma | None = None, db: Session = Depends(db_usuario)):
    return blog.listar_suscriptores(db, estado, idioma)
