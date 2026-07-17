"""Matemática de cartera (sin LLM, sin escrituras en BD).

La parte determinista del método: dado lo que el escaneo ya puntuó y lo que el constructor
propuso, aquí se decide QUÉ entra (selección fiel al paper), CUÁNTO pesa (100% invertido con
tope por posición) y CÓMO se traduce a trades (diff objetivo vs actual con aritmética Decimal
exacta). El LLM nunca toca dinero: todo lo de este módulo es código puro y testeable.

Lo usa `app.scan_service` desde sus tres pipelines (escaneo, recheck, redeep).
"""

from __future__ import annotations

from decimal import ROUND_DOWN, Decimal

from sqlalchemy.orm import Session

from app.agents import constructor as constructor_mod
from app.config import settings
from app.ledger import service as ledger
from app.ledger.money import D, to_cents

ZERO = Decimal("0")


def select_top(rows: list, mcap: dict, floor: int, n: int) -> list:
    """Selección FIEL al paper: top-N por score, desempate por MARKET CAP (mayor gana).

    `rows` = objetos con `.ticker` y `.score` (ScoreResult del escaneo o Score de la BD).
    Filtra por el suelo de score solo si `floor` > 0.
    """
    eligible = [r for r in rows if r.score >= floor]
    eligible.sort(key=lambda r: (-r.score, -(mcap.get(r.ticker) or 0.0)))
    return eligible[:n]


def select_finalists(prescored: list, held: set, watch: list,
                     per_sector: int, global_n: int, cap: int, top_caps: int = 0) -> list[str]:
    """Corte de finalistas al profundo: amplitud por sector + mejores globales, con tope duro.

    `prescored` = [(PrescoreResult, NameData)] YA ordenado por pre-score descendente. El corte
    combina top-`per_sector` por sector (para que el profundo VEA cada sector, no un mandato de
    diversificar) ∪ top-`global_n` global ∪ las `top_caps` mayores capitalizaciones (carril de
    rescate OBJETIVO: en el paper el modelo grande puntúa todos los grandes; el pre-score barato
    no puede vetarlos). La selección FINAL de cartera sigue siendo puro score.

    Prioridad al truncar a `cap`: posiciones → núcleo por sector → extras del top global →
    mayores caps → watchlist. Se recorta desde abajo; núcleo + posiciones nunca se sacrifican.
    """
    ranked = [p.ticker for p, _d in prescored]          # ya viene por score desc
    sector = {p.ticker: d.sector for p, d in prescored}
    present = set(ranked)

    core: list[str] = []
    per: dict[str, int] = {}
    for t in ranked:
        s = sector[t]
        if per.get(s, 0) < per_sector:
            core.append(t)
            per[s] = per.get(s, 0) + 1
    global_top = ranked[:global_n]
    held_in = [t for t in ranked if t in held]          # solo las presentes, en orden de score
    by_cap = sorted(prescored, key=lambda pd: -(pd[1].market_cap or 0.0))
    caps_in = [p.ticker for p, _d in by_cap[:top_caps]]
    watch_in = [t for t in watch if t in present]

    ordered: list[str] = []
    for group in (held_in, core, global_top, caps_in, watch_in):
        for t in group:
            if t not in ordered:
                ordered.append(t)
    return ordered[:cap]


def _full_invest(weights: list[float], cap: float, total: float = 100.0) -> list[float]:
    """Reparte `total`% entre las posiciones respetando el tope `cap` por posición (water-filling).

    Usa `weights` como prioridades. Requiere len*cap >= total (garantizado con min 3 y cap 35).
    """
    n = len(weights)
    if n == 0:
        return []
    w = [max(0.0, x) for x in weights]
    if sum(w) <= 0:
        w = [1.0] * n
    out = [0.0] * n
    fixed = [False] * n
    for _ in range(n + 1):
        rem = total - sum(out)
        idx = [i for i in range(n) if not fixed[i]]
        s = sum(w[i] for i in idx)
        if rem <= 1e-9 or not idx or s <= 0:
            break
        overflow = False
        for i in idx:
            if rem * w[i] / s > cap + 1e-9:     # esa posición se pasa del tope → clávala al tope
                out[i] = cap
                fixed[i] = True
                overflow = True
        if not overflow:                         # el resto cabe → reparte y termina
            for i in idx:
                out[i] += rem * w[i] / s
            break
    return [round(x, 2) for x in out]


def finalize_full_invest(construction, selected: list, min_pos: int, max_pos: int, cap: float):
    """Cartera 100% invertida entre `min_pos`-`max_pos` nombres (método paper: sin caja).

    Rellena hasta `min_pos` con los mejores por score que el LLM no fondeó, y normaliza los
    pesos a 100% respetando el tope por posición. Si no hay nada que invertir, no toca nada.
    """
    if not settings.fully_invested:
        return construction
    funded = [p for p in construction.positions if p.weight_pct > 0][:max_pos]
    have = {p.ticker for p in funded}
    for r in selected:                           # backfill hasta el mínimo si el LLM fondeó pocos
        if len(funded) >= min_pos:
            break
        if r.ticker not in have:
            funded.append(constructor_mod.TargetPosition(
                ticker=r.ticker, weight_pct=1.0,
                thesis=getattr(r, "headline", ""), edge="", risk=""))
            have.add(r.ticker)
    if not funded:
        return construction
    weights = _full_invest([p.weight_pct for p in funded], cap)
    for p, w in zip(funded, weights, strict=True):   # _full_invest devuelve len(funded) pesos
        p.weight_pct = w
    construction.positions = funded
    construction.cash_pct = round(max(0.0, 100.0 - sum(weights)), 2)
    return construction


def _equity(db: Session, held: dict, price_map: dict) -> tuple[Decimal, Decimal]:
    """(cash, equity) usando precios actuales; cae al coste medio si falta precio."""
    cash = ledger.available_cash(db)
    pos_value = ZERO
    for tk, p in held.items():
        price = D(price_map[tk]) if price_map.get(tk) else p.avg_cost
        pos_value += p.quantity * price
    return cash, to_cents(cash + pos_value)


def portfolio_text(db: Session, held: dict, price_map: dict) -> str:
    """Foto de la cartera en texto (para el prompt del constructor)."""
    cash, equity = _equity(db, held, price_map)
    lines = [f"Cash ${cash} · Equity ${equity} · max {settings.max_positions} positions, "
             f"max {settings.max_position_pct}% each."]
    if not held:
        lines.append("No open positions (the sleeve is all cash).")
    for tk, p in held.items():
        price = D(price_map[tk]) if price_map.get(tk) else p.avg_cost
        value = to_cents(p.quantity * price)
        weight = (value / equity * 100) if equity else ZERO
        upnl = to_cents(p.quantity * (price - p.avg_cost))
        lines.append(f"- {tk}: {p.quantity} sh @ ${p.avg_cost} (now ${price}), value ${value}, "
                     f"weight {weight:.1f}%, unrealized P&L ${upnl}")
    realized = ledger.snapshot(db).realized_pnl
    lines.append(f"Realized P&L to date: ${realized}")
    return "\n".join(lines)


def _upside(price, target: float | None) -> float | None:
    """% de recorrido hasta el objetivo del LLM (None si falta dato)."""
    if price is None or not target:
        return None
    p = float(price)
    return round((target / p - 1) * 100, 1) if p else None


def build_trades(db: Session, construction, held: dict, price_map: dict,
                 score_map: dict, target_map: dict) -> list[dict]:
    """Diff cartera objetivo vs actual → items con acción y aritmética exacta (Decimal)."""
    cash, equity = _equity(db, held, price_map)
    target = {p.ticker: p for p in construction.positions}
    items: list[dict] = []

    for tp in construction.positions:
        price = D(price_map[tp.ticker]) if price_map.get(tp.ticker) else None
        tgt_value = to_cents(equity * D(tp.weight_pct) / 100)
        cur = held.get(tp.ticker)
        cur_shares = cur.quantity if cur else ZERO
        cur_value = to_cents(cur_shares * price) if (cur and price) else ZERO
        # Acciones a 4 decimales redondeando HACIA ABAJO: el coste nunca supera el slice
        # (comprar 1.243 cuando 1.2425 caben sería sobrepasar el objetivo → fallo de céntimos).
        tgt_shares = ((tgt_value / price).quantize(Decimal("0.0001"), rounding=ROUND_DOWN)
                      if price else ZERO)
        delta = tgt_shares - cur_shares
        if cur is None:
            action = "comprar"
        elif tgt_value > cur_value * D("1.05"):
            action = "ampliar"
        elif tgt_value < cur_value * D("0.95"):
            action = "recortar"
        else:
            action = "mantener"
        items.append({
            "ticker": tp.ticker, "action": action, "score": score_map.get(tp.ticker),
            "target_weight_pct": tp.weight_pct, "price": str(price) if price else None,
            "target_price": target_map.get(tp.ticker),
            "upside_pct": _upside(price, target_map.get(tp.ticker)),
            "target_value": str(tgt_value), "target_shares": float(tgt_shares),
            "delta_shares": float(delta),
            "thesis": tp.thesis, "edge": tp.edge, "risk": tp.risk,
        })

    # Posiciones actuales que NO están en la cartera objetivo → vender.
    for tk, p in held.items():
        if tk in target:
            continue
        price = D(price_map[tk]) if price_map.get(tk) else p.avg_cost
        items.append({
            "ticker": tk, "action": "vender", "score": score_map.get(tk),
            "target_weight_pct": 0.0, "price": str(price),
            "target_price": target_map.get(tk), "upside_pct": _upside(price, target_map.get(tk)),
            "target_value": "0", "target_shares": 0.0,
            "delta_shares": round(float(-p.quantity), 3),
            "thesis": "Sale de la cartera objetivo.", "edge": "", "risk": "",
        })
    return items
