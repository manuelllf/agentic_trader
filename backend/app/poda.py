"""Poda de lo que ya está archivado en DuckDB (B3 de docs/liguilla/cambios-bbdd.md).

Proceso de Alpha: se lanza a mano desde el centro de operaciones, con vista previa, y nunca borra
una fila que el archivo no tenga. Cada lote se comprueba id a id contra `/data/analytics.duckdb`
antes de borrarlo.

Qué se queda en Postgres (R2):
- la última captura de cada ticker, que es la que lee `foto_reciente`;
- las 2 fotos completas más recientes de cada alcance;
- lo que usó cada escaneo de decisión de los últimos 90 días;
- las fotos de las jornadas de la liga, para siempre;
- todo lo capturado en las últimas 48 h.

De `fundamentals_snapshot` no se borra ninguna fila, solo sus métricas y titulares. De
`llm_call` se vacían `content` y `reasoning` a los 90 días; tokens, coste y latencia se quedan.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import UTC, datetime

from sqlalchemy import text

from app.db import SessionLocal, engine

logger = logging.getLogger(__name__)

FOTOS_A_CONSERVAR = 2
DIAS_DECISION = 90
DIAS_TEXTO_LLM = 90
HORAS_INTOCABLES = 48
LOTE = 20_000
_PAUSA_S = 0.3
# Antes de que las fotos tuvieran identidad, una captura del universo se reconoce por volumen.
_MIN_FILAS_FOTO_ANTIGUA = 1_000

_TABLAS_FOTO = ("fundamentals_snapshot_metric", "fundamentals_snapshot_news")

_state: dict = {"status": "idle", "fase": None, "hechas": 0, "total": 0,
                "started_at": None, "finished_at": None, "result": None, "error": None}
_lock = threading.Lock()


class ArchivoNoDisponible(RuntimeError):
    """El fichero DuckDB no existe o está ocupado: sin él no se borra nada."""


def get_status() -> dict:
    with _lock:
        return dict(_state)


def _abrir_archivo():  # noqa: ANN202
    import duckdb

    from app.analytics_sync import default_path

    ruta = default_path()
    if not os.path.exists(ruta):
        raise ArchivoNoDisponible("No hay archivo DuckDB: lanza antes «Analítica del método».")
    try:
        return duckdb.connect(ruta, read_only=True)
    except Exception as exc:  # noqa: BLE001 — la sincronización diaria lo tiene abierto
        raise ArchivoNoDisponible(
            f"El archivo DuckDB está ocupado (¿sincronizando?). Prueba en unos minutos: {exc}"
        ) from exc


def _marcas(con) -> dict[str, int]:  # noqa: ANN001
    """Marca de agua de cada tabla archivada por incrementos: hasta qué id ha llegado el archivo."""
    return dict(con.execute("select tabla, ultimo_id from _sync_watermark").fetchall())


def _en_archivo(con, tabla: str, ids: list[int]) -> set[int]:  # noqa: ANN001
    """Los ids de `ids` que el archivo tiene de verdad (no basta la marca de agua: una transacción
    lenta pudo confirmar un id bajo después de una sincronización)."""
    if not ids:
        return set()
    filas = con.execute(
        f"select distinct t.id from {tabla} t join (select unnest(?::bigint[]) as id) c "
        "on c.id = t.id", [ids]).fetchall()
    return {i for (i,) in filas}


def _sql_podables(con_liga: bool) -> str:
    liga = ("union select s.id from public.fundamentals_snapshot s "
            "join liga.jornadas j on j.foto_id = s.foto_id") if con_liga else ""
    return f"""
with ultima_por_ticker as (
  select distinct on (ticker) id from public.fundamentals_snapshot
  order by ticker, captured_at desc, id desc
),
snap as (
  select s.id, s.es_dataset, s.captured_at, f.estado,
         case when s.foto_id is not null then 'foto ' || s.foto_id
              else 'captura del ' || to_char(s.captured_at at time zone 'UTC', 'YYYY-MM-DD') end
           as grupo
  from public.fundamentals_snapshot s left join public.foto f on f.id = s.foto_id
),
grupos as (
  select grupo, es_dataset, max(captured_at) as at, count(*) as n,
         bool_and(coalesce(estado, 'antigua') in ('completa', 'antigua')) as completa
  from snap group by grupo, es_dataset
),
ultimas_fotos as (
  select grupo, es_dataset from (
    select grupo, es_dataset,
           row_number() over (partition by es_dataset order by at desc) as rn
    from grupos where completa and (grupo like 'foto %' or n >= :min_antigua)
  ) g where rn <= :fotos
),
decisiones as (
  select id, scan_at, foto_id from public.scan_runs
  where decide and error is null and scan_at >= now() - make_interval(days => :dias_decision)
),
usadas as (
  select distinct on (d.id, a.ticker) s.id
  from decisiones d
  join public.scan_audit a on a.scan_run_id = d.id
  join public.fundamentals_snapshot s on s.ticker = a.ticker and s.captured_at <= d.scan_at
  order by d.id, a.ticker, s.captured_at desc, s.id desc
),
conservar as (
  select id from ultima_por_ticker
  union select s.id from snap s
    join ultimas_fotos u on u.grupo = s.grupo and u.es_dataset = s.es_dataset
  union select id from usadas
  union select s.id from public.fundamentals_snapshot s join decisiones d on d.foto_id = s.foto_id
  union select id from public.fundamentals_snapshot
    where captured_at >= now() - make_interval(hours => :horas)
  {liga}
)
select s.id, s.grupo, s.es_dataset, s.captured_at
from snap s
where s.id not in (select id from conservar)
  and (exists (select 1 from public.fundamentals_snapshot_metric m
               where m.fundamentals_snapshot_id = s.id)
       or exists (select 1 from public.fundamentals_snapshot_news n
                  where n.fundamentals_snapshot_id = s.id))
"""


def _hay_liga(db) -> bool:  # noqa: ANN001
    return db.execute(text("select to_regclass('liga.jornadas') is not null")).scalar()


def _snapshots_podables(db) -> list:  # noqa: ANN001
    return db.execute(text(_sql_podables(_hay_liga(db))), {
        "min_antigua": _MIN_FILAS_FOTO_ANTIGUA, "fotos": FOTOS_A_CONSERVAR,
        "dias_decision": DIAS_DECISION, "horas": HORAS_INTOCABLES}).all()


def _ids_foto(db, tabla: str, snapshots: list[int], marca: int, desde: int = 0,  # noqa: ANN001
              limite: int | None = None) -> list[int]:
    sql = (f"select id from public.{tabla} where fundamentals_snapshot_id = any(:s) "
           "and id <= :marca and id > :desde order by id")
    if limite:
        sql += f" limit {int(limite)}"
    return list(db.execute(text(sql), {"s": snapshots, "marca": marca, "desde": desde}).scalars())


_SQL_TEXTO_LLM = """
select id from public.llm_call
where at < now() - make_interval(days => :dias) and (content is not null or reasoning is not null)
  and id <= :marca and id > :desde order by id
"""


def _ids_texto_llm(db, marca: int, desde: int = 0, limite: int | None = None) -> list[int]:  # noqa: ANN001
    sql = _SQL_TEXTO_LLM + (f" limit {int(limite)}" if limite else "")
    return list(db.execute(text(sql), {"dias": DIAS_TEXTO_LLM, "marca": marca,
                                       "desde": desde}).scalars())


def _bytes_por_fila(db, tabla: str) -> float:  # noqa: ANN001
    fila = db.execute(text(
        "select pg_total_relation_size(c.oid)::float / greatest(c.reltuples, 1) "
        "from pg_class c where c.oid = to_regclass(:t)"), {"t": f"public.{tabla}"}).scalar()
    return float(fila or 0)


def vista_previa(db) -> dict:  # noqa: ANN001
    """Qué borraría la poda ahora, cuánto libera y qué tiene el archivo. No toca nada."""
    if engine.dialect.name != "postgresql":
        raise RuntimeError("La poda solo existe contra Postgres.")
    con = _abrir_archivo()
    try:
        marcas = _marcas(con)
        podables = _snapshots_podables(db)
        snapshots = [r.id for r in podables]
        tablas = {}
        for tabla in _TABLAS_FOTO:
            ids = _ids_foto(db, tabla, snapshots, marcas.get(tabla, 0))
            archivados = _en_archivo(con, tabla, ids)
            tablas[tabla] = {"filas": len(archivados), "sin_archivar": len(ids) - len(archivados),
                             "mb": round(len(archivados) * _bytes_por_fila(db, tabla) / 1e6, 1)}
        ids_llm = _ids_texto_llm(db, marcas.get("llm_call", 0))
        archivados_llm = _en_archivo(con, "llm_call", ids_llm)
        mb_llm = 0.0
        if archivados_llm:
            mb_llm = float(db.execute(text(
                "select coalesce(sum(coalesce(pg_column_size(content), 0) "
                "+ coalesce(pg_column_size(reasoning), 0)), 0) from public.llm_call "
                "where id = any(:ids)"), {"ids": list(archivados_llm)}).scalar()) / 1e6
    finally:
        con.close()

    grupos: dict[tuple, dict] = {}
    for r in podables:
        g = grupos.setdefault((r.grupo, r.es_dataset), {
            "grupo": r.grupo, "alcance": "global" if r.es_dataset else "nasdaq",
            "empresas": 0, "desde": r.captured_at, "hasta": r.captured_at})
        g["empresas"] += 1
        g["desde"] = min(g["desde"], r.captured_at)
        g["hasta"] = max(g["hasta"], r.captured_at)
    return {
        "reglas": {"fotos_completas": FOTOS_A_CONSERVAR, "dias_decision": DIAS_DECISION,
                   "dias_texto_llm": DIAS_TEXTO_LLM, "horas_intocables": HORAS_INTOCABLES},
        "marcas_archivo": marcas,
        "fotos": [{**g, "desde": g["desde"].isoformat(), "hasta": g["hasta"].isoformat()}
                  for g in sorted(grupos.values(), key=lambda g: g["desde"])],
        "metricas": tablas["fundamentals_snapshot_metric"],
        "titulares": tablas["fundamentals_snapshot_news"],
        "texto_llm": {"llamadas": len(archivados_llm),
                      "sin_archivar": len(ids_llm) - len(archivados_llm), "mb": round(mb_llm, 1)},
        "mb_total": round(tablas["fundamentals_snapshot_metric"]["mb"]
                          + tablas["fundamentals_snapshot_news"]["mb"] + mb_llm, 1),
    }


def _avanzar(fase: str, hechas: int, total: int) -> None:
    with _lock:
        _state.update(fase=fase, hechas=hechas, total=total)


def _podar_tabla(db, con, tabla: str, snapshots: list[int], marca: int) -> dict:  # noqa: ANN001
    total = len(_ids_foto(db, tabla, snapshots, marca))
    borradas = saltadas = 0
    desde = 0
    while True:
        ids = _ids_foto(db, tabla, snapshots, marca, desde=desde, limite=LOTE)
        if not ids:
            break
        desde = ids[-1]
        archivados = sorted(_en_archivo(con, tabla, ids))
        saltadas += len(ids) - len(archivados)
        if archivados:
            db.execute(text("set local statement_timeout = '60s'"))
            db.execute(text(f"delete from public.{tabla} where id = any(:ids)"),
                       {"ids": archivados})
            db.commit()
            borradas += len(archivados)
        _avanzar(tabla, borradas + saltadas, total)
        time.sleep(_PAUSA_S)
    return {"borradas": borradas, "sin_archivar": saltadas}


def _vaciar_texto_llm(db, con, marca: int) -> dict:  # noqa: ANN001
    total = len(_ids_texto_llm(db, marca))
    vaciadas = saltadas = 0
    desde = 0
    while True:
        ids = _ids_texto_llm(db, marca, desde=desde, limite=LOTE)
        if not ids:
            break
        desde = ids[-1]
        archivados = sorted(_en_archivo(con, "llm_call", ids))
        saltadas += len(ids) - len(archivados)
        if archivados:
            db.execute(text("set local statement_timeout = '60s'"))
            db.execute(text("update public.llm_call set content = null, reasoning = null "
                            "where id = any(:ids)"), {"ids": archivados})
            db.commit()
            vaciadas += len(archivados)
        _avanzar("llm_call", vaciadas + saltadas, total)
        time.sleep(_PAUSA_S)
    return {"vaciadas": vaciadas, "sin_archivar": saltadas}


def _vacuum() -> None:
    """VACUUM normal (no FULL): el hueco queda para lo que entre después, sin bloquear tablas."""
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        for tabla in (*_TABLAS_FOTO, "llm_call"):
            conn.execute(text(f"vacuum (analyze) public.{tabla}"))


def ejecutar(db) -> dict:  # noqa: ANN001
    """La poda de verdad, por lotes. Recalcula todo al empezar: no se fía de una vista previa
    vieja."""
    if engine.dialect.name != "postgresql":
        raise RuntimeError("La poda solo existe contra Postgres.")
    con = _abrir_archivo()
    try:
        marcas = _marcas(con)
        snapshots = [r.id for r in _snapshots_podables(db)]
        out = {"empresas": len(snapshots)}
        for tabla in _TABLAS_FOTO:
            out[tabla] = _podar_tabla(db, con, tabla, snapshots, marcas.get(tabla, 0))
        out["llm_call"] = _vaciar_texto_llm(db, con, marcas.get("llm_call", 0))
    finally:
        con.close()
    _avanzar("vacuum", 0, 0)
    _vacuum()
    logger.info("Poda terminada: %s", out)
    return out


def _run() -> None:
    db = SessionLocal()
    try:
        result = ejecutar(db)
        with _lock:
            _state.update(status="done", result=result, error=None, fase=None,
                          finished_at=datetime.now(UTC).isoformat())
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.exception("Fallo en la poda.")
        with _lock:
            _state.update(status="error", error=str(exc),
                          finished_at=datetime.now(UTC).isoformat())
    finally:
        db.close()


def start() -> bool:
    """Lanza la poda en segundo plano. False si ya hay una poda, un escaneo o una foto en marcha."""
    from app import foto_service, pipeline

    with _lock:
        if (_state["status"] == "running" or pipeline.get_status()["status"] == "running"
                or foto_service.get_status()["status"] == "running"):
            return False
        _state.update(status="running", fase="preparando", hechas=0, total=0, result=None,
                      error=None, started_at=datetime.now(UTC).isoformat(), finished_at=None)
    threading.Thread(target=_run, daemon=True, name="poda").start()
    return True
