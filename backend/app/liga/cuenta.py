"""Cuenta: exportar mis datos (RGPD, plan §15) y baja (D17).

La exportación corre como el usuario (`db_usuario`): RLS ya decide qué ve, pero cada consulta
acota además por `auth.uid()` a mano — no basta con confiar en la política, que en varias tablas
(estrategias, recetas...) también deja ver lo publicado por otros.

La baja no tiene sesión de usuario de por medio: solo un HTTP a la API de administración de
Supabase Auth (con la clave secreta) y la auditoría. Por eso no hay `db_sistema` que vigilar aquí
(lo comprueba igualmente `test_liga_puertas`, que recorre las rutas, no los servicios)."""

from __future__ import annotations

import logging
from collections.abc import Sequence

import httpx
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session

from app.config import settings
from app.liga.procesos.comun import auditar, fabrica_sistema

logger = logging.getLogger(__name__)


def _filas(filas: Sequence[Row]) -> list[dict]:
    return [dict(f._mapping) for f in filas]


def exportar(db: Session) -> dict:
    """Exporta los datos propios (borradores, visitas y revisiones incluidos), sin ids de sesión."""
    perfil = db.execute(text(
        "select alias, oculto, creado from liga.perfiles where id = (select auth.uid())"
    )).one_or_none()
    privado = db.execute(text(
        "select tema, idioma, baja_solicitada from liga.perfiles_privados "
        "where id = (select auth.uid())"
    )).one_or_none()
    roles = db.execute(text("""
        select rol::text as rol, concedido from liga.roles_usuario
        where usuario_id = (select auth.uid()) order by rol
    """)).all()
    planes = db.execute(text("""
        select plan::text as plan, desde, hasta, origen from liga.planes_usuario
        where usuario_id = (select auth.uid()) order by desde
    """)).all()
    consentimientos = db.execute(text("""
        select documento, version, aceptado from liga.consentimientos
        where usuario_id = (select auth.uid()) order by aceptado
    """)).all()
    estrategias = db.execute(text("""
        select id::text as id, nombre, forma, dibujo, color1, color2, iniciales, visibilidad,
               declara_posiciones, destacable, estado, cada_dia_1, receta_id, creada, actualizada
        from liga.estrategias
        where dueno_id = (select auth.uid()) and tipo = 'usuario'
        order by creada
    """)).all()
    recetas = db.execute(text("""
        select r.id, r.estrategia_id::text as estrategia_id, r.idea, r.reglas, r.excluidas,
               r.catalogo_version, r.pregunta, r.peso_negocio, r.peso_precio, r.peso_deuda,
               r.peso_pronto, r.peso_pregunta, r.n_empresas, r.reparto, r.max_por_sector, r.creada
        from liga.recetas r join liga.estrategias e on e.id = r.estrategia_id
        where e.dueno_id = (select auth.uid())
        order by r.creada
    """)).all()
    inscripciones = db.execute(text("""
        select i.id, i.jornada_id, i.estrategia_id::text as estrategia_id, i.receta_id,
               i.n_pasan, i.estado, res.rentabilidad, res.puntos
        from liga.inscripciones i
        join liga.estrategias e on e.id = i.estrategia_id
        left join liga.resultados res on res.inscripcion_id = i.id
        where e.dueno_id = (select auth.uid())
        order by i.id
    """)).all()
    posiciones = db.execute(text("""
        select pos.inscripcion_id, pos.ticker, pos.peso
        from liga.posiciones pos
        join liga.inscripciones i on i.id = pos.inscripcion_id
        join liga.estrategias e on e.id = i.estrategia_id
        where e.dueno_id = (select auth.uid())
        order by pos.inscripcion_id, pos.ticker
    """)).all()
    pruebas = db.execute(text("""
        select id::text as id, receta_id, foto_id, estado, n_evaluadas, creada
        from liga.pruebas where usuario_id = (select auth.uid()) order by creada
    """)).all()
    creditos = db.execute(text("""
        select id, importe, motivo, prueba_id::text as prueba_id, lectura_id, creado
        from liga.creditos_movimientos where usuario_id = (select auth.uid()) order by creado
    """)).all()
    reportes = db.execute(text("""
        select id, tipo, objeto_id, motivo, estado, creado, resuelto
        from liga.reportes where autor_id = (select auth.uid()) order by creado
    """)).all()
    ligas_propias = db.execute(text("""
        select id::text as id, nombre, codigo, cupo, oculta, creada
        from liga.ligas_privadas where dueno_id = (select auth.uid()) order by creada
    """)).all()
    ligas_miembro = db.execute(text("""
        select liga_id::text as liga_id, unido from liga.miembros_liga
        where usuario_id = (select auth.uid()) order by unido
    """)).all()
    borradores = db.execute(text("""
        select clave, contenido, revision, creado, actualizado
        from liga.borradores where usuario_id = (select auth.uid()) order by clave
    """)).all()
    revisiones_estrategia = db.execute(text("""
        select estrategia_id::text as estrategia_id, inscripcion_id,
               resultado_inscripcion_id, revisada_en
        from liga.estrategias_revisadas
        where usuario_id = (select auth.uid()) order by estrategia_id
    """)).all()
    visitas = db.execute(text("""
        select inicio, ultima_actividad from liga.exportar_visitas()
        order by inicio, ultima_actividad
    """)).all()

    return {
        "perfil": dict(perfil._mapping) if perfil else None,
        "perfil_privado": dict(privado._mapping) if privado else None,
        "roles": _filas(roles),
        "planes": _filas(planes),
        "consentimientos": _filas(consentimientos),
        "estrategias": _filas(estrategias),
        "recetas": _filas(recetas),
        "inscripciones": _filas(inscripciones),
        "posiciones": _filas(posiciones),
        "pruebas": _filas(pruebas),
        "creditos_movimientos": _filas(creditos),
        "reportes": _filas(reportes),
        "ligas_privadas_propias": _filas(ligas_propias),
        "ligas_privadas_miembro": _filas(ligas_miembro),
        "borradores": _filas(borradores),
        "revisiones_estrategia": _filas(revisiones_estrategia),
        "visitas": _filas(visitas),
    }


def borrar_cuenta(uid: str) -> None:
    """Baja inmediata (D17): borra al usuario en Supabase Auth. Su propio `DELETE` sobre
    `auth.users` dispara la cascada de Postgres (perfil, datos privados, roles, planes,
    consentimientos, créditos, pruebas y ligas propias) y dejas las estrategias con `dueno_id`
    nulo («Estrategia retirada»): sus jornadas y resultados no dependen del usuario, así que
    siguen intactos en la clasificación histórica. Sin trabajo en 30 días: la BD no tiene jobs
    (plan §13), así que la baja es ya — no hay «desactivar y borrar en un mes» sin uno."""
    if not settings.supabase_secret_key or not settings.supabase_url:
        raise HTTPException(503, "La baja de cuenta todavía no está activada.")
    try:
        r = httpx.delete(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{uid}",
            # Solo `apikey`: las claves nuevas `sb_secret_...` no valen en
            # `Authorization: Bearer` (Supabase intenta leerla como JWT y responde «Invalid JWT»).
            headers={"apikey": settings.supabase_secret_key},
            timeout=10)
    except httpx.HTTPError as e:
        raise HTTPException(503, "No se pudo dar de baja ahora. Prueba en un momento.") from e
    if r.status_code not in (200, 204):
        logger.warning("Supabase Auth respondió %s al dar de baja una cuenta", r.status_code)
        raise HTTPException(503, "No se pudo dar de baja ahora. Prueba en un momento.")
    db = fabrica_sistema()
    try:
        auditar(db, "cuenta.baja", None, {}, uid)
        db.commit()
    finally:
        db.close()
