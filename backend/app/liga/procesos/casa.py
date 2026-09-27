"""Equipos de la casa (plan §8, D5): sus carteras salen de las salas, en solo lectura.

- Lambda: la cartera mecánica de Jev del escaneo de la jornada (`scan_run_jev_item`), con sus
  pesos tal como se guardaron.
- Alpha: la propuesta de la IA de ese escaneo de decisión (`scan_run_construction_item`, las
  mismas filas que `proposal_item`) menos las compras vetadas antes del corte; lo vetado, a caja.
- Omega: sus posiciones abiertas en el corte (`app.momentum.capital`) valoradas al cierre del
  día base, más la caja que le queda hasta su tope, como pesos de ese capital.

Nunca se lee `personal_positions` ni se llama a IBKR. Si un equipo no tiene datos del mes, no
juega esa jornada (y se dice por qué): nunca se inventan posiciones.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
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
COMPRAS = frozenset({"comprar", "ampliar"})
_CIEN = Fraction(100)

Pesos = tuple[tuple[str, Decimal], ...]


@dataclass(frozen=True)
class CarteraCasa:
    """`posiciones` None: no juega esta jornada, y `motivo` dice por qué."""

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


def pesos_alpha(items: Sequence[tuple[str, str, float]],
                vetados: set[str]) -> tuple[list[tuple[str, Decimal]], list[str]]:
    """La propuesta menos las compras vetadas (su peso se queda en caja). Devuelve también qué
    vetos se aplicaron."""
    quitados = sorted({t for t, accion, peso in items
                       if t in vetados and accion in COMPRAS and peso > 0})
    quedan = [(t, peso) for t, accion, peso in items
              if peso > 0 and not (t in vetados and accion in COMPRAS)]
    return pesos_desde_porcentajes(quedan), quitados


def pesos_omega(valores: Mapping[str, Decimal], libre: Decimal) -> list[tuple[str, Decimal]]:
    """Cada posición sobre el capital total (posiciones + caja libre)."""
    valores = {t: Fraction(v) for t, v in valores.items() if v > 0}
    total = sum(valores.values(), Fraction(0)) + Fraction(max(libre, Decimal(0)))
    if total <= 0 or not valores:
        return []
    tickers = sorted(valores)
    pesos = redondear_pesos([valores[t] / total * _CIEN for t in tickers])
    return [(t, p) for t, p in zip(tickers, pesos, strict=True) if p > 0]


# --- Carteras del mes ---------------------------------------------------------------------------


def cartera_lambda(db: Session, scan_run_id: int, plan_b: bool) -> CarteraCasa:
    if plan_b:
        return CarteraCasa("lambda", None, "La jornada va con el plan B: este mes no hay cartera "
                                           "de Jev de un escaneo propio.")
    items = db.execute(text(
        "select ticker, weight_pct from scan_run_jev_item where scan_run_id = :s "
        "order by posicion"), {"s": scan_run_id}).all()
    pesos = pesos_desde_porcentajes((t, w) for t, w in items)
    if not pesos:
        return CarteraCasa("lambda", None, f"El escaneo {scan_run_id} no guardó cartera de Jev.")
    return CarteraCasa("lambda", tuple(pesos))


def cartera_alpha(db: Session, scan_run_id: int, plan_b: bool, corte: datetime) -> CarteraCasa:
    if plan_b:
        return CarteraCasa("alpha", None, "La jornada va con el plan B: este mes no hay "
                                          "propuesta de un escaneo de decisión propio.")
    run = db.execute(text("select scan_at, decide from scan_runs where id = :s"),
                     {"s": scan_run_id}).one_or_none()
    if run is None or not run.decide:
        return CarteraCasa("alpha", None, f"El escaneo {scan_run_id} no es de decisión.")
    items = [(t, a, float(w or 0)) for t, a, w in db.execute(text(
        "select ticker, action, target_weight_pct from scan_run_construction_item "
        "where scan_run_id = :s order by posicion"), {"s": scan_run_id}).all()]
    if not any(w > 0 for _, _, w in items):
        return CarteraCasa("alpha", None, f"El escaneo {scan_run_id} no guardó propuesta.")
    # Las aprobaciones de ese escaneo se crean mientras corre, antes de escribir su fila.
    vetados = set(db.execute(text("""
        select a.ticker from approvals a
        where a.status = 'rejected' and a.decided_at <= :corte
          and a.created_at <= :hasta
          and a.created_at > coalesce(
                (select max(r.scan_at) from scan_runs r where r.scan_at < :hasta),
                '-infinity'::timestamptz)
    """), {"corte": corte, "hasta": run.scan_at}).scalars())
    pesos, quitados = pesos_alpha(items, vetados)
    avisos = tuple(f"{t}: vetada antes del corte, su peso va a caja." for t in quitados)
    if not pesos:
        return CarteraCasa("alpha", (), "Todas sus compras se vetaron: juega en caja.", avisos)
    return CarteraCasa("alpha", tuple(pesos), None, avisos)


def omega_abiertas(db: Session, corte: datetime) -> tuple[dict[str, Decimal] | None, str | None]:
    """Acciones abiertas de Omega por ticker, tal como las cuenta su sala. Si operó después del
    corte, lo abierto hoy ya no es lo del corte: ese mes no juega."""
    from app.momentum import capital

    despues = db.execute(text(
        "select count(*) from momentum_ejecuciones where ejecutada_at > :c"), {"c": corte}).scalar()
    if despues:
        return None, ("Omega operó después del corte: sus posiciones de hoy no son las del corte. "
                      "Forma la jornada antes de que opere.")
    netos: dict[str, Decimal] = {}
    for p in capital.posiciones_abiertas(db).values():
        netos[p["ticker"]] = netos.get(p["ticker"], Decimal(0)) + Decimal(p["neto"])
    return netos, None


def omega_libre(db: Session) -> Decimal:
    """Lo que le queda hasta su tope, con el mismo cómputo que su sala."""
    from app.config import settings
    from app.momentum import capital

    tope = Decimal(str(settings.momentum_capital_tope_usd))
    return max(Decimal(0), tope - capital.capital_desplegado(db))


def cartera_omega(netos: Mapping[str, Decimal], cierres_base: Mapping[str, Decimal],
                  libre: Decimal, dia_base: date) -> CarteraCasa:
    sin_precio = sorted(t for t in netos if t not in cierres_base)
    if sin_precio:
        return CarteraCasa("omega", None, f"Sin cierre del {dia_base} para "
                                          f"{', '.join(sin_precio)}: no se puede valorar.")
    valores = {t: n * cierres_base[t] for t, n in netos.items()}
    pesos = pesos_omega(valores, libre)
    if not pesos:
        return CarteraCasa("omega", (), "Sin posiciones abiertas en el corte: juega en caja.")
    return CarteraCasa("omega", tuple(pesos))
