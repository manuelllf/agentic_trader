"""Guardarraíles en código sobre lo que dice el LLM (OPA en curso, cartera rellenada por score
sin convicción) más la traza legible del embudo en los logs — nada de esto pertenece al prompt:
son cosas que el modelo ya falló una vez y que el código verifica siempre, no solo cuando el
prompt se acuerda."""
from __future__ import annotations

import logging
from collections import Counter

from app import portfolio_service as portfolio
from app.agents import constructor as constructor_mod
from app.agents import scorer as scorer_mod
from app.scan_persist import _sector

logger = logging.getLogger(__name__)


def _lista(ts: list[str], n: int = 10) -> str:
    """Lista de tickers legible y acotada: 'A, B, C y 4 más'."""
    return ", ".join(ts[:n]) + (f" y {len(ts) - n} más" if len(ts) > n else "")


def _aparta_opadas(rows: list, issues: list[str]) -> list:
    """Quita de la selección las empresas que el informe declara OPADAS (`under_acquisition`).

    Con una oferta en efectivo sobre la mesa el precio queda clavado a ella: lo que queda por
    ganar es el hueco hasta el cierre (caso real: ATKR cotizaba a 93,69 con oferta de 95 — un 1,4%)
    a cambio de un riesgo binario de que la operación se caiga. No es la asimetría que busca la
    estrategia, y el modelo le ponía 85 sobre 100 porque lee "incertidumbre eliminada" como algo
    bueno. La fila del Score se queda con su nota y su informe: se aparta de la cartera, no se
    borra de la traza.

    `under_acquisition` a None NO es un "no": es que el modelo se saltó el campo (pasa en ~1 de
    cada 10 respuestas de los modelos rápidos). Se avisa en vez de asumir, porque asumir el "no"
    desactivaría el guardarraíl justo cuando falla. Sirve igual para `ScoreResult` que para filas
    `Score` — ambas exponen `.ticker` y `.under_acquisition`.
    """
    opadas = [r.ticker for r in rows if getattr(r, "under_acquisition", None) is True]
    if opadas:
        issues.append("Fuera de la selección por oferta de adquisición en curso (lo declara el "
                      "propio informe): " + _lista(opadas))
    sin_respuesta = [r.ticker for r in rows if getattr(r, "under_acquisition", None) is None]
    if sin_respuesta:
        issues.append("Sin respuesta al campo de oferta de adquisición (no aparta a nadie): "
                      + _lista(sin_respuesta))
    return [r for r in rows if getattr(r, "under_acquisition", None) is not True]


def _flag_constructor_backfill(construction, issues: list[str]) -> None:
    """Avisa si la cartera final no es (del todo) convicción del LLM, sino relleno por score.

    Antes `positions: 5` salía igual con el constructor sano o caído 3/3 — la única pista era
    el summary, enterrado en un modal que nadie abre a tiempo. Ahora sale en `issues`.
    """
    if construction.summary == constructor_mod.FALLBACK_SUMMARY:
        issues.append("Constructor caído (3 intentos fallidos): la cartera se rellenó "
                      "automáticamente por score, sin tesis del LLM.")
        return
    n = portfolio.backfill_count(construction)
    if n:
        issues.append(f"El constructor solo fondeó {len(construction.positions) - n} de "
                      f"{len(construction.positions)} posiciones; el resto se rellenó por score.")


def _log_funnel(cadence: str, sample: list, prescored: list, failed: list, finalists: list,
                data_by_t: dict, selected: list, construction, instr_prices: dict) -> None:
    """Traza legible del embudo en los logs (Railway/consola): permite ver de un vistazo que el
    corte ya no colapsa en un sector, y si algo va raro saber en qué paso. Best-effort."""
    try:
        def top(counter: Counter) -> str:
            """TODOS los sectores del counter, no un top-N -- una lista recortada aquí se lee
            como si el resto se hubiera descartado del embudo, cuando solo faltaba en el log."""
            return ", ".join(f"{s}:{n}" for s, n in counter.most_common()) or "n/d"

        fin_sectors = Counter(_sector(data_by_t, t) for t in finalists)
        logger.info("── EMBUDO (%s) ──────────────────────────────", cadence)
        logger.info("  muestra=%d · pre-scoreados=%d · sin datos=%d · finalistas=%d en %d sectores",
                    len(sample), len(prescored), len(failed), len(finalists), len(fin_sectors))
        logger.info("  pre-score por sector: %s", top(Counter(d.sector for _p, d in prescored)))
        logger.info("  finalistas por sector: %s", top(fin_sectors))
        # Confianza del prescore AGREGADA: el aviso por llamada inundaba (>350 líneas/escaneo) y
        # Railway descarta líneas a ese volumen — en el escaneo grande solo sobrevivió el 1%.
        confs = sorted(p.confidence for p, _d in prescored if p.confidence is not None)
        if confs:
            def cuantil(q: float) -> float:
                return confs[min(len(confs) - 1, int(len(confs) * q))]
            bajos = sum(1 for c in confs if c < scorer_mod._LOW_CONFIDENCE)
            logger.info("  confianza prescore (n=%d): min=%.4f p25=%.4f mediana=%.4f max=%.4f · "
                        "por debajo de %.2f: %d (%.0f%%)", len(confs), confs[0], cuantil(0.25),
                        cuantil(0.50), confs[-1], scorer_mod._LOW_CONFIDENCE, bajos,
                        bajos / len(confs) * 100)
        sel = ", ".join(f"{r.ticker}[{_sector(data_by_t, r.ticker)}]={r.score}" for r in selected)
        logger.info("  seleccionados (top-%d): %s", len(selected), sel or "ninguno")
        # Orden en que el constructor los vio (barajado): sin esto no se distingue "eligió por
        # convicción" de "se quedó con los primeros de la lista".
        logger.info("  orden mostrado al constructor: %s",
                    ", ".join(r.ticker for r in portfolio.orden_presentacion(selected)) or "n/d")
        cartera = ", ".join(f"{p.ticker} {p.weight_pct:.0f}%[{_sector(data_by_t, p.ticker)}]"
                            for p in construction.positions) or "vacía"
        logger.info("  CARTERA: %s", cartera)
        # La métrica que se está vigilando: ¿fondeó justo el top-N por score, o de verdad eligió?
        fondeados = {p.ticker for p in construction.positions}
        if fondeados and selected:
            top_n = {r.ticker for r in selected[:len(fondeados)]}
            logger.info("  ¿cartera == top-%d por score? %s", len(fondeados),
                        "SÍ — colapsó al ranking" if fondeados == top_n else "no")
        if instr_prices:
            usados = [p.ticker for p in construction.positions if p.ticker in instr_prices]
            logger.info("  UCITS disponibles=%d · usados=%s", len(instr_prices), usados or "—")
        logger.info("──────────────────────────────────────────────")
    except Exception:
        logger.exception("No se pudo emitir la traza del embudo (no aborta el escaneo).")
