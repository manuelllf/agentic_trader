"""Resúmenes descriptivos de la estrategia, con cola y cupo compartidos en auditoría."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from html import escape
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from sqlalchemy import text

from app import correo, correo_plantilla
from app.i18n import translate
from app.liga import avisos, comparativa, gestion, rutas_ligas
from app.liga.models import Jornada
from app.liga.procesos import diario
from app.liga.procesos.comun import auditar, fabrica_sistema, sesion

logger = logging.getLogger(__name__)
TZ_MADRID = ZoneInfo("Europe/Madrid")
_BLOQUEO_MENSUAL = "select pg_advisory_xact_lock(hashtextextended('liga.resumen.mensual', 0))"


class _PerfilResumen:
    """Reutiliza la dirección de avisos con la preferencia independiente del resumen."""

    def __init__(self, db, forzar=False):
        self.db = db
        self.forzar = forzar

    def execute(self, consulta, parametros):
        if self.forzar:
            consulta = text("""
                select p.idioma, true as avisos_correo, p.correo_avisos, u.email
                from liga.perfiles_privados p left join auth.users u on u.id = p.id
                where p.id = cast(:u as uuid)
            """)
        else:
            consulta = text("""
                select p.idioma, p.resumen_correo as avisos_correo, p.correo_avisos, u.email
                from liga.perfiles_privados p left join auth.users u on u.id = p.id
                where p.id = cast(:u as uuid)
            """)
        return self.db.execute(consulta, parametros)


def candidatos(db) -> list[dict]:
    ids = db.execute(text("""
        select p.id::text from liga.perfiles_privados p
        where p.resumen_correo and p.baja_solicitada is null
          and exists (select 1 from liga.roles_usuario r
                      where r.usuario_id = p.id and r.rol = 'usuario')
        order by p.id
    """)).scalars().all()
    salida = []
    for uid in ids:
        idioma, destino = avisos._perfil(_PerfilResumen(db), uid)
        if destino:
            salida.append({"usuario_id": uid, "idioma": idioma, "destino": destino})
    return salida


def contenido(db, usuario_id, tipo, jornada_id) -> dict:
    if tipo not in ("semanal", "mensual"):
        raise ValueError(tipo)
    j = db.get(Jornada, jornada_id)
    fila = db.execute(text("""
        select e.id::text as eid, e.nombre, i.id as iid,
               r.rentabilidad, j.sp_rentabilidad as sp
        from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id
        join liga.jornadas j on j.id = i.jornada_id
        left join liga.resultados r on r.inscripcion_id = i.id
        where e.dueno_id = cast(:u as uuid) and i.jornada_id = :j
          and i.estado in ('formada', 'cerrada')
        order by e.creada, e.id limit 1
    """), {"u": usuario_id, "j": jornada_id}).one_or_none()
    salida = {"numero": j.numero, "estrategia": fila.nombre if fila else None,
              "rentabilidad": fila.rentabilidad if fila else None,
              "sp": j.sp_rentabilidad, "puesto_general": None, "ligas": [],
              "entran": [], "salen": [], "provisional": tipo == "semanal"}
    vivo = diario.vivo(j.id) if tipo == "semanal" and j.estado == "formada" else None
    if fila and vivo:
        valor = vivo["por_inscripcion"].get(fila.iid, {}).get("rentabilidad")
        if valor is None:
            valor = vivo["por_inscripcion"].get(str(fila.iid), {}).get("rentabilidad")
        if valor is not None:
            salida.update(rentabilidad=valor, sp=vivo.get("sp"))
    if fila and salida["rentabilidad"] is None and tipo == "semanal":
        cerrado = db.execute(text("""
            select r.rentabilidad, j.sp_rentabilidad as sp
            from liga.resultados r join liga.inscripciones i on i.id = r.inscripcion_id
            join liga.jornadas j on j.id = i.jornada_id
            where i.estrategia_id = cast(:e as uuid) and j.estado = 'cerrada'
              and j.dia_base <= :d order by j.dia_base desc limit 1
        """), {"e": fila.eid, "d": j.dia_base}).one_or_none()
        if cerrado:
            salida.update(rentabilidad=cerrado.rentabilidad, sp=cerrado.sp)
    vivas = (comparativa.clasificacion_viva(db, j.temporada_id, vivo, j)
             if vivo and vivo.get("sp") is not None
             and gestion._ajuste_booleano("liga.clasificacion_viva", True) else {})
    oficiales = db.execute(text("""
        select e.id::text as eid, e.creada, c.puntos, c.dif_sp
        from liga.v_clasificacion c join liga.estrategias e on e.id = c.estrategia_id
        where c.temporada_id = :t
    """), {"t": j.temporada_id}).all()
    ranking = {f.eid: SimpleNamespace(**f._mapping) for f in oficiales}
    for eid, v in vivas.items():
        if eid not in ranking:
            creada = db.execute(
                text("select creada from liga.estrategias where id = cast(:e as uuid)"),
                {"e": eid}).scalar_one()
            ranking[eid] = SimpleNamespace(eid=eid, creada=creada)
        ranking[eid].puntos, ranking[eid].dif_sp = v.puntos, v.dif_sp
    orden = sorted(ranking.values(), key=lambda f: (-f.puntos, -f.dif_sp, f.creada, f.eid))
    if fila:
        salida["puesto_general"] = next((n for n, f in enumerate(orden, 1)
                                         if f.eid == fila.eid), None)
        ids = db.execute(text("""
            select i.id from liga.inscripciones i join liga.jornadas j on j.id = i.jornada_id
            where i.estrategia_id = cast(:e as uuid) and i.estado in ('formada', 'cerrada')
              and j.dia_base <= :d order by j.dia_base desc, j.id desc limit 2
        """), {"e": fila.eid, "d": j.dia_base}).scalars().all()
        if len(ids) == 2:
            posiciones = [set(db.execute(text("select ticker from liga.posiciones "
                                              "where inscripcion_id = :i"),
                                        {"i": iid}).scalars().all()) for iid in ids]
            salida["entran"] = sorted(posiciones[0] - posiciones[1])
            salida["salen"] = sorted(posiciones[1] - posiciones[0])
    ligas = db.execute(text("""
        select l.id, l.nombre from liga.ligas_privadas l
        join liga.miembros_liga m on m.liga_id = l.id
        where m.usuario_id = cast(:u as uuid) order by l.id
    """), {"u": usuario_id}).all()
    for liga in ligas:
        miembros = rutas_ligas._aplicar_clasificacion_viva(
            rutas_ligas._miembros(db, [liga.id], j.temporada_id, j.id), vivas)
        puesto = next((n for n, m in enumerate(miembros, 1)
                       if m.usuario_id == usuario_id and m.estrategia_id), None)
        salida["ligas"].append({"nombre": liga.nombre, "puesto": puesto})
    return salida


def _correo(candidato, datos, tipo):
    idioma = candidato["idioma"]
    def t(clave, **valores):
        return translate(f"correo_resumen_{clave}", idioma, **valores)
    ninguna = t("ninguna")
    def cifra(valor):
        return ninguna if valor is None else f"{valor:.2f}%"
    filas = [(t("estrategia"), datos["estrategia"] or ninguna),
             (t("rentabilidad"), cifra(datos["rentabilidad"])),
             (t("sp"), cifra(datos["sp"])),
             (t("puesto_general"), str(datos["puesto_general"] or ninguna))]
    filas += [(t("puesto_liga", nombre=linea["nombre"]), str(linea["puesto"] or ninguna))
              for linea in datos["ligas"]]
    filas += [(t(k), ", ".join(datos[k]) or ninguna) for k in ("entran", "salen")]
    asunto = t(f"{tipo}_asunto", numero=datos["numero"])
    cuerpo = t("intro") + "\n\n" + "\n".join(f"{k}: {v}" for k, v in filas)
    texto, html = correo_plantilla.render(
        idioma=idioma, asunto=asunto, intro=cuerpo,
        meta=t("provisional") if datos["provisional"] else "",
        enlace_texto=translate("correo_ver", idioma), ruta="/mias", pie=t("baja"),
        ajustes_texto=translate("correo_ajustes", idioma),
        legal_texto=translate("correo_legal", idioma))
    html = html.replace(escape(cuerpo), escape(cuerpo).replace("\n", "<br>"))
    return correo.enviar(candidato["destino"], asunto, texto, html)


def _lote(db, tipo, jornada_id, limite, cuentas, prueba=False):
    resultado = {"enviados": 0, "pendientes": 0, "omitidos": 0}
    try:
        db.execute(text("select pg_advisory_xact_lock(hashtextextended('liga.resumenes', 0))"))
        usados = db.execute(text("""
            select count(*) from liga.auditoria
            where accion in ('resumen.enviado', 'resumen.prueba.enviado')
              and (creada at time zone 'Europe/Madrid')::date =
                  (now() at time zone 'Europe/Madrid')::date
        """)).scalar_one()
        cupo = max(0, min(limite, 80 - usados))
        for cuenta in cuentas:
            objeto = f"{tipo}:{jornada_id}:{cuenta['usuario_id']}"
            if not prueba and db.execute(text("select 1 from liga.auditoria "
                                              "where accion = 'resumen.enviado' and objeto = :o"),
                                        {"o": objeto}).first():
                resultado["omitidos"] += 1
                continue
            if resultado["enviados"] >= cupo:
                resultado["pendientes"] += 1
                continue
            try:
                with db.begin_nested():
                    if not _correo(
                        cuenta, contenido(db, cuenta["usuario_id"], tipo, jornada_id), tipo):
                        raise RuntimeError("Correo no aceptado")
                    auditar(db, "resumen.prueba.enviado" if prueba else "resumen.enviado",
                            objeto, {}, cuenta["usuario_id"] if prueba else None)
                    db.flush()
                resultado["enviados"] += 1
            except Exception:
                logger.exception("No se pudo enviar el resumen a una cuenta")
                resultado["pendientes"] += 1
        db.commit()
    except Exception:
        logger.exception("Fallo en el lote de resúmenes")
        db.rollback()
        resultado["pendientes"] = len(cuentas) - resultado["enviados"] - resultado["omitidos"]
    return resultado


def enviar_lote(db, tipo, jornada_id, limite=80) -> dict:
    try:
        return _lote(db, tipo, jornada_id, limite, candidatos(db))
    except Exception:
        logger.exception("No se pudieron obtener los destinatarios")
        return {"enviados": 0, "pendientes": 0, "omitidos": 0}


def _jornada_actual(db):
    return db.execute(text("""
        select j.id from liga.jornadas j join liga.temporadas t on t.id = j.temporada_id
        where j.estado = 'formada' and t.estado = 'en_juego'
          and j.dia_inicio <= (now() at time zone 'Europe/Madrid')::date
        order by j.dia_base desc limit 1
    """)).scalar()


def job_semanal(fabrica=fabrica_sistema):
    try:
        with sesion(fabrica) as db:
            jid = _jornada_actual(db)
            if jid is not None:
                semana = datetime.now(TZ_MADRID).date()
                semana -= timedelta(days=semana.weekday())
                auditar(db, "resumen.semanal.lanzado", f"jornada:{jid}",
                        {"semana": semana.isoformat(), "jornada_id": jid}, None)
                db.commit()
                return enviar_lote(db, "semanal", jid)
    except Exception:
        logger.exception("Fallo en el resumen semanal")


def job_pendientes(fabrica=fabrica_sistema):
    try:
        with sesion(fabrica) as db:
            semana = datetime.now(TZ_MADRID).date()
            semana -= timedelta(days=semana.weekday())
            ids = db.execute(text("""
                select distinct detalle->>'jornada_id' from liga.auditoria
                where accion = 'resumen.semanal.lanzado' and detalle->>'semana' = :s
            """), {"s": semana.isoformat()}).scalars().all()
            for jid in ids:
                enviar_lote(db, "semanal", int(jid))
            mensuales = db.execute(text("""
                select distinct objeto from liga.auditoria
                where accion = 'resumen.mensual.lanzado'
            """)).scalars().all()
            for objeto in mensuales:
                enviar_lote(db, "mensual", int(objeto.split(":")[1]))
    except Exception:
        logger.exception("Fallo en los resúmenes pendientes")


def job_mensual(fabrica=fabrica_sistema):
    try:
        with sesion(fabrica) as db:
            db.execute(text(_BLOQUEO_MENSUAL))
            jid = db.execute(text("""
                select j.id from liga.jornadas j where j.estado = 'cerrada'
                  and not exists (select 1 from liga.auditoria a
                      where a.accion = 'resumen.mensual.lanzado' and a.objeto = 'jornada:' || j.id)
                order by j.dia_fin desc, j.id desc limit 1
            """)).scalar()
            if jid is not None:
                auditar(db, "resumen.mensual.lanzado", f"jornada:{jid}", {}, None)
                db.commit()
                return enviar_lote(db, "mensual", jid)
    except Exception:
        logger.exception("Fallo en el resumen mensual")


def probar(usuario_id, tipo, fabrica=fabrica_sistema):
    try:
        with sesion(fabrica) as db:
            jid = (_jornada_actual(db) if tipo == "semanal" else db.execute(text(
                "select id from liga.jornadas where estado = 'cerrada' "
                "order by dia_fin desc, id desc limit 1")).scalar())
            if jid is None:
                return {"enviados": 0}
            idioma, destino = avisos._perfil(_PerfilResumen(db, forzar=True), usuario_id)
            if not destino:
                return {"enviados": 0}
            cuenta = {"usuario_id": usuario_id, "idioma": idioma, "destino": destino}
            return {"enviados": _lote(db, tipo, jid, 1, [cuenta], prueba=True)["enviados"]}
    except Exception:
        logger.exception("Fallo en la prueba del resumen")
        return {"enviados": 0}
