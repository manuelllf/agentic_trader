"""Equipos de la casa (plan §8, D5): sus carteras salen de las salas, en solo lectura.

- Lambda: la cartera mecánica de Jev del escaneo de la jornada (`scan_run_jev_item`), con sus
  pesos tal como se guardaron; si ese detalle está vacío, la de `scan_audit` (`jev_funded`), a
  partes iguales.
- Alpha: la cartera que tenía el agente al cierre del día de la foto de la jornada, leída de su
  base con un rol de solo lectura (`alpha_agente`). El agente no sabe que la liga la usa.
- Omega: no sale de las posiciones de la sala; nace en caja y `procesos.omega` va llenando sus
  4 huecos con las alertas durante el mes.

Nunca se lee `personal_positions` ni se llama a IBKR. Los tres equipos entran SIEMPRE en la
jornada: Lambda con la cartera del escaneo de decisión de la jornada o, si ese no la guardó (o es
plan B), con la del último escaneo de decisión que sí la tenga; Alpha con la del agente; y si no
hay ninguna, juegan en caja. Nunca se inventan posiciones.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from fractions import Fraction

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.motor.seleccion import redondear_pesos
from app.liga.procesos import alpha_agente
from app.liga.procesos.comun import ErrorProceso

CASAS: dict[str, tuple[str, str]] = {
    "alpha": ("Alpha", "#1DE27A"),
    "omega": ("Omega", "#FF6B1A"),
    "lambda": ("Lambda", "#D8D4CB"),
}
_CIEN = Fraction(100)
# Lo que dice el aviso de Alpha cuando el agente no guardó el cierre del día de la foto.
CIERRE_VIEJO = "los pesos usan el último cierre que tenía"

Pesos = tuple[tuple[str, Decimal], ...]


@dataclass(frozen=True)
class CarteraCasa:
    """`posiciones` vacías: juega en caja, y `motivo` dice por qué. `None` ya no lo devuelve la
    casa (siempre juega), pero `formar` lo sigue tolerando."""

    clave: str
    posiciones: Pesos | None
    motivo: str | None = None
    avisos: tuple[str, ...] = field(default=())


# --- La estrategia de cada equipo ---------------------------------------------------------------


def casas_que_faltan(db: Session) -> list[str]:
    hay = set(db.execute(text(
        "select casa_clave from liga.estrategias where tipo = 'casa'")).scalars())
    return [c for c in CASAS if c not in hay]


def asegurar(db: Session) -> dict:
    """Crea las que falten (únicas por `casa_clave`). Juegan siempre: nacen `jugando`."""
    creadas = []
    for clave, (nombre, color) in CASAS.items():
        nuevo = db.execute(text("""
            insert into liga.estrategias (dueno_id, tipo, casa_clave, nombre, forma, dibujo,
                                          color1, color2, estado)
            values (null, 'casa', :c, :n, 'circulo', 'liso', :col, :col, 'jugando')
            on conflict (casa_clave) do nothing
            returning id
        """), {"c": clave, "n": nombre, "col": color}).scalar()
        if nuevo is not None:
            creadas.append(clave)
    return {"creadas": creadas, "ids": ids(db)}


def ids(db: Session) -> dict[str, uuid.UUID]:
    return dict(db.execute(text(
        "select casa_clave, id from liga.estrategias where tipo = 'casa'")).all())


# --- Cuentas puras ------------------------------------------------------------------------------


def pesos_desde_porcentajes(
        items: Iterable[tuple[str, float | Decimal]]) -> list[tuple[str, Decimal]]:
    """Pesos en % guardados por las salas (float) a los de la liga: 4 decimales, sin ceros y sin
    pasar de 100 (si la suma se pasa por redondeo, se escala)."""
    por_ticker: dict[str, Fraction] = {}
    for ticker, peso in items:
        f = Fraction(Decimal(str(peso)))
        if f > 0:
            por_ticker[ticker] = por_ticker.get(ticker, Fraction(0)) + f
    if not por_ticker:
        return []
    total = sum(por_ticker.values(), Fraction(0))
    escala = _CIEN / total if total > _CIEN else Fraction(1)
    tickers = list(por_ticker)
    pesos = redondear_pesos([por_ticker[t] * escala for t in tickers])
    return [(t, p) for t, p in zip(tickers, pesos, strict=True) if p > 0]


# --- Carteras del mes ---------------------------------------------------------------------------


_ESCANEOS_ATRAS = 6   # escaneos de decisión anteriores que se prueban antes de jugar en caja


def _escaneos_de_decision(db: Session, scan_run_id: int) -> list[int]:
    """El de la jornada y, por si no guardó cartera, los de decisión anteriores, del más
    reciente al más viejo."""
    previos = db.execute(text("""
        select id from scan_runs
        where decide and error is null
          and scan_at < (select scan_at from scan_runs where id = :s)
        order by scan_at desc, id desc limit :n
    """), {"s": scan_run_id, "n": _ESCANEOS_ATRAS}).scalars().all()
    return [scan_run_id, *previos]


def _avisos_de_origen(clave: str, escaneo: int, scan_run_id: int, plan_b: bool) -> tuple[str, ...]:
    """Qué escaneo puso la cartera cuando no es el de la jornada, o es plan B."""
    if escaneo != scan_run_id:
        return (f"{CASAS[clave][0]} juega con la cartera del escaneo {escaneo}: el {scan_run_id} "
                "no la guardó.",)
    if plan_b:
        return (f"Plan B: {CASAS[clave][0]} juega con la cartera de su último escaneo de decisión "
                f"({escaneo}), no la de un escaneo de la foto de la jornada.",)
    return ()


def _en_caja(clave: str, motivo: str) -> CarteraCasa:
    return CarteraCasa(clave, (), motivo, ())


def _pesos_lambda(db: Session, s: int) -> list[tuple[str, Decimal]]:
    items = db.execute(text(
        "select ticker, weight_pct from scan_run_jev_item where scan_run_id = :s "
        "order by posicion"), {"s": s}).all()
    pesos = pesos_desde_porcentajes((t, w) for t, w in items)
    if not pesos:
        # Hay escaneos con la cartera de Jev solo en la auditoría, con los fondeados a partes
        # iguales.
        fondeados = sorted(set(db.execute(text(
            "select ticker from scan_audit where scan_run_id = :s and jev_funded"),
            {"s": s}).scalars()))
        if fondeados:
            pesos = pesos_desde_porcentajes((t, Decimal(100) / len(fondeados)) for t in fondeados)
    return pesos


def cartera_lambda(db: Session, scan_run_id: int, plan_b: bool) -> CarteraCasa:
    for s in _escaneos_de_decision(db, scan_run_id):
        pesos = _pesos_lambda(db, s)
        if pesos:
            return CarteraCasa("lambda", tuple(pesos), None,
                               _avisos_de_origen("lambda", s, scan_run_id, plan_b))
    return _en_caja("lambda", "Ningún escaneo de decisión guardó la cartera de Jev: Lambda juega "
                              "en caja.")


def cartera_alpha(dia_foto: date | None, espera_agotada: bool,
                  leer: alpha_agente.Lector | None = None) -> CarteraCasa:
    """La cartera del agente al cierre de `dia_foto` (el día de la foto de la jornada).

    Si no se puede leer o el agente aún no guardó el cierre de ese día, mientras dure la espera se
    para la formación con un `ErrorProceso` (se reintenta sola); agotada la espera, juega con lo
    que haya y lo dice, o en caja si no hay nada que leer."""
    if dia_foto is None:
        return _en_caja("alpha", "La jornada no tiene día de foto: Alpha juega en caja.")
    foto, problema = None, None
    try:
        foto = (leer or alpha_agente.leer)(dia_foto)
        if not foto.cierre_guardado:
            problema = f"El agente no tiene guardado el cierre del {dia_foto.isoformat()}"
    except alpha_agente.SinLecturaAgente as e:
        problema = str(e)
    if problema and not espera_agotada:
        raise ErrorProceso(f"Alpha: {problema}. Se reintenta en unos minutos.")
    if foto is None:
        return _en_caja("alpha", f"{problema}: Alpha juega en caja.")
    pesos = pesos_desde_porcentajes((t, p * 100) for t, p in foto.posiciones)
    if not pesos:
        return _en_caja("alpha", f"El agente no tenía posiciones el {dia_foto.isoformat()}: "
                                 "Alpha juega en caja.")
    avisos = (f"{problema}: {CIERRE_VIEJO}.",) if problema else ()
    return CarteraCasa("alpha", tuple(pesos), None, avisos)
