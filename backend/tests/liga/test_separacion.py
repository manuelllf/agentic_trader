"""Separación intocable (plan §14): la liguilla nunca lee la cartera personal, nunca llama a IBKR
y nunca escribe en las tablas de las salas (`public.*`) salvo lo whitelisted a propósito. Análisis
estático de texto sobre `backend/app/liga/**`: no hace falta una BD para que este test proteja la
frontera, y cae en CI aunque nadie recuerde correr `test_liga_rls.py` con Postgres."""

from __future__ import annotations

import re
from pathlib import Path

RAIZ_LIGA = Path(__file__).resolve().parents[2] / "app" / "liga"

# Tablas de `public` en las que la liga SÍ escribe, cada una con su motivo (plan §14, §10):
# - `llm_call`: cada llamada de IA de la liga deja su fila de coste/telemetría ahí (`ia/comun.py`).
_TABLAS_PERMITIDAS = {"llm_call"}

_IMPORT_PROHIBIDO = re.compile(
    r"^\s*(?:from\s+(app\.brokers(?:\.\w+)*|ibind)\b|import\s+(app\.brokers(?:\.\w+)*|ibind)\b)",
    re.MULTILINE)

# Contenido de un `text("""...""")`/`text('...')` — donde vive el SQL crudo de este código.
_TEXT_SQL = re.compile(r'text\(\s*(?:f?"""(.*?)"""|f?\'\'\'(.*?)\'\'\'|f?"([^"]*)"|f?\'([^\']*)\')',
                       re.DOTALL)
# `UPDATE <tabla> SET` (no solo "UPDATE", que también aparece en "ON CONFLICT ... DO UPDATE SET"
# sin tabla — es un UPSERT sobre la fila que ya nombró el INSERT de la misma sentencia).
_ESCRITURA = re.compile(
    r'\binsert\s+into\s+(?:public\.)?([a-z_][a-z0-9_]*)'
    r'|\bupdate\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+set\b'
    r'|\bdelete\s+from\s+(?:public\.)?([a-z_][a-z0-9_]*)', re.IGNORECASE)


def _ficheros() -> list[Path]:
    return sorted(p for p in RAIZ_LIGA.rglob("*.py") if "__pycache__" not in p.parts)


def test_sin_import_de_brokers_ni_ibind() -> None:
    ficheros = _ficheros()
    assert ficheros
    for f in ficheros:
        texto = f.read_text(encoding="utf-8")
        assert not _IMPORT_PROHIBIDO.search(texto), f"{f} importa app.brokers o ibind"


def test_sin_referencia_a_personal_positions() -> None:
    for f in _ficheros():
        texto = f.read_text(encoding="utf-8")
        # La propia mención en un docstring («nunca se lee personal_positions») no cuenta: solo
        # el nombre de la tabla pegado a algo que huela a SQL (select/from/join/insert/update).
        for m in re.finditer(r".{0,40}personal_positions.{0,10}", texto):
            contexto = m.group(0).lower()
            assert not re.search(r"select|from|join|insert|update|delete", contexto), (
                f"{f} parece consultar personal_positions: {m.group(0)!r}")


def test_solo_llm_call_se_escribe_en_tablas_de_las_salas() -> None:
    for f in _ficheros():
        texto = f.read_text(encoding="utf-8")
        for bloque in _TEXT_SQL.finditer(texto):
            sql = next(g for g in bloque.groups() if g is not None)
            for escritura in _ESCRITURA.finditer(sql):
                tabla = next(g for g in escritura.groups() if g is not None).lower()
                if tabla.startswith("liga") or tabla in _TABLAS_PERMITIDAS:
                    continue
                raise AssertionError(
                    f"{f} escribe en public.{tabla} (fuera de {_TABLAS_PERMITIDAS}): {sql[:200]!r}")


def test_solo_llm_call_se_anade_por_orm() -> None:
    """El único modelo de `app.models` (esquema `public`) que se importa en `app.liga.*` es
    `LLMCall`; cualquier otro `db.add(...)` a un modelo de las salas se colaría por aquí."""
    patron = re.compile(r"from\s+app\.models\s+import\s+([^\n]+)")
    for f in _ficheros():
        texto = f.read_text(encoding="utf-8")
        for m in patron.finditer(texto):
            nombres = {n.strip() for n in m.group(1).split(",")}
            extra = nombres - {"LLMCall"}
            assert not extra, f"{f} importa de app.models algo más que LLMCall: {extra}"
