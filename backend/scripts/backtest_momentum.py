"""Backtest de la estrategia de momentum, zigzag y suelo POR SEPARADO.

Por qué existe: `signals.compute_signals()` combina zigzag y suelo en 'ambos' cuando coinciden,
así que ninguno de los dos se puede medir en aislado desde ahí. Este script llama a
`entradas_zigzag()` y `entradas_suelo()` por su cuenta y resuelve cada entrada con
`resolver_salida()` -- misma lógica exacta que producción, pero sin fusionar. Un trade que
dispara los dos métodos cuenta en los dos, a propósito: la pregunta es cómo se comporta CADA
método sobre el universo, no cuántas señales únicas hay.

Universo: database-first (tabla `momentum_universo`), nunca hardcodeado.
  --solo-original  usa solo origen='original' (el núcleo curado, sin los incorporados a
                   posteriori por el pipeline de descubrimiento).
  (por defecto)    usa el universo entero de producción.

Ventana: 2025-09-01 -> hoy (la de `signals.EVAL_START`, no se toca aquí).

Salida: tabla agregada + tabla por ticker por consola, y un informe en
        backend/scripts/out/backtest_momentum_<fecha>.md.

Coste: cero (solo yfinance). Tarda unos minutos por las descargas con reintento.

Uso (desde backend/):  uv run --system-certs python scripts/backtest_momentum.py [--solo-original]
"""
from __future__ import annotations

import argparse
import statistics
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.momentum import signals  # noqa: E402


def _cargar_universo(solo_original: bool, incluir_apagados: bool) -> list[tuple[str, str]]:
    """(ticker, origen) desde `momentum_universo`. Por defecto solo el universo ACTIVO
    (apagado = `momentum_universo_estado.mantener = false`)."""
    conds = []
    if solo_original:
        conds.append("u.origen = 'original'")
    if not incluir_apagados:
        conds.append("coalesce(e.mantener, true) = true")
    where = f"where {' and '.join(conds)}" if conds else ""
    with SessionLocal() as db:
        rows = db.execute(text(f"""
            select u.ticker, u.origen from momentum_universo u
            left join momentum_universo_estado e on e.ticker = u.ticker
            {where} order by u.origen, u.ticker
        """)).all()
    return [(r[0], r[1]) for r in rows]


def _senales_por_metodo(ticker: str) -> dict[str, list[dict]]:
    """Zigzag y suelo del ticker, cada uno con su salida resuelta -- SIN combinar en 'ambos'."""
    df = signals.fetch(ticker)
    if df.empty:
        return {"zigzag": [], "suelo": []}
    precios, aperturas = df["Close"], df["Open"]
    ath = precios.max()
    picos = signals.zigzag(precios, signals.REVERSAL_PCT)
    altos = [(f, p) for f, p, tipo in picos if tipo == "high"]

    out: dict[str, list[dict]] = {"zigzag": [], "suelo": []}
    for metodo, entradas in (
        ("zigzag", signals.entradas_zigzag(precios, altos, signals.ENTRY_TH)),
        ("suelo", signals.entradas_suelo(precios, ath)),
    ):
        for e in entradas:
            salida = signals.resolver_salida(precios, aperturas, e["entry_date"], e["entry_price"])
            out[metodo].append({"ticker": ticker, "entry_date": e["entry_date"], **salida})
    return out


def _agregado(rets: list[float], dias: list[int]) -> dict:
    if not rets:
        return {"n": 0}
    pos = sum(1 for x in rets if x > 0)
    q = statistics.quantiles(dias, n=100, method="inclusive") if len(dias) > 1 else [dias[0]] * 99
    return {
        "n": len(rets),
        "media": statistics.mean(rets),
        "mediana": statistics.median(rets),
        "pct_pos": pos / len(rets) * 100,
        "dias_media": statistics.mean(dias),
        "p99_dias": q[98],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--solo-original", action="store_true",
                    help="usa solo momentum_universo.origen='original' (sin incorporados)")
    ap.add_argument("--tickers", type=str, default=None,
                    help="lista explícita 'AAA,BBB,...' -- ignora la BBDD (útil cuando la BBDD "
                         "local no tiene el universo de producción entero)")
    ap.add_argument("--incluir-apagados", action="store_true",
                    help="incluye tickers con mantener=false (por defecto solo el activo)")
    args = ap.parse_args()

    if args.tickers:
        universo = [(t.strip().upper(), "manual") for t in args.tickers.split(",") if t.strip()]
        etiqueta = "MANUAL"
    else:
        universo = _cargar_universo(args.solo_original, args.incluir_apagados)
        etiqueta = "ORIGINAL" if args.solo_original else "PRODUCCION"
    print(f"Universo {etiqueta}: {len(universo)} tickers -- ventana {signals.EVAL_START.date()} -> hoy\n"
          f"{', '.join(t for t, _ in universo)}\n")

    # ticker -> {metodo -> [señales]}
    por_ticker: dict[str, dict[str, list[dict]]] = {}
    for i, (ticker, _origen) in enumerate(universo, 1):
        print(f"  [{i}/{len(universo)}] {ticker}...", flush=True)
        por_ticker[ticker] = _senales_por_metodo(ticker)

    lineas: list[str] = [f"# Backtest momentum -- {etiqueta} ({len(universo)} tickers)",
                         f"_Generado {datetime.now().isoformat(timespec='seconds')} "
                         f"-- ventana {signals.EVAL_START.date()} -> hoy_\n"]

    for metodo in ("zigzag", "suelo"):
        todas = [s for tk in por_ticker.values() for s in tk[metodo]]
        resueltas = [s for s in todas if s["resuelta"]]
        abiertas = [s for s in todas if not s["resuelta"] and s["ret"] is not None]
        agg = _agregado([s["ret"] for s in resueltas], [s["dias"] for s in resueltas])

        lineas.append(f"## {metodo.upper()}\n")
        if agg["n"]:
            lineas.append(
                f"Agregado: n={agg['n']}  media={agg['media']:+.1f}%  mediana={agg['mediana']:+.1f}%  "
                f"positivas={agg['pct_pos']:.1f}%  dias_media={agg['dias_media']:.1f}  "
                f"p99_dias={agg['p99_dias']:.1f}\n")
        lineas.append(f"Abiertas ahora: {len(abiertas)} "
                      f"(retorno mark-to-market medio {statistics.mean([s['ret'] for s in abiertas]):+.1f}%)\n"
                      if abiertas else "Abiertas ahora: 0\n")

        lineas.append("| ticker | n | media | mediana | % pos | dias media |")
        lineas.append("|---|---|---|---|---|---|")
        for ticker in sorted(por_ticker):
            sub = [s for s in por_ticker[ticker][metodo] if s["resuelta"]]
            if not sub:
                lineas.append(f"| {ticker} | 0 | — | — | — | — |")
                continue
            rets = [s["ret"] for s in sub]
            dd = [s["dias"] for s in sub]
            lineas.append(
                f"| {ticker} | {len(rets)} | {statistics.mean(rets):+.1f}% | "
                f"{statistics.median(rets):+.1f}% | "
                f"{sum(1 for x in rets if x > 0) / len(rets) * 100:.0f}% | "
                f"{statistics.mean(dd):.0f} |")
        lineas.append("")

    informe = "\n".join(lineas)
    print("\n" + informe)

    out_dir = Path(__file__).parent / "out"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"backtest_momentum_{etiqueta.lower()}_{datetime.now():%Y%m%d}.md"
    out_path.write_text(informe, encoding="utf-8")
    print(f"\nGuardado: {out_path}")


if __name__ == "__main__":
    main()
