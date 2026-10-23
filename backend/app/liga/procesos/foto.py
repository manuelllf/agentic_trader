"""Designar la foto de la jornada (plan §8): `jornadas.foto_id` (una `public.foto` completa) y
`jornadas.scan_run_id` (el escaneo de decisión que puso las 4 notas de Jev sobre ella).

Cada semana juega con el último escaneo mensual designado; el escaneo del fin de mes se
designa en todas las semanas que vienen.

Plan B: si esa foto no tiene escaneo de decisión con notas, la jornada usa la foto nueva y las
notas del escaneo de decisión anterior. No hace falta guardarlo aparte: es plan B cuando el
escaneo apunta a otra foto que la jornada (`es_plan_b`), y así lo puede decir la UI.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.models import Jornada
from app.liga.motor import calendario
from app.liga.procesos import datos
from app.liga.procesos.comun import (
    TZ_BOLSA,
    ErrorProceso,
    Fabrica,
    NoEncontrado,
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


@dataclass(frozen=True)
class Designacion:
    foto_id: int
    scan_run_id: int
    plan_b: bool
    n_empresas: int
    n_notas: int
    avisos: tuple[str, ...]


def es_plan_b(db: Session, j: Jornada) -> bool | None:
    """None si aún no tiene escaneo."""
    if j.scan_run_id is None:
        return None
    foto_escaneo = db.execute(text("select foto_id from scan_runs where id = :s"),
                              {"s": j.scan_run_id}).scalar()
    return foto_escaneo != j.foto_id


def _foto(db: Session, foto_id: int | None):  # noqa: ANN202 — fila de public.foto
    if foto_id is None:
        fila = db.execute(text(
            "select id, inicio, fin, estado from foto where estado = 'completa' "
            "order by fin desc, id desc limit 1")).one_or_none()
        if fila is None:
            raise ErrorProceso("No hay ninguna foto completa. Lánzala desde Alpha.")
        return fila
    fila = db.execute(text("select id, inicio, fin, estado from foto where id = :f"),
                      {"f": foto_id}).one_or_none()
    if fila is None:
        raise NoEncontrado(f"No existe la foto {foto_id}.")
    if fila.estado != "completa":
        raise ErrorProceso(f"La foto {foto_id} está «{fila.estado}»: solo vale una completa.")
    return fila


_ESCANEOS = """
    select r.id, r.scan_at, r.foto_id from scan_runs r
    where r.decide and r.error is null {filtro}
      and exists (select 1 from scan_audit a
                  where a.scan_run_id = r.id and a.jev_fundamentals is not null)
    order by r.scan_at desc, r.id desc limit 1
"""


_ESCANEO_CON_NOTAS = """
    select r.id, r.scan_at from scan_runs r
    where r.error is null
      and exists (select 1 from scan_audit a
                  where a.scan_run_id = r.id and a.jev_fundamentals is not null)
    order by r.scan_at desc, r.id desc limit 1
"""


def escaneo_para_probar(db: Session) -> tuple[int, str] | None:
    """El último escaneo con notas de Jev, sea de decisión o no: sirve para PROBAR una estrategia
    antes de que exista el de decisión del mes. La jornada oficial sigue pidiendo el de decisión
    (`_escaneo`). Devuelve el id y el día del escaneo, o None si no hay ninguno."""
    fila = db.execute(text(_ESCANEO_CON_NOTAS)).one_or_none()
    return (fila.id, fila.scan_at.strftime("%Y-%m-%d")) if fila else None


def _dia(fin: datetime) -> date:
    return fin.astimezone(TZ_BOLSA).date()


def _ultimo_fin_de_mes(d: date) -> date:
    if calendario.es_ultimo_dia_de_bolsa(d):
        return d
    primero = d.replace(day=1)
    return calendario.dias_de_bolsa(
        primero - timedelta(days=10), primero - timedelta(days=1))[-1]


_PENDIENTES = text("""
    select j.id from liga.jornadas j left join foto f on f.id = j.foto_id
    where j.estado = 'programada' and j.dia_base >= :desde and j.id <> :excluir
      and (j.foto_id is null or f.fin < :fin) order by j.dia_inicio
""")


def _pendientes(db: Session, desde: date, fin: datetime, excluir: int = 0) -> list[int]:
    return list(db.execute(_PENDIENTES, {
        "desde": desde, "fin": fin, "excluir": excluir}).scalars())


def _cambio_de_mes_pendiente(db: Session, dia_foto: date) -> bool:
    """El escaneo del fin de mes no llegó a las semanas que vienen: uno repetido después
    ocupa su sitio."""
    return db.execute(text("""
        select exists (
            select 1 from liga.jornadas j left join foto f on f.id = j.foto_id
            where j.estado = 'programada' and j.dia_base >= :desde
              and (j.foto_id is null
                   or (f.fin at time zone 'America/New_York')::date < :ultimo)
        )
    """), {"desde": dia_foto, "ultimo": _ultimo_fin_de_mes(dia_foto)}).scalar()


def _escaneo(db: Session, foto, scan_run_id: int | None) -> tuple[int, list[str]]:  # noqa: ANN001
    if scan_run_id is not None:
        fila = db.execute(text("select id, decide, error from scan_runs where id = :s"),
                          {"s": scan_run_id}).one_or_none()
        if fila is None:
            raise NoEncontrado(f"No existe el escaneo {scan_run_id}.")
        if not fila.decide or fila.error is not None:
            raise ErrorProceso(f"El escaneo {scan_run_id} no es de decisión o terminó con error.")
        if datos.n_notas(db, scan_run_id) == 0:
            raise ErrorProceso(f"El escaneo {scan_run_id} no tiene notas de Jev.")
        return scan_run_id, []
    propio = db.execute(text(_ESCANEOS.format(filtro="and r.foto_id = :f")),
                        {"f": foto.id}).one_or_none()
    if propio is not None:
        return propio.id, []
    anterior = db.execute(text(_ESCANEOS.format(filtro="and r.scan_at < :inicio")),
                          {"inicio": foto.inicio}).one_or_none()
    if anterior is None:
        raise ErrorProceso("No hay escaneo de decisión con notas de Jev, ni de esta foto ni "
                           "anterior.")
    return anterior.id, [f"Plan B: la foto {foto.id} no tiene escaneo de decisión con notas; "
                         f"se usan las del escaneo {anterior.id}."]


def _designar(db: Session, j: Jornada, foto_id: int | None,
              scan_run_id: int | None) -> Designacion:
    if j.estado != "programada":
        raise ErrorProceso(f"La jornada {j.id} ya está {j.estado}: su foto no se cambia.")
    foto = _foto(db, foto_id)
    sid, avisos = _escaneo(db, foto, scan_run_id)
    foto_escaneo = db.execute(text("select foto_id from scan_runs where id = :s"),
                              {"s": sid}).scalar()
    if foto_escaneo != foto.id:
        raise ErrorProceso(
            f"El escaneo {sid} no puntuó la foto {foto.id}: la jornada solo vale con la misma "
            "foto que usó el escaneo.")
    dia_foto = _dia(foto.fin)
    if dia_foto > j.dia_base:
        raise ErrorProceso(f"La foto {foto.id} es del {dia_foto}, posterior al día base de la "
                           f"jornada ({j.dia_base}).")
    previa = db.execute(text(
        "select f.fin from liga.jornadas a join foto f on f.id = a.foto_id "
        "where a.dia_fin = :d and a.id <> :j order by a.id desc limit 1"),
        {"d": j.dia_base, "j": j.id}).scalar()
    if previa is not None and foto.fin < previa:
        raise ErrorProceso(f"La foto {foto.id} es anterior a la de la jornada previa: la liga no "
                           "vuelve a un escaneo viejo.")
    if foto.fin > j.cierre_inscripcion:
        avisos.append("La foto se terminó después del corte: la cartera usará datos posteriores "
                      "al día base.")
    n_empresas = db.execute(text(
        "select count(distinct ticker) from fundamentals_snapshot where foto_id = :f"),
        {"f": foto.id}).scalar()
    if n_empresas == 0:
        raise ErrorProceso(f"La foto {foto.id} no tiene empresas.")
    return Designacion(foto.id, sid, False, n_empresas, datos.n_notas(db, sid), tuple(avisos))


def _fijar(db: Session, j: Jornada, d: Designacion, actor: str | None, auto: bool) -> None:
    j.foto_id, j.scan_run_id = d.foto_id, d.scan_run_id
    detalle = {"foto_id": d.foto_id, "scan_run_id": d.scan_run_id, "plan_b": d.plan_b}
    if auto:
        detalle["auto"] = True
    auditar(db, "proceso.foto", f"jornada:{j.id}", detalle, actor)


def _salida(j: Jornada, d: Designacion, **extra: object) -> dict:
    return para_json({"jornada_id": j.id, "foto_id": d.foto_id, "scan_run_id": d.scan_run_id,
                      "plan_b": d.plan_b, "empresas": d.n_empresas, "con_notas": d.n_notas,
                      "avisos": list(d.avisos), **extra})


def estado(jornada_id: int, fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        return para_json({"jornada_id": j.id, "estado": j.estado, "foto_id": j.foto_id,
                          "scan_run_id": j.scan_run_id, "plan_b": es_plan_b(db, j)})


def vista_previa(jornada_id: int, foto_id: int | None = None, scan_run_id: int | None = None,
                 fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        d = _designar(db, j, foto_id, scan_run_id)
        fin = db.execute(text("select fin from foto where id = :f"), {"f": d.foto_id}).scalar()
        siguientes = _pendientes(db, j.dia_base, fin, excluir=j.id)
        return _salida(j, d, siguientes=siguientes,
                       actual={"foto_id": j.foto_id, "scan_run_id": j.scan_run_id})


def ejecutar(jornada_id: int, foto_id: int | None = None, scan_run_id: int | None = None,
             fabrica: Fabrica = fabrica_sistema, actor: str | None = None) -> dict:
    try:
        with candado("foto", fabrica), sesion(fabrica) as db:
            j = jornada_bloqueada(db, jornada_id)
            d = _designar(db, j, foto_id, scan_run_id)
            cambia = (j.foto_id, j.scan_run_id) != (d.foto_id, d.scan_run_id)
            fin = db.execute(text("select fin from foto where id = :f"),
                             {"f": d.foto_id}).scalar()
            ids = _pendientes(db, j.dia_base, fin, excluir=j.id)
            siguientes = []
            for jid in ids:
                siguiente = jornada_bloqueada(db, jid)
                designacion = _designar(db, siguiente, d.foto_id, d.scan_run_id)
                siguientes.append((siguiente, designacion))
            if cambia:
                _fijar(db, j, d, actor, auto=False)
            for siguiente, designacion in siguientes:
                _fijar(db, siguiente, designacion, actor, auto=False)
            db.commit()
            return _salida(j, d, cambiada=cambia, siguientes=ids)
    except Exception as e:
        auditar_fallo(fabrica, "foto", f"jornada:{jornada_id}", e, actor)
        raise


def _omitir_auto(db: Session, objeto: str | None, razon: str, avisar: bool = True) -> None:
    """Deja apuntado por qué no designó; avisa al admin solo el último día de bolsa del mes,
    que es cuando hace falta el escaneo de la liga."""
    auditar(db, "proceso.foto.auto.omitido", objeto, {"razon": razon}, None)
    db.commit()
    if avisar and calendario.es_ultimo_dia_de_bolsa(hoy_bolsa()):
        avisar_admin(db, "Vennett: no se designó la foto de la jornada", razon[:140])


def auto_desde_escaneo(scan_run_id: int, fabrica: Fabrica = fabrica_sistema) -> dict | None:
    """Al terminar el escaneo mensual de decisión, todas las semanas programadas con día base
    igual o posterior a su foto reciben el par si no tienen foto o la suya es más vieja.
    El interruptor `procesos.foto.auto` permite desactivar esta designación automática.

    Un escaneo fuera del último día de bolsa solo entra si queda un cambio de mes pendiente:
    así un escaneo repetido puede suplir al mensual fallido en las semanas que vienen.
    Todas las jornadas se validan antes de fijar ninguna para evitar designaciones parciales.
    Los avisos de la primera requieren revisión manual; los rechazos quedan en auditoría.
    El admin solo recibe aviso el último día de bolsa del mes, cuando hace falta el escaneo.
    Nunca lanza: un fallo queda en la auditoría y jamás rompe el escaneo que lo llamó."""
    from app.liga import gestion

    try:
        with candado("foto", fabrica), sesion(fabrica) as db:
            activo = db.execute(text("select valor from liga.ajustes where clave = :c"),
                                {"c": gestion.CLAVE_FOTO_AUTO}).scalar()
            if not gestion.valor_efectivo(gestion.CLAVE_FOTO_AUTO, activo):
                return None
            foto_id_escaneo = db.execute(text("select foto_id from scan_runs where id = :s"),
                                         {"s": scan_run_id}).scalar()
            if foto_id_escaneo is None:
                _omitir_auto(db, f"escaneo:{scan_run_id}", "El escaneo no apunta a ninguna foto.")
                return None
            fin = db.execute(text("select fin from foto where id = :f"),
                             {"f": foto_id_escaneo}).scalar()
            dia_foto = _dia(fin)
            if (not calendario.es_ultimo_dia_de_bolsa(dia_foto)
                    and not _cambio_de_mes_pendiente(db, dia_foto)):
                _omitir_auto(db, f"escaneo:{scan_run_id}",
                             "El escaneo no es del último día de bolsa del mes y no hay un "
                             "cambio de mes pendiente.", avisar=False)
                return None
            ids = _pendientes(db, dia_foto, fin)
            if not ids:
                _omitir_auto(db, f"escaneo:{scan_run_id}", "No hay jornada programada sin foto.",
                             avisar=False)
                return None
            designaciones = []
            for jid in ids:
                j = jornada_bloqueada(db, jid)
                try:
                    d = _designar(db, j, foto_id_escaneo, scan_run_id)
                except ErrorProceso as e:
                    _omitir_auto(db, f"jornada:{j.id}", str(e))
                    return None
                if not designaciones and d.avisos:
                    _omitir_auto(db, f"jornada:{j.id}", " · ".join(d.avisos))
                    return None
                designaciones.append((j, d))
            for j, d in designaciones:
                _fijar(db, j, d, None, auto=True)
            db.commit()
            primera, d_primera = designaciones[0]
            return _salida(primera, d_primera, cambiada=True, jornadas=ids)
    except Exception as e:
        auditar_fallo(fabrica, "foto.auto", f"escaneo:{scan_run_id}", e, None)
        return None
