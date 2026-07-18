"""Aprobaciones de la Sala Real — el agente PROPONE, el usuario DECIDE.

Contrato de seguridad (innegociable):
- El agente NUNCA ejecuta solo. Cada operación propuesta para la cuenta real queda
  `pending` hasta que el usuario pulse Sí (ejecuta) o No (descarta, sin más).
- `approve` recalcula el tamaño con la caja/equity REAL en el momento de aprobar
  (no con la del escaneo) y con aritmética `Decimal` exacta.
- Las pendientes caducan a los N días (datos rancios ≠ decisión válida).
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import push, tracking
from app.brokers import get_broker
from app.config import settings
from app.ledger import service as ledger
from app.ledger.money import D, to_cents
from app.models import BOOK_REAL, Approval, Score

logger = logging.getLogger(__name__)

ZERO = Decimal("0")


def create_from_items(db: Session, items: list[dict], macro_summary: str) -> int:
    """Convierte los trades propuestos por el constructor en aprobaciones pendientes.

    Reemplaza las pendientes previas (el escaneo nuevo manda) y notifica por push.
    """
    # Un escaneo nuevo invalida lo no decidido del anterior: sus datos ya son viejos.
    for old in db.scalars(select(Approval).where(Approval.status == "pending")).all():
        old.status = "expired"
        old.decided_at = datetime.now(UTC)
        old.result_msg = "Reemplazada por un escaneo más reciente."

    sectors = {s.ticker: s.sector for s in db.scalars(select(Score)).all()}
    created = 0
    for it in items:
        if it.get("action") in (None, "", "mantener"):
            continue
        db.add(Approval(
            ticker=it["ticker"],
            sector=sectors.get(it["ticker"], ""),
            action=it["action"],
            target_weight_pct=float(it.get("target_weight_pct") or 0.0),
            score=it.get("score"),
            est_price=D(it["price"]) if it.get("price") else None,
            target_price=it.get("target_price"),
            upside_pct=it.get("upside_pct"),
            thesis=it.get("thesis", ""),
            edge=it.get("edge", ""),
            risk=it.get("risk", ""),
            macro_summary=macro_summary,
        ))
        created += 1
    db.commit()

    if created:
        push.send_to_all(
            db,
            title="Agentic Trader — Sala Real",
            body=f"{created} operación(es) esperan tu decisión. Sí ejecuta, No descarta.",
            url="/real",
        )
    return created


def expire_stale(db: Session) -> None:
    """Caduca pendientes más viejas que APPROVAL_EXPIRY_DAYS."""
    limit = datetime.now(UTC) - timedelta(days=settings.approval_expiry_days)
    for a in db.scalars(select(Approval).where(Approval.status == "pending")).all():
        created = a.created_at if a.created_at.tzinfo else a.created_at.replace(tzinfo=UTC)
        if created < limit:
            a.status = "expired"
            a.decided_at = datetime.now(UTC)
            a.result_msg = f"Caducada sin decisión tras {settings.approval_expiry_days} días."
    db.commit()


def pending(db: Session) -> list[Approval]:
    expire_stale(db)
    return list(db.scalars(
        select(Approval).where(Approval.status == "pending").order_by(Approval.created_at)
    ).all())


def history(db: Session, limit: int = 30) -> list[Approval]:
    return list(db.scalars(
        select(Approval).where(Approval.status != "pending")
        .order_by(Approval.decided_at.desc()).limit(limit)
    ).all())


def reject(db: Session, approval_id: int) -> Approval:
    """No → se descarta sin más. Cero efectos."""
    a = _get_pending(db, approval_id)
    a.status = "rejected"
    a.decided_at = datetime.now(UTC)
    a.result_msg = "Descartada por el usuario."
    db.commit()
    return a


def approve(db: Session, approval_id: int) -> Approval:
    """Sí → calcula el tamaño EXACTO con el estado real actual y envía la orden LÍMITE.

    dry-run: el fill es instantáneo (precio vivo) y se registra en el libro real.
    live: la orden límite puede tardar en ejecutar; el broker sondea unos segundos y, si no
    llena, la deja 'working' → se reconcilia luego (reconcile_working). Se registra siempre el
    fill REAL que devuelve IBKR (precio y cantidad), no una estimación.
    """
    a = _get_pending(db, approval_id)
    broker = get_broker()
    a.decided_at = datetime.now(UTC)
    a.order_ref = f"AGENT-REAL-{uuid.uuid4().hex[:10]}"

    try:
        qty, side = _sizing(db, a)
        a.requested_quantity = qty          # lo PEDIDO: reconcile lo necesita si IBKR no da cantidad
        result = broker.place_order(a.ticker, side, qty, order_ref=a.order_ref)
        a.broker_order_id = result.order_id
        _apply_result(db, a, side, result, requested=qty)
    except Exception as exc:  # noqa: BLE001 — el motivo del fallo debe verse en el panel
        logger.exception("Fallo ejecutando la aprobación %s", approval_id)
        a.status = "failed"
        a.result_msg = str(exc)
    db.commit()
    return a


def reconcile_working(db: Session) -> int:
    """Sondea en IBKR las aprobaciones 'working' y registra los fills que hayan entrado.

    Best-effort e idempotente: solo registra el DELTA de acciones nuevo desde la última vez.
    Devuelve cuántas cambiaron. En dry-run no hay 'working', así que no hace nada.
    """
    broker = get_broker()
    changed = 0
    working = db.scalars(select(Approval).where(Approval.status == "working")).all()
    for i, a in enumerate(working):
        if not a.broker_order_id:
            continue
        if i:  # ritmo suave entre sondeos: lejos del rate limit de IBKR
            time.sleep(0.3)
        # Cada aprobación es independiente Y se persiste sola (commit DENTRO del bucle): el
        # rollback de un fallo posterior (red, datos raros) no puede deshacer el estado de un
        # fill anterior ya aplicado.
        try:
            result = broker.poll_order(a.broker_order_id)
            before = a.status
            _apply_result(db, a, _side_of(a.action), result,
                          requested=a.requested_quantity or a.quantity or ZERO)
            db.commit()
            if a.status != before or result.status in ("filled", "partial"):
                changed += 1
        except Exception:  # noqa: BLE001 — un fallo puntual no debe tumbar el refresco
            logger.warning("No se pudo reconciliar la orden %s", a.broker_order_id)
            db.rollback()   # descarta cualquier cambio a medias de ESTA aprobación
            continue
    return changed


# ---------------------------------------------------------------------------


def _side_of(action: str) -> str:
    return "buy" if action in ("comprar", "ampliar") else "sell"


def _apply_result(db: Session, a: Approval, side: str, result, requested: Decimal) -> None:  # noqa: ANN001
    """Traduce el BrokerResult al libro real + estado de la aprobación (fill incremental)."""
    status = result.status
    if status in ("filled", "partial"):
        total = result.filled_quantity
        if total is None:
            total = requested if status == "filled" else ZERO
        _record_fill(db, a, side, D(total), result.fill_price)
        a.status = "executed" if status == "filled" else "working"
        a.result_msg = result.message
    elif status == "working":
        a.status = "working"
        a.result_msg = result.message
    else:  # rejected / cancelled — si ya se había ejecutado algo, no es un fallo total
        a.status = "executed" if (a.quantity or ZERO) > ZERO else "failed"
        a.result_msg = result.message


def _record_fill(db: Session, a: Approval, side: str, total_filled: Decimal, avg_price) -> None:  # noqa: ANN001
    """Registra en el libro real SOLO el delta de acciones nuevo. Idempotente y cent-exacto.

    IBKR reporta el precio medio ACUMULADO de la orden. Si ya registramos `already` acciones
    a un medio anterior, el delta se registra al precio que deja nuestro coste total IGUAL al
    de IBKR: (total·avg_nuevo − already·avg_previo) / delta. Así el libro cuadra al céntimo.

    Atomicidad: el contador (a.quantity) se actualiza ANTES de record_buy/sell — misma sesión,
    mismo commit. O se persisten trade+contador juntos, o ninguno (el rollback del caller
    descarta ambos). Nunca puede quedar un trade registrado con el contador viejo (que
    duplicaría el fill en el siguiente reconcile).
    """
    already = a.quantity or ZERO
    delta = total_filled - already
    if delta <= ZERO:
        return
    avg_new = D(avg_price) if avg_price is not None else _live_price(a)
    avg_prev = a.fill_price
    if already > ZERO and avg_prev is not None:
        px = (total_filled * avg_new - already * avg_prev) / delta
        if px <= ZERO:  # dato raro de IBKR → mejor el medio acumulado que un precio absurdo
            px = avg_new
    else:
        px = avg_new

    a.quantity = total_filled
    a.fill_price = to_cents(avg_new)   # medio acumulado (lo que el usuario espera ver)
    if side == "buy":
        ledger.record_buy(db, a.ticker, delta, px, a.order_ref, book=BOOK_REAL)
    else:
        ledger.record_sell(db, a.ticker, delta, px, a.order_ref, book=BOOK_REAL)


def _get_pending(db: Session, approval_id: int) -> Approval:
    a = db.get(Approval, approval_id)
    if a is None:
        raise LookupError(f"No existe la aprobación {approval_id}.")
    if a.status != "pending":
        raise ValueError(f"La aprobación {approval_id} ya está '{a.status}'.")
    return a


def _live_price(a: Approval) -> Decimal:
    prices = tracking.live_prices([a.ticker])
    if a.ticker in prices:
        return D(prices[a.ticker])
    if a.est_price is not None:
        return a.est_price
    raise RuntimeError(f"Sin precio para {a.ticker}.")


def _reserved(db: Session, ticker: str) -> tuple[Decimal, Decimal]:
    """(caja, acciones de `ticker`) comprometidas por órdenes 'working' aún sin fill completo.

    Una orden límite viva en IBKR compromete recursos que nuestro libro aún no ha movido
    (el fill no ha llegado). Sin esta reserva, aprobar otra orden en ese hueco gastaría la
    misma caja dos veces (o vendería dos veces las mismas acciones).
    """
    cash = Decimal("0")
    shares = Decimal("0")
    for w in db.scalars(select(Approval).where(Approval.status == "working")).all():
        remaining = (w.requested_quantity or ZERO) - (w.quantity or ZERO)
        if remaining <= ZERO:
            continue
        if w.action in ("comprar", "ampliar"):
            if w.est_price is not None:
                cash += remaining * w.est_price
        elif w.ticker == ticker:  # vender/recortar: solo bloquea acciones de ese ticker
            shares += remaining
    return to_cents(cash), shares


def _sizing(db: Session, a: Approval) -> tuple[Decimal, str]:
    """(cantidad, lado) cent-exactos sobre el libro REAL en el momento de aprobar.

    Delega en el sizing único y compartido (mismo criterio que la Sala Sombra): floor de
    acciones a 4 decimales + recorte a la caja → nunca falla por céntimos. El precio del
    nombre objetivo es el vivo (con fallback a la estimación del escaneo). La caja/acciones
    comprometidas por órdenes 'working' quedan RESERVADAS (anti doble gasto).
    """
    cash_reserved, shares_reserved = _reserved(db, a.ticker)
    return ledger.size_to_weight(
        db, BOOK_REAL, a.ticker, a.action, a.target_weight_pct, _live_price(a),
        cash_reserved=cash_reserved, shares_reserved=shares_reserved,
        live_prices=tracking.live_prices,
    )
