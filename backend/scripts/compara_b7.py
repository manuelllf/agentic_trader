"""B7 fase 1 (docs/liguilla/cambios-bbdd.md): compara la foto vieja (`FundamentalsSnapshotMetric`
+ `FundamentalsSnapshotNews`, una fila por clave/titular) contra las columnas nuevas
(`fundamentals_snapshot.metricas` jsonb, `.titulares` text[]) de una foto ya rellenada por
`rellenar_b7.py`. Solo lectura -- es la verificación antes de dejar de escribir la tabla vieja.

Uso (desde la carpeta backend):
    uv run python scripts/compara_b7.py <foto_id>

Exit code 0 = todo coincide. Exit code 1 = hay mismatches o snapshots sin rellenar (se listan).
"""

from __future__ import annotations

import sys

from app import models  # noqa: F401  (registra las tablas en la metadata)
from app.db import SessionLocal
from app.models import (
    FundamentalsSnapshot,
    FundamentalsSnapshotMetric,
    FundamentalsSnapshotNews,
)
from app.screener.fundamentals import _CLAVES_REPETIDAS_B6

_MAX_LISTADOS = 50


def _viejo(db, snapshot_id: int) -> tuple[dict, list[str]]:  # noqa: ANN001
    """Las filas de la tabla vieja siguen teniendo las 11 claves de B6 (nunca se han borrado) --
    se descartan aquí, no en el sitio que las guarda, porque son justo la comparación que ya NO
    hay que hacer contra `metricas` (B6 las repone desde otra clave o una columna al leer, ver
    `_reponer_claves_repetidas`; eso lo prueba el test dorado, no este script)."""
    metricas = {m.clave: (m.valor_num if m.valor_num is not None else m.valor_texto)
               for m in db.query(FundamentalsSnapshotMetric)
               .filter(FundamentalsSnapshotMetric.fundamentals_snapshot_id == snapshot_id).all()
               if m.clave not in _CLAVES_REPETIDAS_B6}
    titulares = [n.texto for n in db.query(FundamentalsSnapshotNews)
                .filter(FundamentalsSnapshotNews.fundamentals_snapshot_id == snapshot_id)
                .order_by(FundamentalsSnapshotNews.posicion).all()]
    return metricas, titulares


def _comparar(ticker: str, viejo_m: dict, viejo_t: list[str],
             nuevo_m: dict | None, nuevo_t: list[str] | None) -> list[str]:
    if nuevo_m is None and nuevo_t is None:
        return [f"{ticker}: sin rellenar todavía (metricas/titulares NULL)"]
    nuevo_m = nuevo_m or {}
    nuevo_t = nuevo_t or []
    problemas = []
    solo_viejo = sorted(set(viejo_m) - set(nuevo_m))
    solo_nuevo = sorted(set(nuevo_m) - set(viejo_m))
    if solo_viejo:
        problemas.append(f"{ticker}: {len(solo_viejo)} clave(s) solo en la tabla vieja: "
                         f"{solo_viejo[:5]}")
    if solo_nuevo:
        problemas.append(f"{ticker}: {len(solo_nuevo)} clave(s) solo en metricas: {solo_nuevo[:5]}")
    for clave in sorted(set(viejo_m) & set(nuevo_m)):
        va, vb = viejo_m[clave], nuevo_m[clave]
        ambos_num = isinstance(va, float) and isinstance(vb, (int, float))
        distinto = abs(va - float(vb)) > 1e-9 if ambos_num else va != vb
        if distinto:
            problemas.append(f"{ticker}.{clave}: viejo={va!r} vs metricas={vb!r}")
    if viejo_t != nuevo_t:
        problemas.append(f"{ticker}: titulares distintos ({len(viejo_t)} vs {len(nuevo_t)})")
    return problemas


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: uv run python scripts/compara_b7.py <foto_id>")
        return 2
    foto_id = int(sys.argv[1])

    db = SessionLocal()
    try:
        filas = (db.query(FundamentalsSnapshot)
                .filter(FundamentalsSnapshot.foto_id == foto_id).all())
        if not filas:
            print(f"Sin snapshots para foto_id={foto_id}.")
            return 1

        problemas: list[str] = []
        for fila in filas:
            viejo_m, viejo_t = _viejo(db, fila.id)
            problemas += _comparar(fila.ticker, viejo_m, viejo_t, fila.metricas, fila.titulares)

        print(f"Foto {foto_id}: {len(filas)} snapshot(s) comparados.")
        if not problemas:
            print("Todo coincide.")
            return 0

        print(f"{len(problemas)} problema(s):")
        for p in problemas[:_MAX_LISTADOS]:
            print(f"  - {p}")
        if len(problemas) > _MAX_LISTADOS:
            print(f"  ... y {len(problemas) - _MAX_LISTADOS} más")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
