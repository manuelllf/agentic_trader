"""Sin su base, una prueba se salta y sale en verde: en CI no puede faltar ninguna."""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

_TESTS = Path(__file__).resolve().parent
_WORKFLOW = _TESTS.parents[1] / ".github" / "workflows" / "ci.yml"
_VARIABLE = re.compile(r"""["']([A-Z]+_TEST_DATABASE_URL)["']""")


def _variables_que_piden_las_pruebas() -> set[str]:
    textos = (f.read_text(encoding="utf-8") for f in _TESTS.rglob("*.py"))
    return {v for texto in textos for v in _VARIABLE.findall(texto)}


def test_el_workflow_define_todas_las_bases_que_piden_las_pruebas() -> None:
    pedidas = _variables_que_piden_las_pruebas()
    assert {"LIGA_TEST_DATABASE_URL", "AGENTE_TEST_DATABASE_URL"} <= pedidas
    workflow = _WORKFLOW.read_text(encoding="utf-8")
    assert sorted(v for v in pedidas if f"{v}: " not in workflow) == []


def test_en_ci_las_bases_estan_puestas() -> None:
    if not os.environ.get("CI"):
        pytest.skip("Solo se exige en CI")
    assert sorted(v for v in _variables_que_piden_las_pruebas() if not os.environ.get(v)) == []
