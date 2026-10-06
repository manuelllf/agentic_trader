"""El premio anual (fase 5): al cerrarse una temporada que cuenta, se calcula una sola vez quién
lo gana y cuánto, y se guarda en `liga.premios_temporada` y `liga.premios` (de solo añadir).

Cada cuenta compite con la estrategia que optaba en cada jornada (`inscripciones.optaba_premio`).
Es elegible con al menos 10 jornadas jugadas; las que no jugó valen 0 %. El escalón (0, 1 o 2) sale
de cuántas cuentas elegibles hay y de los umbrales de Ajustes; las reglas están en `motor.premio`.
Pagar, con la identidad verificada, queda fuera del producto.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.models import Premio, PremioTemporada
from app.liga.motor import premio as motor
from app.liga.procesos.comun import (
    ErrorProceso,
    Fabrica,
    auditar,
    auditar_fallo,
    avisar_admin,
    candado,
    fabrica_sistema,
    para_json,
    sesion,
)

logger = logging.getLogger(__name__)

AJUSTE_UMBRAL_BASICO = "premio.umbral_basico"
AJUSTE_UMBRAL_COMPLETO = "premio.umbral_completo"
AJUSTE_VISIBLE = "premio.visible"

_JUGADAS = text("""
    select e.dueno_id::text as cuenta, j.numero, r.rentabilidad
    from liga.inscripciones i
    join liga.estrategias e on e.id = i.estrategia_id
    join liga.jornadas j on j.id = i.jornada_id
    join liga.resultados r on r.inscripcion_id = i.id
    where j.temporada_id = :t and i.optaba_premio and e.dueno_id is not null
""")


def _entero(db: Session, clave: str, defecto: int) -> int:
    """Lo guardado en `liga.ajustes` solo vale si es un entero positivo."""
    valor = db.execute(text("select valor from liga.ajustes where clave = :c"),
                       {"c": clave}).scalar()
    if isinstance(valor, bool) or not isinstance(valor, int) or valor < 1:
        return defecto
    return valor


def umbrales(db: Session) -> tuple[int, int]:
    return (_entero(db, AJUSTE_UMBRAL_BASICO, motor.UMBRAL_BASICO),
            _entero(db, AJUSTE_UMBRAL_COMPLETO, motor.UMBRAL_COMPLETO))


def visible(db: Session) -> bool:
    """El premio no se enseña hasta que alguien lo enciende a propósito (tras revisar las bases)."""
    return db.execute(text("select valor from liga.ajustes where clave = :c"),
                      {"c": AJUSTE_VISIBLE}).scalar() is True


def estado_publico(fabrica: Fabrica = fabrica_sistema) -> dict:
    """Lo que ve cualquiera, sin nombres: cuántas cuentas optan, los umbrales y los escalones.
    Con la temporada cerrada, el escalón con el que se calculó y las cuentas elegibles."""
    with sesion(fabrica) as db:
        if not visible(db):
            return {"visible": False}
        temporadas = db.execute(text("select id, nombre, estado from liga.temporadas "
                                     "where cuenta order by id")).all()
        if not temporadas:
            return {"visible": False}
        t = next((t for t in temporadas if t.estado != "cerrada"), temporadas[-1])
        basico, completo = umbrales(db)
        cerrada = db.get(PremioTemporada, t.id)
        if cerrada is not None:
            cuentas = db.execute(text("select count(*) from liga.premios where temporada_id = :t"),
                                 {"t": t.id}).scalar_one()
            escalon = cerrada.escalon
        else:
            cuentas = db.execute(text("select count(distinct dueno_id) from liga.estrategias "
                                      "where tipo = 'usuario' and opta_premio")).scalar_one()
            escalon = motor.escalon(cuentas, basico, completo)
        return {
            "visible": True, "temporada": {"id": t.id, "nombre": t.nombre},
            "calculado": cerrada is not None, "cuentas": cuentas, "escalon": escalon,
            "umbral_basico": basico, "umbral_completo": max(basico, completo),
            "importes": {str(e): [int(i) for i in premios]
                         for e, premios in motor.IMPORTES.items()},
        }


def cuentas_elegibles(db: Session, temporada_id: int, n_jornadas: int) -> list[motor.Cuenta]:
    jugadas: dict[str, dict[int, Decimal]] = defaultdict(dict)
    for f in db.execute(_JUGADAS, {"t": temporada_id}).all():
        jugadas[f.cuenta][f.numero] = f.rentabilidad
    return [motor.Cuenta(cuenta, len(por_jornada), motor.acumulada(
                por_jornada.get(n) for n in range(1, n_jornadas + 1)))
            for cuenta, por_jornada in sorted(jugadas.items())
            if len(por_jornada) >= motor.MIN_JORNADAS]


def calcular(temporada_id: int, fabrica: Fabrica = fabrica_sistema,
             actor: str | None = None) -> dict:
    """Escribe el resultado de una temporada cerrada que cuenta. Repetirlo no cambia nada: lo
    calculado no se corrige."""
    try:
        with candado("premio", fabrica):
            with sesion(fabrica) as db:
                return _escribir(db, temporada_id, actor)
    except Exception as e:
        auditar_fallo(fabrica, "premio", f"temporada:{temporada_id}", e, actor)
        raise


def _escribir(db: Session, temporada_id: int, actor: str | None) -> dict:
    t = db.execute(text("select estado, cuenta, n_jornadas from liga.temporadas "
                        "where id = :t for update"), {"t": temporada_id}).one_or_none()
    if t is None or not t.cuenta:
        raise ErrorProceso("Esa temporada no existe o no cuenta para el premio.")
    if t.estado != "cerrada":
        raise ErrorProceso("El premio se calcula al cerrar la temporada.")
    if db.get(PremioTemporada, temporada_id) is not None:
        return {"temporada_id": temporada_id, "ya_calculado": True}
    cuentas = cuentas_elegibles(db, temporada_id, t.n_jornadas)
    basico, completo = umbrales(db)
    escalon = motor.escalon(len(cuentas), basico, completo)
    repartidos = motor.repartir(cuentas, motor.IMPORTES[escalon]) if escalon else []
    premios = {p.cuenta: p for p in repartidos}
    db.add(PremioTemporada(temporada_id=temporada_id, escalon=escalon))
    db.add_all(Premio(
        temporada_id=temporada_id, usuario_id=c.id, jornadas_jugadas=c.jornadas,
        rentabilidad=c.rentabilidad.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
        puesto=premios[c.id].puesto if c.id in premios else None,
        importe=premios[c.id].importe if c.id in premios else None) for c in cuentas)
    resumen = {"temporada_id": temporada_id, "elegibles": len(cuentas), "escalon": escalon,
               "con_premio": len(premios), "umbrales": [basico, completo]}
    auditar(db, "proceso.premio", f"temporada:{temporada_id}", resumen, actor)
    avisar_admin(db, "Vennett: premio de la temporada calculado",
                 f"{len(cuentas)} cuentas elegibles, escalón {escalon}, {len(premios)} con premio.")
    db.commit()
    return para_json(resumen)


def job(fabrica: Fabrica = fabrica_sistema) -> list[int]:
    """Calcula las temporadas ya cerradas que aún no tienen resultado. Corre cada media hora y,
    sin nada pendiente, es una consulta. Nunca lanza."""
    hechas: list[int] = []
    try:
        with sesion(fabrica) as db:
            pendientes = list(db.execute(text("""
                select t.id from liga.temporadas t
                where t.cuenta and t.estado = 'cerrada'
                  and not exists (select 1 from liga.premios_temporada p
                                  where p.temporada_id = t.id)
                order by t.id
            """)).scalars())
        for t in pendientes:
            calcular(t, fabrica)
            hechas.append(t)
    except Exception:
        logger.exception("No se pudo calcular el premio de la temporada")
    return hechas
