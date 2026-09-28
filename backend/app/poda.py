"""Poda de lo que ya está archivado en DuckDB.

Proceso de Alpha: se lanza a mano desde el centro de operaciones, con vista previa, y nunca vacía
una fila que el archivo no tenga. Cada lote se comprueba id a id contra `/data/analytics.duckdb`
antes de tocarlo.

De `llm_call` se vacían `content` y `reasoning` a los 90 días; tokens, coste y latencia se quedan.
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

DIAS_TEXTO_LLM = 90
LOTE = 20_000
_PAUSA_S = 0.3

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


_SQL_TEXTO_LLM = """
select id from public.llm_call
where at < now() - make_interval(days => :dias) and (content is not null or reasoning is not null)
  and id <= :marca and id > :desde order by id
"""


def _ids_texto_llm(db, marca: int, desde: int = 0, limite: int | None = None) -> list[int]:  # noqa: ANN001
    sql = _SQL_TEXTO_LLM + (f" limit {int(limite)}" if limite else "")
    return list(db.execute(text(sql), {"dias": DIAS_TEXTO_LLM, "marca": marca,
                                       "desde": desde}).scalars())


def vista_previa(db) -> dict:  # noqa: ANN001
    """Qué borraría la poda ahora, cuánto libera y qué tiene el archivo. No toca nada."""
    if engine.dialect.name != "postgresql":
        raise RuntimeError("La poda solo existe contra Postgres.")
    con = _abrir_archivo()
    try:
        marcas = _marcas(con)
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

    return {
        "reglas": {"dias_texto_llm": DIAS_TEXTO_LLM},
        "marcas_archivo": marcas,
        "texto_llm": {"llamadas": len(archivados_llm),
                      "sin_archivar": len(ids_llm) - len(archivados_llm), "mb": round(mb_llm, 1)},
        "mb_total": round(mb_llm, 1),
    }


def _avanzar(fase: str, hechas: int, total: int) -> None:
    with _lock:
        _state.update(fase=fase, hechas=hechas, total=total)


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
        conn.execute(text("vacuum (analyze) public.llm_call"))


def ejecutar(db) -> dict:  # noqa: ANN001
    """La poda de verdad, por lotes. Recalcula todo al empezar: no se fía de una vista previa
    vieja."""
    if engine.dialect.name != "postgresql":
        raise RuntimeError("La poda solo existe contra Postgres.")
    con = _abrir_archivo()
    try:
        marcas = _marcas(con)
        out = {"llm_call": _vaciar_texto_llm(db, con, marcas.get("llm_call", 0))}
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
