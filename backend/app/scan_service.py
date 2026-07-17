"""Orquestación del escaneo (ranker fundamental híbrido, método whitepaper DeepSeek).

Embudo en 2 pasos para ir rápido y barato sin perder profundidad donde importa:
  1. universo ENTERO (~1.400 nombres ≥$3B del screener de NASDAQ) — posiciones y watchlist
     siempre dentro; muestra random de N solo si se desactiva `scan_full_universe` (o en tests)
  2. outlook macro forward (1 llamada V4-Pro)
  3. PASO 1 — pre-score RÁPIDO (Flash) de todo el universo en paralelo → ranking 1-100
  4. PASO 2 — informe PROFUNDO (V4-Pro) + price target solo en el top ~20 finalistas
  5. actualiza la watchlist (con el pre-score de todos); el leaderboard persiste SOLO los
     analizados a fondo
  6. SELECCIÓN fiel al paper (código): top-N por score PROFUNDO, desempate por market cap →
     el constructor (V4-Pro) solo ASIGNA PESOS a los ya seleccionados (Exhibit 2E)
  7. traduce a trades con aritmética EXACTA (Decimal, nunca el LLM) + persiste la propuesta

El dinero lo calcula el código; el LLM solo decide los pesos. El coste REAL de cada
escaneo (Flash prescoring de todo el universo + V4-Pro en finalistas, incl. tokens de razonamiento)
se acumula desde el `usage` de OpenRouter y se devuelve en result["cost"] — ~$0.3-0.5/escaneo full.

Este módulo solo ORQUESTA. La matemática de cartera (selección, pesos, diff a trades) vive en
`app.portfolio_service`; la ejecución del libro sombra, en `app.execution_service`.
"""

from __future__ import annotations

import logging
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.orm import Session

from app import execution_service, scan_audit
from app import instruments as instruments_mod
from app import portfolio_service as portfolio
from app import watchlist as watchlist_mod
from app.agents import constructor as constructor_mod
from app.agents import scorer as scorer_mod
from app.config import settings
from app.ledger import service as ledger
from app.llm import get_llm
from app.models import Meta, Proposal, Score
from app.screener import fundamentals as fund_mod
from app.screener import macro as macro_mod
from app.screener import universe as universe_mod

logger = logging.getLogger(__name__)

_MAX_WORKERS = 12
_CURSOR_KEY = "scan_cursor"   # offset persistido de la ventana rotatoria del semanal


def _scan_cursor(db: Session) -> int:
    """Offset actual de la ventana rotatoria (0 si aún no existe o está corrupto)."""
    row = db.get(Meta, _CURSOR_KEY)
    try:
        return int(row.value) if row else 0
    except (TypeError, ValueError):
        return 0


def _advance_scan_cursor(db: Session, step: int) -> None:
    """Avanza el offset `step` posiciones para que el próximo semanal teja el siguiente tramo."""
    row = db.get(Meta, _CURSOR_KEY)
    if row:
        row.value = str(_scan_cursor(db) + step)
    else:
        db.add(Meta(key=_CURSOR_KEY, value=str(step)))
    db.commit()


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


def _recall(store, ticker: str, hint: str) -> str | None:
    """Recuerdos semánticos previos de un ticker (para inyectar en su informe profundo)."""
    try:
        mems = store.recall(f"{ticker} {hint}", k=3, ticker=ticker)
        return " | ".join(m.text for m in mems) or None
    except Exception:
        return None


def _sector(data_by_t: dict, ticker: str) -> str:
    """Sector de un ticker (o 'UCITS' si es un instrumento del allowlist, que no se puntúa)."""
    d = data_by_t.get(ticker)
    return d.sector if d else "UCITS"


def _log_funnel(cadence: str, sample: list, prescored: list, failed: list, finalists: list,
                data_by_t: dict, selected: list, construction, instr_prices: dict) -> None:
    """Traza legible del embudo en los logs (Railway/consola): permite ver de un vistazo que el
    corte ya no colapsa en un sector, y si algo va raro saber en qué paso. Best-effort."""
    try:
        def top(counter: Counter, k: int = 6) -> str:
            return ", ".join(f"{s}:{n}" for s, n in counter.most_common(k)) or "n/d"

        fin_sectors = Counter(_sector(data_by_t, t) for t in finalists)
        logger.info("── EMBUDO (%s) ──────────────────────────────", cadence)
        logger.info("  muestra=%d · pre-scoreados=%d · sin datos=%d · finalistas=%d en %d sectores",
                    len(sample), len(prescored), len(failed), len(finalists), len(fin_sectors))
        logger.info("  pre-score por sector: %s", top(Counter(d.sector for _p, d in prescored)))
        logger.info("  finalistas por sector: %s", top(fin_sectors))
        sel = ", ".join(f"{r.ticker}[{_sector(data_by_t, r.ticker)}]={r.score}" for r in selected)
        logger.info("  seleccionados (top-%d): %s", len(selected), sel or "ninguno")
        cartera = ", ".join(f"{p.ticker} {p.weight_pct:.0f}%[{_sector(data_by_t, p.ticker)}]"
                            for p in construction.positions) or "vacía"
        logger.info("  CARTERA: %s", cartera)
        if instr_prices:
            usados = [p.ticker for p in construction.positions if p.ticker in instr_prices]
            logger.info("  UCITS disponibles=%d · usados=%s", len(instr_prices), usados or "—")
        logger.info("──────────────────────────────────────────────")
    except Exception:
        logger.exception("No se pudo emitir la traza del embudo (no aborta el escaneo).")


def run_scan_and_store(db: Session, sample_size: int | None = None,
                       real_proposals: bool = True) -> dict:
    """Escaneo en 2 pasos (pre-score rápido → profundo en finalistas). Persiste y resume.

    `real_proposals`: si False, el escaneo recalibra SOLO la sombra (scores + propuesta +
    auto-ejecución) sin crear aprobaciones para la sala real — es el modo del cron semanal
    entre calibrados mensuales de la real (ver `real_proposals_monthly` en config).
    """
    deep_llm = get_llm()                              # V4-Pro: informe + target + construcción
    prescore_llm = get_llm(settings.prescore_model)   # Flash: ranking rápido de todo el universo
    # sample_size explícito (pruebas) manda; si no, TODO el universo salvo que se desactive.
    if sample_size is not None:
        n = sample_size
    elif settings.scan_full_universe:
        n = None                                      # None = universo entero
    else:
        n = settings.scan_sample_size

    # 1) Nombres a analizar: posiciones + watchlist (siempre) + el universo (entero por defecto).
    held = {p.ticker: p for p in ledger.open_positions(db)}
    watch = set(watchlist_mod.tickers(db))
    always = list(held.keys()) + [t for t in watch if t not in held]
    # Muestra semanal = ventana ROTATORIA (offset persistido) para tejer el universo sin repetir;
    # el mensual (n=None) coge el universo entero y no mueve el cursor.
    sample = universe_mod.sample_for_scan(always, n, _scan_cursor(db))
    if n is not None:
        _advance_scan_cursor(db, n)

    # 2) Outlook macro forward (V4-Pro, 1 llamada).
    macro = macro_mod.get_macro_outlook(deep_llm)
    macro_block = macro_mod.outlook_prompt_block(macro)
    prior = {t: watchlist_mod.thesis_for(db, t) for t in always}

    # 3) PASO 1 — pre-score rápido (Flash) de todos los nombres, en paralelo.
    def _pre(ticker: str):
        data = fund_mod.gather(ticker)
        if data is None:
            return None
        return scorer_mod.prescore(prescore_llm, data, macro_block), data

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as ex:
        results = list(ex.map(_pre, sample))          # orden preservado → zip con `sample`
    prescored = [r for r in results if r is not None and r[0].score > 0]
    prescored.sort(key=lambda x: -x[0].score)
    failed = [t for t, r in zip(sample, results, strict=True) if r is None]  # gather sin datos

    # Finalistas al profundo: top-2/sector (amplitud) ∪ top-15 global + posiciones + watchlist,
    # truncado a un tope duro. El corte YA NO es ciego al macro (el prescore lo ve entero), así
    # que deja de colapsar en defensivo-value.
    data_by_t = {d.ticker: d for _p, d in prescored}
    finalists = portfolio.select_finalists(
        prescored, set(held), watchlist_mod.top(db, settings.deep_watchlist),
        settings.deep_per_sector, settings.deep_finalists, settings.deep_finalists_cap,
        top_caps=settings.deep_top_caps)

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
    instr_prices = instruments_mod.prices()        # {} si el allowlist UCITS está vacío
    price_map.update(instr_prices)
    mcap_map = {t: (data_by_t[t].market_cap or 0.0) for t in deep}
    # score_map: deep (int) para finalistas; prescore redondeado para el resto (watchlist/display).
    # El CORTE de finalistas usa el prescore decimal fino (prescored ya está ordenado por él).
    score_map = {p.ticker: (deep[p.ticker].score if p.ticker in deep else int(round(p.score)))
                 for p, _d in prescored}
    target_map = {t: r.target_price for t, r in deep.items()}

    # 5) Persistir el leaderboard: SOLO los analizados a fondo (el pre-score vive en la watchlist).
    db.query(Score).delete()
    db.query(Proposal).delete()
    for ticker, d in deep.items():
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
    # A la watchlist SOLO entran scores PROFUNDOS: los pre-scores de Flash no están verificados
    # (calibran mal) y contaminaban la memoria entre escaneos con notas infladas.
    watchlist_mod.update(db, [(t, r.score, r.headline) for t, r in deep.items()])

    # 6) SELECCIÓN fiel al paper: top-N por SCORE PROFUNDO, desempate por MARKET CAP.
    #    (La convicción del constructor solo pondera; no re-selecciona.)
    selected = portfolio.select_top(
        list(deep.values()), mcap_map, settings.min_buy_score, settings.select_count)
    portfolio_text = portfolio.portfolio_text(db, held, price_map)
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
        candidates_text += instruments_mod.prompt_block(instr_prices)  # UCITS ('' si vacío)
        valid = {r.ticker for r in selected} | set(instr_prices)
        construction = constructor_mod.construct(
            deep_llm, portfolio_text, candidates_text, macro_block,
            settings.max_positions, settings.max_position_pct, valid, settings.min_positions,
        )
        construction = portfolio.finalize_full_invest(
            construction, selected, settings.min_positions, settings.max_positions,
            settings.max_position_pct)

    # 7) Trades con aritmética exacta + persistir la propuesta.
    items = portfolio.build_trades(db, construction, held, price_map, score_map, target_map)
    macro_line = macro.get("outlook", "") or construction.summary
    db.add(Proposal(
        cash_target_pct=construction.cash_pct,
        macro_summary=macro_line,
        items=items,
    ))
    db.commit()

    # Traza de auditoría del embudo (diagnóstico; nunca debe tirar el escaneo).
    try:
        scan_audit.record(db, prescored=prescored, failed=failed, finalists=finalists,
                          deep=deep, selected=selected, construction=construction)
    except Exception:
        logger.exception("No se pudo escribir la traza de auditoría (no aborta el escaneo).")

    cadence = "mensual/full" if n is None else f"semanal/muestra {n}"
    _log_funnel(cadence, sample, prescored, failed, finalists, data_by_t, selected,
                construction, instr_prices)

    # 8) Sala Sombra: se ejecuta SOLA, sin botones — dinero simulado, cero riesgo. Ventas antes
    #    que compras (execute_proposal_all lo garantiza) para que la caja se libere primero.
    #    Un fallo aquí NUNCA debe tirar el escaneo (los datos ya están persistidos y a salvo).
    try:
        exec_result = execution_service.execute_proposal_all(db)
        logger.info("Auto-ejecución sombra: %s", exec_result["message"])
    except Exception:
        logger.exception("Fallo en la auto-ejecución del libro sombra (no aborta el escaneo).")

    # 9) Sala Real: cada trade propuesto queda PENDIENTE de tu Sí/No (push best-effort).
    #    El agente jamás ejecuta solo — ni siquiera en dry-run. En los escaneos de recalibrado
    #    sombra (cadencia real mensual) este paso se omite entero.
    if real_proposals:
        try:
            from app import approvals as approvals_mod
            approvals_mod.create_from_items(db, items, macro_line)
        except Exception:
            logger.exception("No se pudieron crear las aprobaciones del modo real.")
    else:
        logger.info("Recalibrado sombra: sin propuestas para la sala real (cadencia mensual).")

    return {
        "scanned": len(sample), "prescored": len(prescored), "deep": len(deep),
        "watchlist": len(watchlist_mod.tickers(db)),
        "proposed": len([i for i in items if i["action"] != "mantener"]),
        "positions": len(construction.positions),
        "real_proposals": real_proposals,
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
    selected = portfolio.select_top(deep, mcap_map, floor, settings.select_count)
    last = db.query(Proposal).order_by(Proposal.created_at.desc()).first()
    macro_block = (last.macro_summary if last else "") or "n/d"
    portfolio_text = portfolio.portfolio_text(db, held, price_map)

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
        construction = portfolio.finalize_full_invest(
            construction, selected, settings.min_positions, settings.max_positions,
            settings.max_position_pct)

    items = portfolio.build_trades(db, construction, held, price_map, score_map, target_map)
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
    macro = macro_mod.get_macro_outlook(deep_llm)            # macro recién calculado
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
    selected = portfolio.select_top(
        list(results.values()), mcap_map, settings.min_buy_score, settings.select_count)
    portfolio_text = portfolio.portfolio_text(db, held, price_map)
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
        construction = portfolio.finalize_full_invest(
            construction, selected, settings.min_positions, settings.max_positions,
            settings.max_position_pct)

    items = portfolio.build_trades(db, construction, held, price_map, score_map, target_map)
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
