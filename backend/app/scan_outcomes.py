"""Lectura de la traza de auditoría: qué hizo DESPUÉS cada grupo del embudo.

La traza (ScanAudit) guarda quién llegó a qué etapa y a qué precio; esto la lee y le pone el
precio de hoy delante para responder las preguntas del experimento: ¿lo que compró lo hizo
mejor que lo que descartó? ¿puntuar más alto significa rendir mejor? ¿se pierden buenos
nombres en el corte? «Almacenar ≠ inyectar» sigue intacto: esto es evaluación offline para
humanos y NUNCA vuelve a un prompt.

Cada cohorte (un `scan_at`) se mide A IGUAL PESO dentro del grupo: aquí se evalúa el CRITERIO
(a quién eligió), no la construcción (qué peso le dio) — eso ya lo mide la curva del libro.
Grupos: cartera (fondeados) · seleccionados sin fondear (top-N que el constructor dejó fuera)
· descartados del profundo · SPY en la misma ventana como vara de medir.

Aproximación asumida: el precio de entrada es el del momento del escaneo (intradía) y el
actual es el último cierre de yfinance. Para comparar GRUPOS entre sí es irrelevante — todos
miden con la misma regla — y contra SPY (cierre del día del escaneo) el desfase es de horas.
"""

from __future__ import annotations

import logging
import time
from statistics import median

import yfinance as yf
from sqlalchemy import select

from app import scan_audit
from app.models import ScanAudit, _utcnow

logger = logging.getLogger(__name__)

CORTE_N = 10          # tamaño de la frontera: los N peores que entraron vs los N mejores fuera

_SPY_TTL = 900
_spy_cache: tuple[float, object] | None = None


def _spy_closes():
    """Cierres diarios del SPY (6 meses), cacheados: una serie para todas las cohortes."""
    global _spy_cache
    now = time.time()
    if _spy_cache and now - _spy_cache[0] < _SPY_TTL:
        return _spy_cache[1]
    try:
        s = yf.Ticker("SPY").history(period="6mo", interval="1d",
                                     auto_adjust=True)["Close"].dropna()
        s.index = s.index.tz_localize(None)
    except Exception:
        logger.warning("SPY no disponible para la lectura de outcomes.")
        return None
    _spy_cache = (now, s)
    return s


def _spy_ret_since(day) -> float | None:  # noqa: ANN001
    """% del SPY desde el cierre del día del escaneo hasta el último cierre."""
    s = _spy_closes()
    if s is None or not len(s):
        return None
    base = s.loc[:str(day)]
    if not len(base):
        return None
    return round((float(s.iloc[-1]) / float(base.iloc[-1]) - 1) * 100, 2)


def _stats(rets: list[float]) -> dict:
    if not rets:
        return {"n": 0, "avg": None, "median": None}
    return {"n": len(rets), "avg": round(sum(rets) / len(rets), 2),
            "median": round(median(rets), 2)}


def outcomes(db, limit: int = 8) -> list[dict]:  # noqa: ANN001
    """Las cohortes de la traza con su retorno a hoy, de la más reciente a la más vieja.

    Devuelve SIEMPRE los nombres (pairs y frontera con ticker): la ruta decide qué cara
    enseña — los agregados por grupo son comportamiento (públicos); un ticker con su score
    y su retorno es el feed de señales (solo con sesión).
    """
    from app.tracking import live_prices

    fechas = scan_audit.scan_dates(db, limit)
    if not fechas:
        return []

    # Filas del profundo de todas las cohortes + la frontera de fuera (mejores pre-scores que
    # NO llegaron al profundo, por cohorte). Dos consultas pequeñas, no un volcado de 2.600×N.
    deep_rows = list(db.execute(
        select(ScanAudit).where(ScanAudit.scan_at.in_(fechas),
                                ScanAudit.reached_deep.is_(True))).scalars())
    fuera_by_scan: dict = {}
    for at in fechas:
        fuera_by_scan[at] = list(db.execute(
            select(ScanAudit)
            .where(ScanAudit.scan_at == at, ScanAudit.reached_deep.is_(False),
                   ScanAudit.prescore.is_not(None), ScanAudit.price.is_not(None))
            .order_by(ScanAudit.prescore.desc()).limit(CORTE_N)).scalars())

    tickers = ({r.ticker for r in deep_rows}
               | {r.ticker for rs in fuera_by_scan.values() for r in rs})
    precios = live_prices(sorted(tickers))

    def _ret(r: ScanAudit) -> float | None:
        px = precios.get(r.ticker)
        if not px or not r.price:
            return None
        return round((px / r.price - 1) * 100, 2)

    # La BD guarda UTC naive (SQLite pierde el tz al leer); se resta naive contra naive.
    hoy = _utcnow().replace(tzinfo=None)
    salida: list[dict] = []
    for at in fechas:
        cohorte = [r for r in deep_rows if r.scan_at == at]
        # Un profundo ilegible no es un descarte del criterio: fue un fallo. Fuera de los grupos.
        validos = [r for r in cohorte if r.stage != "deep_error"]

        def _grupo(rows: list) -> dict:
            return _stats([x for x in (_ret(r) for r in rows) if x is not None])

        cartera = [r for r in validos if r.funded]
        selec = [r for r in validos if r.selected and not r.funded]
        descartados = [r for r in validos if not r.selected]

        # `funded` viaja también sin sesión: que UN punto de la nube esté en el libro es
        # comportamiento (cuántos y cómo rinden ya es público); su ticker sigue sin salir.
        pares = [{"ticker": r.ticker, "score": r.deep_score, "ret": _ret(r),
                  "funded": bool(r.funded)}
                 for r in validos if r.deep_score is not None and _ret(r) is not None]

        # La frontera del corte, medida con la MISMA vara a ambos lados (el pre-score): los N
        # mejores que se quedaron fuera del profundo vs los N peores pre-scores que sí entraron.
        dentro = sorted((r for r in validos if r.prescore is not None),
                        key=lambda r: r.prescore)[:CORTE_N]
        fuera = fuera_by_scan.get(at, [])

        def _lado(rows: list) -> dict:
            return {**_grupo(rows),
                    "nombres": [{"ticker": r.ticker, "prescore": r.prescore, "ret": _ret(r)}
                                for r in rows]}

        salida.append({
            "at": at.isoformat(),
            # Del flag de la traza, no inferido de "hay cartera": la construcción se registra
            # también en los observatorios (es su cartera HIPOTÉTICA) y la inferencia vieja
            # etiquetaba todo como decisión. NULL (filas pre-columna) = observatorio.
            "mode": "decisión" if any(r.decide for r in cohorte) else "observatorio",
            "days": max(0, (hoy - at.replace(tzinfo=None)).days),
            "groups": {
                "cartera": _grupo(cartera),
                "seleccionados": _grupo(selec),
                "descartados": _grupo(descartados),
                "spy": _spy_ret_since(at.date()),
            },
            "pairs": pares,
            "corte": {"fuera": _lado(fuera), "dentro": _lado(dentro)},
        })
    return salida


def book_row(db) -> dict | None:  # noqa: ANN001
    """La fila de LO REAL: el libro sombra vigente desde su compra, a valor de mercado.

    La traza no alcanza a la decisión que compró la cartera actual (18-jul: el comportamiento
    pre-histórico la borró), así que esta fila sale del LEDGER — precios de compra reales,
    retorno a valor de mercado (no a igual peso: aquí sí importa el libro, no el criterio) y
    el S&P desde el mismo minuto de la primera compra (la referencia persistida del tracking).
    Redundante con la curva a propósito: pone la imagen real donde se leen las cohortes.
    """
    try:
        from app.tracking import performance

        perf = performance(db)
        if not perf.get("positions"):
            return None
        return {
            "since": perf.get("since"),
            "ret": perf.get("portfolio_return_pct"),
            "spy": perf.get("spy_return_pct"),
            "n": len(perf["positions"]),
        }
    except Exception:
        logger.warning("Fila del libro real no disponible para outcomes.")
        return None


def ticker_history(db, ticker: str, limit: int = 26) -> list[dict]:  # noqa: ANN001
    """La historia de un ticker a través de los escaneos (¿es estable el criterio?).

    Del más reciente al más viejo. Es el detalle con nombre: SOLO se sirve con sesión.
    """
    stmt = (select(ScanAudit).where(ScanAudit.ticker == ticker.upper())
            .order_by(ScanAudit.scan_at.desc()).limit(limit))
    return [
        {"at": r.scan_at.isoformat(), "stage": r.stage, "prescore": r.prescore,
         "deep_score": r.deep_score, "price": r.price, "weight_pct": r.weight_pct}
        for r in db.execute(stmt).scalars()
    ]
