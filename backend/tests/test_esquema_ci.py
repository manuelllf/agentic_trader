"""El esquema de CI tiene que incluir la última migración. Si falla, regénéralo con
`scripts/generar_esquema_ci.sh`."""

from __future__ import annotations

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


def _ultima(carpeta: str) -> str:
    numeros = [re.match(r"\d+", f.name).group() for f in (RAIZ / "sql" / carpeta).glob("*.sql")
               if re.match(r"\d+", f.name)]
    return max(numeros, key=int)


def _marca(clave: str) -> str:
    texto = (RAIZ / "tests" / "esquema_ci.sql").read_text(encoding="utf-8")
    encontrada = re.search(rf"^-- {clave}: (\d+)$", texto, re.MULTILINE)
    assert encontrada, f"Falta la marca «{clave}» en tests/esquema_ci.sql"
    return encontrada.group(1)


def test_el_esquema_de_ci_incluye_la_ultima_migracion_de_la_liga() -> None:
    assert _marca("migraciones-liga") == _ultima("liga"), (
        "Hay una migración nueva en sql/liga: ejecuta `bash scripts/generar_esquema_ci.sh`.")


def test_el_esquema_de_ci_incluye_la_ultima_migracion_de_saneamiento() -> None:
    assert _marca("migraciones-saneamiento") == _ultima("saneamiento"), (
        "Hay una migración nueva en sql/saneamiento: ejecuta `bash scripts/generar_esquema_ci.sh`.")
