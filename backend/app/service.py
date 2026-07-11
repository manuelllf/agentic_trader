"""Orquestación del escaneo (ranker fundamental híbrido, método whitepaper DeepSeek).

Embudo en 2 pasos para ir rápido y barato sin perder profundidad donde importa:
  1. muestra 250 = posiciones (siempre) + watchlist + relleno random del universo ≥$3B
  2. outlook macro forward (1 llamada V4-Pro)
  3. PASO 1 — pre-score RÁPIDO (Flash) de los 250 en paralelo → ranking 1-100
  4. PASO 2 — informe PROFUNDO (V4-Pro) + price target solo en el top ~20 finalistas
  5. actualiza la watchlist; persiste scores (leaderboard: los 250; informe en los finalistas)
  6. SELECCIÓN fiel al paper (código): top-N por score PROFUNDO, desempate por market cap →
     el constructor (V4-Pro) solo ASIGNA PESOS a los ya seleccionados (Exhibit 2E)
  7. traduce a trades con aritmética EXACTA (Decimal, nunca el LLM) + persiste la propuesta

El dinero lo calcula el código; el LLM solo decide los pesos. El coste REAL de cada
escaneo (Flash prescoring de todo el universo + V4-Pro en finalistas, incl. tokens de razonamiento)
se acumula desde el `usage` de OpenRouter y se devuelve en result["cost"] — ~$0.3-0.5/escaneo full.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from decimal import ROUND_DOWN, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import constructor as constructor_mod
from app.agents import scorer as scorer_mod
from app.config import settings
from app.ledger import service as ledger
from app.ledger.money import D, to_cents
from app.llm import get_llm
from app.models import BOOK_SHADOW, Proposal, Score
from app.screener import fundamentals as fund_mod
from app.screener import macro as macro_mod
from app.screener import universe as universe_mod
from app import watchlist as watchlist_mod

logger = logging.getLogger(__name__)

_MAX_WORKERS = 12
ZERO = Decimal("0")


def _memory_store():
    """Singleton de memoria vectorial; None si faltan deps o falla (es una mejora, no requisito)."""
    try:
        from app import memory
        return memory.get_store()
    except Exception:
        logger.warning("Memoria vectorial no disponible — se omite.")
        return None


def _llm_usage(*llms) -> dict:
    """Suma el uso (llamadas/tokens/coste) de varios proveedores. Tolera FakeLLM (sin `usage`)."""
    total = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0}
    for llm in llms:
        u = getattr(llm, "usage", None)
        if isinstance(u, dict):
            for k in total:
                total[k] += u.get(k, 0)
    total["cost_usd"] = round(total["cost_usd"], 4)
    return total


def _select(rows: list, mcap: dict, floor: int, n: int) -> list:
    """Selección FIEL al paper: top-N por score, desempate por MARKET CAP (mayor gana).

    `rows` = objetos con `.ticker` y `.score` (ScoreResult del escaneo o Score de la BD).
    Filtra por el suelo de score solo si `floor` > 0.
    """
    eligible = [r for r in rows if r.score >= floor]
    eligible.sort(key=lambda r: (-r.score, -(mcap.get(r.ticker) or 0.0)))
    return eligible[:n]


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


def _finalize_full_invest(construction, selected: list, min_pos: int, max_pos: int, cap: float):
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
    for p, w in zip(funded, weights):
        p.weight_pct = w
    construction.positions = funded
    construction.cash_pct = round(max(0.0, 100.0 - sum(weights)), 2)
    return construction


def _recall(store, ticker: str, hint: str) -> str | None:
    """Recuerdos semánticos previos de un ticker (para inyectar en su informe profundo)."""
    try:
        mems = store.recall(f"{ticker} {hint}", k=3, ticker=ticker)
        return " | ".join(m.text for m in mems) or None
    except Exception:
        return None


def run_scan_and_store(db: Session, sample_size: int | None = None) -> dict:
    """Escaneo en 2 pasos (pre-score rápido → profundo en finalistas). Persiste y resume."""
    deep_llm = get_llm()                              # V4-Pro: informe + target + construcción
    prescore_llm = get_llm(settings.prescore_model)   # Flash: ranking rápido de toda la muestra
    # sample_size explícito (pruebas) manda; si no, TODO el universo salvo que se desactive.
    if sample_size is not None:
        n = sample_size
    elif settings.scan_full_universe:
        n = None                                      # None = universo entero
    else:
        n = settings.scan_sample_size

    # 1) Muestra: posiciones + watchlist (siempre) + relleno random.
    held = {p.ticker: p for p in ledger.open_positions(db)}
    watch = set(watchlist_mod.tickers(db))
    always = list(held.keys()) + [t for t in watch if t not in held]
    sample = universe_mod.sample_for_scan(always, n)

    # 2) Outlook macro forward (V4-Pro, 1 llamada).
    macro = macro_mod.get_macro_outlook(deep_llm)
    macro_block = macro_mod.outlook_prompt_block(macro)
    prior = {t: watchlist_mod.thesis_for(db, t) for t in always}

    # 3) PASO 1 — pre-score rápido (Flash) de toda la muestra, en paralelo.
    def _pre(ticker: str):
        data = fund_mod.gather(ticker)
        if data is None:
            return None
        return scorer_mod.prescore(prescore_llm, data, macro_block), data

    prescored: list[tuple[scorer_mod.PrescoreResult, fund_mod.NameData]] = []
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as ex:
        for out in ex.map(_pre, sample):
            if out is not None and out[0].score > 0:
                prescored.append(out)
    prescored.sort(key=lambda x: -x[0].score)

    # Finalistas al profundo = top N por pre-score + top-K watchlist + posiciones (acotado).
    data_by_t = {d.ticker: d for _p, d in prescored}
    top_pre = [p.ticker for p, _d in prescored[: settings.deep_finalists]]
    wl_top = [t for t in watchlist_mod.top(db, settings.deep_watchlist) if t in data_by_t]
    held_present = [t for t in held if t in data_by_t]
    finalists = list(dict.fromkeys(top_pre + wl_top + held_present))

    # 4) PASO 2 — informe PROFUNDO (V4-Pro) + price target solo en los finalistas.
    # Memoria vectorial: recall EN EL HILO PRINCIPAL (sqlite no es thread-safe entre workers).
    store = _memory_store()
    mem_by_t = {t: _recall(store, t, data_by_t[t].sector) for t in finalists} if store else {}

    def _deep(ticker: str):
        extra = "\n".join(x for x in (prior.get(ticker), mem_by_t.get(ticker)) if x) or None
        return scorer_mod.score(deep_llm, data_by_t[ticker], macro_block, extra)

    deep: dict[str, scorer_mod.ScoreResult] = {}
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as ex:
        for res in ex.map(_deep, finalists):
            deep[res.ticker] = res

    price_map = {d.ticker: d.price for _p, d in prescored if d.price}
    mcap_map = {t: (data_by_t[t].market_cap or 0.0) for t in deep}
    # score_map: deep (int) para finalistas; prescore redondeado para el resto (watchlist/display).
    # El CORTE de finalistas usa el prescore decimal fino (prescored ya está ordenado por él).
    score_map = {p.ticker: (deep[p.ticker].score if p.ticker in deep else int(round(p.score)))
                 for p, _d in prescored}
    target_map = {t: r.target_price for t, r in deep.items()}

    # 5) Persistir scores (leaderboard: pre-score de todos + informe/target en los finalistas).
    db.query(Score).delete()
    db.query(Proposal).delete()
    for ticker, d in deep.items():   # solo los ANALIZADOS A FONDO (con informe) van al leaderboard
        data = data_by_t[ticker]
        db.add(Score(
            ticker=ticker, sector=data.sector, score=d.score,
            headline=d.headline, report=d.report,
            price=data.price, market_cap=data.market_cap, target_price=d.target_price,
            held=ticker in held, on_watchlist=ticker in watch,
        ))
    db.commit()
    if store:                                      # guarda las tesis nuevas para recordarlas luego
        for t, d in deep.items():
            try:
                store.remember(f"{d.headline} {d.report[:400]}", kind="thesis", ticker=t)
            except Exception:
                pass
    watchlist_mod.update(db, [(p.ticker, score_map[p.ticker],
                               (deep[p.ticker].headline if p.ticker in deep else p.headline))
                              for p, _d in prescored])

    # 6) SELECCIÓN fiel al paper: top-N por SCORE PROFUNDO, desempate por MARKET CAP.
    #    (La convicción del constructor solo pondera; no re-selecciona.)
    selected = _select(list(deep.values()), mcap_map, settings.min_buy_score, settings.max_positions)
    portfolio_text = _portfolio_text(db, held, price_map)
    if not selected and not held:
        floor = settings.min_buy_score
        reason = (f"Ningún finalista alcanza el suelo de score ({floor})" if floor > 0
                  else "No se analizó ningún nombre")
        construction = constructor_mod.ConstructionResult(
            cash_pct=100.0, positions=[], summary=f"{reason} — 100% en caja.",
        )
    else:
        candidates_text = "\n".join(
            f"- {r.ticker} ({data_by_t[r.ticker].sector}) score={r.score}, "
            f"cap ${(mcap_map.get(r.ticker, 0.0) / 1e9):.1f}B: {r.headline}"
            for r in selected
        ) or "(sin candidatos)"
        valid = {r.ticker for r in selected}
        construction = constructor_mod.construct(
            deep_llm, portfolio_text, candidates_text, macro_block,
            settings.max_positions, settings.max_position_pct, valid, settings.min_positions,
        )
        construction = _finalize_full_invest(
            construction, selected, settings.min_positions, settings.max_positions,
            settings.max_position_pct)

    # 7) Trades con aritmética exacta + persistir la propuesta.
    items = _build_trades(db, construction, held, price_map, score_map, target_map)
    macro_line = macro.get("outlook", "") or construction.summary
    db.add(Proposal(
        cash_target_pct=construction.cash_pct,
        macro_summary=macro_line,
        items=items,
    ))
    db.commit()

    # 8) Sala Sombra: se ejecuta SOLA, sin botones — dinero simulado, cero riesgo. Ventas antes
    #    que compras (execute_proposal_all lo garantiza) para que la caja se libere primero.
    #    Un fallo aquí NUNCA debe tirar el escaneo (los datos ya están persistidos y a salvo).
    try:
        exec_result = execute_proposal_all(db)
        logger.info("Auto-ejecución sombra: %s", exec_result["message"])
    except Exception:
        logger.exception("Fallo en la auto-ejecución del libro sombra (no aborta el escaneo).")

    # 9) Sala Real: cada trade propuesto queda PENDIENTE de tu Sí/No (push best-effort).
    #    El agente jamás ejecuta solo — ni siquiera en dry-run.
    try:
        from app import approvals as approvals_mod
        approvals_mod.create_from_items(db, items, macro_line)
    except Exception:
        logger.exception("No se pudieron crear las aprobaciones del modo real.")

    return {
        "scanned": len(sample), "prescored": len(prescored), "deep": len(deep),
        "watchlist": len(watchlist_mod.tickers(db)),
        "proposed": len([i for i in items if i["action"] != "mantener"]),
        "positions": len(construction.positions),
        "cost": _llm_usage(prescore_llm, deep_llm),  # coste REAL del escaneo (Flash + V4-Pro)
    }


def recheck(db: Session) -> dict:
    """Re-comprobación del top: re-corre SOLO la construcción sobre los nombres ya analizados a
    fondo (report != ''), reutilizando sus informes/scores/targets guardados y aplicando el suelo
    ACTUAL. No re-escanea el universo → instantáneo y casi gratis (1 llamada de construcción)."""
    llm = get_llm()
    deep = (db.query(Score).filter(Score.report != "").order_by(Score.score.desc()).all())
    if not deep:
        raise ValueError("No hay análisis profundo previo; lanza un escaneo primero.")

    floor = settings.min_buy_score
    held = {p.ticker: p for p in ledger.open_positions(db)}
    price_map = {r.ticker: r.price for r in deep if r.price}
    mcap_map = {r.ticker: (r.market_cap or 0.0) for r in deep}
    score_map = {r.ticker: r.score for r in deep}
    target_map = {r.ticker: r.target_price for r in deep}
    # Misma selección fiel al paper: top-N por score, desempate por market cap.
    selected = _select(deep, mcap_map, floor, settings.max_positions)
    last = db.query(Proposal).order_by(Proposal.created_at.desc()).first()
    macro_block = (last.macro_summary if last else "") or "n/d"
    portfolio_text = _portfolio_text(db, held, price_map)

    if not selected and not held:
        reason = (f"Ningún nombre del top alcanza el suelo ({floor})" if floor > 0
                  else "No hay nombres analizados")
        construction = constructor_mod.ConstructionResult(
            cash_pct=100.0, positions=[], summary=f"{reason} — 100% en caja.")
    else:
        candidates_text = "\n".join(
            f"- {r.ticker} ({r.sector}) score={r.score}, "
            f"cap ${(mcap_map.get(r.ticker, 0.0) / 1e9):.1f}B: {r.headline}" for r in selected)
        valid = {r.ticker for r in selected}
        construction = constructor_mod.construct(
            llm, portfolio_text, candidates_text, macro_block,
            settings.max_positions, settings.max_position_pct, valid, settings.min_positions)
        construction = _finalize_full_invest(
            construction, selected, settings.min_positions, settings.max_positions,
            settings.max_position_pct)

    items = _build_trades(db, construction, held, price_map, score_map, target_map)
    db.query(Proposal).delete()
    db.add(Proposal(cash_target_pct=construction.cash_pct,
                    macro_summary=macro_block, items=items))
    db.commit()
    try:
        from app import approvals as approvals_mod
        approvals_mod.create_from_items(db, items, macro_block)
    except Exception:
        logger.exception("No se pudieron crear las aprobaciones del modo real.")
    return {"eligible": len(selected), "positions": len(construction.positions),
            "proposed": len([i for i in items if i["action"] != "mantener"]),
            "cost": _llm_usage(llm)}  # coste de la re-comprobación (1 llamada de construcción)


def redeep(db: Session) -> dict:
    """Re-analiza a FONDO (V4-Pro) solo los nombres ya profundizados, con el MACRO ACTUAL.

    Reutiliza el prescore del universo (NO re-escanea los ~1.400) → barato y rápido. Se usa
    cuando se corrige un dato macro y hay que refrescar las notas sin repetir el escaneo entero.
    Re-puntúa limpio (sin inyectar la tesis previa, que se generó con el dato malo).
    """
    deep_rows = db.query(Score).filter(Score.report != "").all()
    if not deep_rows:
        raise ValueError("No hay análisis profundo previo; lanza un escaneo primero.")
    tickers = [r.ticker for r in deep_rows]
    held = {p.ticker: p for p in ledger.open_positions(db)}
    watch = set(watchlist_mod.tickers(db))

    deep_llm = get_llm()
    macro = macro_mod.get_macro_outlook(deep_llm)            # macro FRESCO (con el fix vivo)
    macro_block = macro_mod.outlook_prompt_block(macro)

    def _one(ticker: str):
        data = fund_mod.gather(ticker)
        if data is None:
            return None
        return data, scorer_mod.score(deep_llm, data, macro_block)   # re-eval limpia, sin prior

    data_by_t: dict = {}
    results: dict = {}
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as ex:
        for out in ex.map(_one, tickers):
            if out is not None:
                data, res = out
                data_by_t[res.ticker] = data
                results[res.ticker] = res

    db.query(Score).delete()
    db.query(Proposal).delete()
    for t, r in results.items():
        d = data_by_t[t]
        db.add(Score(ticker=t, sector=d.sector, score=r.score, headline=r.headline,
                     report=r.report, price=d.price, market_cap=d.market_cap,
                     target_price=r.target_price, held=t in held, on_watchlist=t in watch))
    db.commit()

    mcap_map = {t: (data_by_t[t].market_cap or 0.0) for t in results}
    price_map = {t: data_by_t[t].price for t in results if data_by_t[t].price}
    score_map = {t: r.score for t, r in results.items()}
    target_map = {t: r.target_price for t, r in results.items()}
    selected = _select(list(results.values()), mcap_map, settings.min_buy_score, settings.max_positions)
    portfolio_text = _portfolio_text(db, held, price_map)
    if not selected and not held:
        construction = constructor_mod.ConstructionResult(
            cash_pct=100.0, positions=[], summary="Sin candidatos tras re-análisis — 100% caja.")
    else:
        candidates_text = "\n".join(
            f"- {r.ticker} ({data_by_t[r.ticker].sector}) score={r.score}, "
            f"cap ${(mcap_map.get(r.ticker, 0.0) / 1e9):.1f}B: {r.headline}" for r in selected)
        valid = {r.ticker for r in selected}
        construction = constructor_mod.construct(
            deep_llm, portfolio_text, candidates_text, macro_block,
            settings.max_positions, settings.max_position_pct, valid, settings.min_positions)
        construction = _finalize_full_invest(
            construction, selected, settings.min_positions, settings.max_positions,
            settings.max_position_pct)

    items = _build_trades(db, construction, held, price_map, score_map, target_map)
    macro_line = macro.get("outlook", "") or construction.summary
    db.add(Proposal(cash_target_pct=construction.cash_pct, macro_summary=macro_line, items=items))
    db.commit()
    try:
        from app import approvals as approvals_mod
        approvals_mod.create_from_items(db, items, macro_line)
    except Exception:
        logger.exception("No se pudieron crear las aprobaciones del modo real.")
    return {"redeep": len(results), "positions": len(construction.positions),
            "proposed": len([i for i in items if i["action"] != "mantener"]),
            "cost": _llm_usage(deep_llm)}


def _equity(db: Session, held: dict, price_map: dict) -> tuple[Decimal, Decimal]:
    """(cash, equity) usando precios actuales; cae al coste medio si falta precio."""
    cash = ledger.available_cash(db)
    pos_value = ZERO
    for tk, p in held.items():
        price = D(price_map[tk]) if price_map.get(tk) else p.avg_cost
        pos_value += p.quantity * price
    return cash, to_cents(cash + pos_value)


def _portfolio_text(db: Session, held: dict, price_map: dict) -> str:
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


def _build_trades(db: Session, construction, held: dict, price_map: dict,
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
        tgt_shares = (tgt_value / price).quantize(Decimal("0.0001"), rounding=ROUND_DOWN) if price else ZERO
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


def _latest_proposal(db: Session) -> Proposal | None:
    return db.scalars(select(Proposal).order_by(Proposal.id.desc())).first()


def execute_proposal_item(db: Session, ticker: str) -> dict:
    """Ejecuta UN item de la última propuesta en el LIBRO SOMBRA (simulado, sin dinero real).

    Es el backend del botón «Comprar/Vender» de la Sala Sombra: dimensiona el tamaño al peso
    objetivo con el sizing cent-exacto compartido (nunca sobrepasa la caja) y lo registra a
    precio VIVO. Idempotente: reintentar una compra ya cubierta devuelve un error claro.
    """
    from app import tracking

    prop = _latest_proposal(db)
    if prop is None:
        raise LookupError("No hay ninguna propuesta que ejecutar.")
    item = next((it for it in (prop.items or []) if it.get("ticker") == ticker), None)
    if item is None:
        raise LookupError(f"{ticker} no está en la propuesta actual.")
    action = item.get("action")
    if action in (None, "", "mantener"):
        raise ValueError(f"{ticker}: «{action or 'sin acción'}» no es ejecutable.")

    prices = tracking.live_prices([ticker])
    price = (D(prices[ticker]) if ticker in prices
             else D(item["price"]) if item.get("price") else None)
    if price is None:
        raise ValueError(f"Sin precio de mercado para {ticker}.")

    qty, side = ledger.size_to_weight(
        db, BOOK_SHADOW, ticker, action, item.get("target_weight_pct") or 0.0, price)
    ref = f"shadow-prop{prop.id}"
    if side == "buy":
        ledger.record_buy(db, ticker, qty, price, ref, book=BOOK_SHADOW)
    else:
        ledger.record_sell(db, ticker, qty, price, ref, book=BOOK_SHADOW)

    verb = "Compra" if side == "buy" else "Venta"
    return {
        "ok": True, "ticker": ticker, "side": side,
        "quantity": str(qty), "price": str(to_cents(price)),
        "message": f"{verb} {qty} {ticker} @ ${to_cents(price)} (sombra).",
    }


_SELL_ACTIONS = {"vender", "recortar"}  # las que liberan caja; deben ir antes que las compras


def execute_proposal_all(db: Session) -> dict:
    """Ejecuta TODOS los items accionables de la última propuesta en el libro sombra.

    Orden EXPLÍCITO (no el de la propuesta, que depende del LLM): ventas/recortes primero para
    liberar caja, compras/ampliaciones después — así una compra nunca falla por falta de caja
    que una venta de la MISMA propuesta iba a liberar. Best-effort: los que no caben o ya están
    cubiertos se saltan y se reportan; no aborta el resto. Idempotente (ver `execute_proposal_item`
    y `size_to_weight`: reintentar un item ya al objetivo cae en `skipped`, no revienta).
    """
    prop = _latest_proposal(db)
    if prop is None:
        raise LookupError("No hay ninguna propuesta que ejecutar.")
    actionable = [it for it in (prop.items or []) if it.get("action") not in (None, "", "mantener")]
    actionable.sort(key=lambda it: 0 if it.get("action") in _SELL_ACTIONS else 1)
    done, skipped = [], []
    for it in actionable:
        try:
            res = execute_proposal_item(db, it["ticker"])
            done.append(res["message"])
        except Exception as exc:  # noqa: BLE001 — el motivo debe llegar al panel
            skipped.append(f"{it['ticker']}: {exc}")
    return {"ok": True, "executed": done, "skipped": skipped,
            "message": f"{len(done)} ejecutada(s), {len(skipped)} saltada(s)."}
