"""Equipos de la casa (plan §8, D5): sus carteras salen de las salas, en solo lectura.

- Lambda: la cartera mecánica de Jev del escaneo de la jornada (`scan_run_jev_item`), con sus
  pesos tal como se guardaron; si ese detalle está vacío, la de `scan_audit` (`jev_funded`), a
  partes iguales.
- Alpha: la propuesta automática de ese escaneo de decisión (`scan_run_construction_item`, los
  pesos objetivo), sin los vetos del dueño: su cuenta real y sus aprobaciones son su panel
  personal y la liga no depende de ellas.
- Omega: no sale de las posiciones de la sala; nace en caja y `procesos.omega` va llenando sus
  4 huecos con las alertas durante el mes.

Nunca se lee `personal_positions` ni se llama a IBKR. Los tres equipos entran SIEMPRE en la
jornada: Lambda y Alpha con la cartera del escaneo de decisión de la jornada o, si ese no la
guardó (o es plan B), con la del último escaneo de decisión que sí la tenga; y si no existe
ninguna, juegan en caja. Nunca se inventan posiciones.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from decimal import Decimal
from fractions import Fraction

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.motor.seleccion import redondear_pesos

CASAS: dict[str, tuple[str, str]] = {
    "alpha": ("Alpha", "#1DE27A"),
    "omega": ("Omega", "#FF6B1A"),
    "lambda": ("Lambda", "#D8D4CB"),
}
_CIEN = Fraction(100)

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


def _pesos_alpha(db: Session, s: int) -> list[tuple[str, Decimal]]:
    return pesos_desde_porcentajes((t, float(w or 0)) for t, w in db.execute(text(
        "select ticker, target_weight_pct from scan_run_construction_item "
        "where scan_run_id = :s order by posicion"), {"s": s}).all())


def cartera_alpha(db: Session, scan_run_id: int, plan_b: bool) -> CarteraCasa:
    for s in _escaneos_de_decision(db, scan_run_id):
        pesos = _pesos_alpha(db, s)
        if pesos:
            return CarteraCasa("alpha", tuple(pesos), None,
                               _avisos_de_origen("alpha", s, scan_run_id, plan_b))
    return _en_caja("alpha", "Ningún escaneo de decisión guardó una propuesta: Alpha juega en "
                             "caja.")
