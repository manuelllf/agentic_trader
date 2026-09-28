"""B7 fase 1 (docs/liguilla/cambios-bbdd.md): rellena `metricas`/`titulares` de una foto ya
capturada a partir de las filas viejas (`FundamentalsSnapshotMetric`/`FundamentalsSnapshotNews`)
-- por lotes, con `statement_timeout` (mismo patrón que `app/poda.py`). Solo hace UPDATE de las
dos columnas nuevas: nunca toca ni borra la tabla vieja. Idempotente -- recorre los ids de la foto
una vez (cursor por `id`, nunca por "sigue NULL") y salta el snapshot si ya está relleno, así que
repetir la corrida no duplica ni sobrescribe nada ya hecho. El cursor por `id` es a propósito y no
un filtro "metricas IS NULL" reconsultado en cada vuelta: un snapshot sin ninguna métrica cruda
(capturas vacías, raras pero reales) guarda `metricas = NULL` igual que uno relleno -- con ese
filtro el script no lo distinguiría nunca de "pendiente" y se quedaría reprocesándolo para siempre.

Uso (desde la carpeta backend):
    uv run python scripts/rellenar_b7.py <foto_id> [--lote 500]
"""

from __future__ import annotations

import sys
import time

from sqlalchemy import text

from app import models  # noqa: F401  (registra las tablas en la metadata)
from app.db import SessionLocal, engine
from app.models import (
    FundamentalsSnapshot,
    FundamentalsSnapshotMetric,
    FundamentalsSnapshotNews,
)
from app.screener.fundamentals import _CLAVES_REPETIDAS_B6

_LOTE_DEFECTO = 500
_PAUSA_S = 0.2


def _lote_ids(db, foto_id: int, desde: int, lote: int) -> list[int]:  # noqa: ANN001
    return [r.id for r in db.query(FundamentalsSnapshot.id)
           .filter(FundamentalsSnapshot.foto_id == foto_id, FundamentalsSnapshot.id > desde)
           .order_by(FundamentalsSnapshot.id).limit(lote).all()]


def _rellenar_uno(db, snapshot_id: int) -> None:  # noqa: ANN001
    # Mismo filtro que `foto_guardar` (B6): estas 11 claves no van a `metricas`, se reponen al
    # leer desde su duplicado o su columna (ver `_reponer_claves_repetidas`).
    metricas = {m.clave: (m.valor_num if m.valor_num is not None else m.valor_texto)
               for m in db.query(FundamentalsSnapshotMetric)
               .filter(FundamentalsSnapshotMetric.fundamentals_snapshot_id == snapshot_id).all()
               if m.clave not in _CLAVES_REPETIDAS_B6}
    titulares = [n.texto for n in db.query(FundamentalsSnapshotNews)
                .filter(FundamentalsSnapshotNews.fundamentals_snapshot_id == snapshot_id)
                .order_by(FundamentalsSnapshotNews.posicion).all()]
    fila = db.get(FundamentalsSnapshot, snapshot_id)
    fila.metricas = metricas or None
    fila.titulares = titulares or None


def rellenar(db, foto_id: int, lote: int = _LOTE_DEFECTO) -> int:  # noqa: ANN001
    revisados = rellenados = 0
    desde = 0
    while True:
        ids = _lote_ids(db, foto_id, desde, lote)
        if not ids:
            break
        desde = ids[-1]
        db.execute(text("set local statement_timeout = '60s'"))
        for sid in ids:
            fila = db.get(FundamentalsSnapshot, sid)
            if fila.metricas is not None:   # ya relleno (idempotente, ver docstring del módulo)
                continue
            _rellenar_uno(db, sid)
            rellenados += 1
        db.commit()
        revisados += len(ids)
        print(f"  {revisados} snapshot(s) revisados, {rellenados} rellenados...")
        time.sleep(_PAUSA_S)
    return rellenados


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: uv run python scripts/rellenar_b7.py <foto_id> [--lote 500]")
        return 2
    foto_id = int(sys.argv[1])
    lote = _LOTE_DEFECTO
    if "--lote" in sys.argv:
        lote = int(sys.argv[sys.argv.index("--lote") + 1])

    if engine.dialect.name != "postgresql":
        print("Solo tiene sentido contra Postgres (metricas/titulares son jsonb/text[]).")
        return 1

    db = SessionLocal()
    try:
        total = rellenar(db, foto_id, lote)
    finally:
        db.close()

    print(f"Foto {foto_id}: {total} snapshot(s) rellenados en esta corrida.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
