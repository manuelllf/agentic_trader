"""Traza de auditoría del embudo del escaneo (diagnóstico, sin LLM ni dinero).

Guarda por escaneo una foto por ticker de HASTA DÓNDE llegó: pre-score → finalista →
seleccionado → en cartera, con su precio del día. Es HISTÓRICA: cada escaneo AÑADE sus filas
(todas con el mismo `scan_at`, que hace de identificador) y solo se poda lo que pasa de
`RETENTION_DAYS`. Sin historial no se puede medir nada a posteriori — ni si las descartadas lo
hicieron mejor que las compradas, ni cómo derivan los scores de un escaneo al siguiente.

Almacenar ≠ inyectar: esto es telemetría para evaluación OFFLINE y NUNCA entra a un prompt.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from sqlalchemy import case, func, select

from app.models import ScanAudit, _utcnow, utc_iso

RETENTION_DAYS = 90
DETAIL_TOP = 120        # tope de nombres del detalle (ver `funnel`): la API no es el volcado


def _stage(reached_deep: bool, selected: bool, funded: bool) -> str:
    if funded:
        return "cartera"
    if selected:
        return "seleccionado"
    if reached_deep:
        return "finalista"
    return "prescore"


def record(db, *, prescored: list, failed: list[str], finalists: list[str],
           deep: dict, selected: list, construction, pre_errors: list | None = None,
           deep_errors: list[str] | None = None, decide: bool | None = None,
           lanes: dict[str, str] | None = None) -> None:
    """Añade la traza del embudo de ESTE escaneo (no borra las anteriores) y poda las viejas.

    `prescored` = [(PrescoreResult, NameData)]; `failed` = tickers sin datos; `deep` = {ticker:
    ScoreResult} (solo los VÁLIDOS: un profundo no parseable no tiene score que guardar);
    `selected` = filas top-10; `construction.positions` = la cartera final con pesos;
    `pre_errors` = [(PrescoreResult, NameData)] cuyo pre-score no parseó (si no se registran,
    desaparecen del embudo sin dejar rastro); `deep_errors` = finalistas cuyo informe PROFUNDO
    no parseó — sin su etapa propia quedaban como "finalista" cualquiera y no se podía contar
    cuántas veces falla un mismo ticker (MS y CNC solo existían como aviso del informe);
    `decide` = si el escaneo decidía cartera — la construcción se registra también en los
    observatorios y sin el flag su cartera hipotética se confunde con el libro real.
    `lanes` = {ticker: carril} devuelto por `select_finalists` (posición/seguimiento/caps/sector/
    global) — sin saber por qué carril entró un finalista no se puede evaluar si ese carril
    aporta valor o solo ocupa hueco de otro mejor.
    Best-effort: el caller lo envuelve en try (un fallo aquí nunca debe tirar el escaneo).
    """
    finalist_set = set(finalists)
    selected_set = {r.ticker for r in selected}
    funded = {p.ticker: p.weight_pct for p in construction.positions}
    deep_err_set = set(deep_errors or [])
    lanes = lanes or {}
    now = _utcnow()

    rows: list[ScanAudit] = []
    for p, d in prescored:
        t = p.ticker
        in_deep, is_sel, is_fund = t in finalist_set, t in selected_set, t in funded
        rows.append(ScanAudit(
            scan_at=now, ticker=t, sector=d.sector, prescore=p.score, price=d.price,
            reached_deep=in_deep, deep_score=deep[t].score if t in deep else None,
            selected=is_sel, funded=is_fund, weight_pct=funded.get(t), decide=decide,
            # Un profundo ilegible LLEGÓ al profundo (reached_deep se conserva) pero falló ahí.
            stage="deep_error" if t in deep_err_set else _stage(in_deep, is_sel, is_fund),
            entry_lane=lanes.get(t) if in_deep else None,
        ))
    for p, d in (pre_errors or []):
        # prescore=None a propósito: no hubo puntuación, hubo fallo (no cuenta como pre-scoreado).
        rows.append(ScanAudit(scan_at=now, ticker=p.ticker, sector=d.sector, price=d.price,
                              stage="prescore_error", decide=decide))
    for t in failed:
        rows.append(ScanAudit(scan_at=now, ticker=t, stage="datos", decide=decide))
    db.add_all(rows)

    db.query(ScanAudit).filter(ScanAudit.scan_at < now - timedelta(days=RETENTION_DAYS)).delete()
    db.commit()


def scan_dates(db, limit: int = 8) -> list:  # noqa: ANN001
    """Los `limit` escaneos guardados más recientes (su `scan_at`), del nuevo al viejo."""
    stmt = (select(ScanAudit.scan_at).group_by(ScanAudit.scan_at)
            .order_by(ScanAudit.scan_at.desc()).limit(limit))
    return list(db.execute(stmt).scalars())


def funnel(db, *, limit: int = 8, detail: bool = False) -> list[dict]:  # noqa: ANN001
    """Embudo de los últimos escaneos, del más reciente al más antiguo.

    Lo AGREGADO (cuántos nombres sobreviven a cada etapa, y el reparto por sector) describe el
    comportamiento del sistema y no identifica a nadie: es lo que puede verse en público. El
    DETALLE nombre a nombre es el ranking con sus scores, así que solo se sirve con sesión
    (`detail=True`) y únicamente del escaneo más reciente, acotado a `DETAIL_TOP` filas: esta
    API alimenta un panel, no es el volcado de la tabla. Para análisis offline sin topes están
    `scripts/scan_funnel.py` y la propia BD.
    """
    fechas = scan_dates(db, limit)
    if not fechas:
        return []

    # Contadores por escaneo y sector en UNA consulta agregada: con ~2.600 filas por escaneo,
    # traerse todo a Python para contarlo sería gratuito hoy y un problema dentro de 90 días.
    def _cuenta(cond):  # noqa: ANN001, ANN202 — `case` en vez de `iif`: SQLite Y Postgres
        return func.sum(case((cond, 1), else_=0))

    stmt = (
        select(
            ScanAudit.scan_at, ScanAudit.sector,
            _cuenta(ScanAudit.prescore.is_not(None)).label("pre"),
            _cuenta(ScanAudit.reached_deep.is_(True)).label("deep"),
            _cuenta(ScanAudit.selected.is_(True)).label("sel"),
            _cuenta(ScanAudit.funded.is_(True)).label("fund"),
            _cuenta(ScanAudit.stage == "datos").label("sin_datos"),
            _cuenta(ScanAudit.stage == "prescore_error").label("pre_error"),
            _cuenta(ScanAudit.stage == "deep_error").label("deep_error"),
        )
        .where(ScanAudit.scan_at.in_(fechas))
        .group_by(ScanAudit.scan_at, ScanAudit.sector)
    )
    por_escaneo: dict = defaultdict(lambda: {"sectores": [], "pre": 0, "deep": 0, "sel": 0,
                                             "funded": 0, "sin_datos": 0, "prescore_error": 0,
                                             "deep_error": 0})
    for r in db.execute(stmt):
        e = por_escaneo[r.scan_at]
        e["pre"] += r.pre or 0
        e["deep"] += r.deep or 0
        e["sel"] += r.sel or 0
        e["funded"] += r.fund or 0
        e["sin_datos"] += r.sin_datos or 0
        e["prescore_error"] += r.pre_error or 0
        e["deep_error"] += r.deep_error or 0
        if r.sector and (r.pre or 0):        # las filas sin sector son las que ni se puntuaron
            e["sectores"].append({"sector": r.sector, "pre": r.pre or 0, "deep": r.deep or 0,
                                  "sel": r.sel or 0, "funded": r.fund or 0})

    salida = []
    for at in fechas:
        e = por_escaneo.get(at) or {"sectores": [], "pre": 0, "deep": 0, "sel": 0, "funded": 0,
                                    "sin_datos": 0, "prescore_error": 0, "deep_error": 0}
        e["sectores"].sort(key=lambda s: -s["pre"])
        salida.append({"at": utc_iso(at), **e})

    if detail and salida:
        salida[0]["nombres"] = _detalle(db, fechas[0])
    return salida


def _detalle(db, at) -> list[dict]:  # noqa: ANN001
    """Nombre a nombre de un escaneo: los que llegaron al profundo SIEMPRE, y el resto por
    pre-score hasta `DETAIL_TOP`. Así se ve la frontera (quién se quedó a las puertas del corte),
    que es justo lo que no se puede reconstruir mirando solo a los ganadores."""
    stmt = (select(ScanAudit).where(ScanAudit.scan_at == at)
            .order_by(ScanAudit.reached_deep.desc(), ScanAudit.prescore.desc().nulls_last())
            .limit(DETAIL_TOP))
    return [
        {"ticker": r.ticker, "sector": r.sector, "prescore": r.prescore,
         "deep_score": r.deep_score, "stage": r.stage, "price": r.price,
         "weight_pct": r.weight_pct}
        for r in db.execute(stmt).scalars()
    ]
