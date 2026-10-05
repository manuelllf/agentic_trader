"""Ningún mensaje que llegue a la persona queda sin su versión en inglés."""

import ast
import re
from pathlib import Path

from app.i18n import MESSAGES, present_error_detail

RAIZ = Path(__file__).resolve().parents[1]


def _detalles_fijos() -> list[tuple[str, int, str]]:
    salida = []
    for fichero in (RAIZ / "app").rglob("*.py"):
        for nodo in ast.walk(ast.parse(fichero.read_text(encoding="utf-8"))):
            if not isinstance(nodo, ast.Call):
                continue
            nombre = getattr(nodo.func, "id", getattr(nodo.func, "attr", ""))
            if nombre != "HTTPException":
                continue
            detalle = nodo.args[1] if len(nodo.args) > 1 else next(
                (k.value for k in nodo.keywords if k.arg == "detail"), None)
            if isinstance(detalle, ast.Constant) and isinstance(detalle.value, str):
                salida.append((fichero.name, nodo.lineno, detalle.value))
    return salida


def test_todo_error_http_fijo_tiene_su_traduccion() -> None:
    # «Not Found» es el 404 genérico, igual para todos a propósito.
    sin_traducir = [(f, n, d[:60]) for f, n, d in _detalles_fijos()
                    if d != "Not Found" and present_error_detail(d, "en") == d]
    assert not sin_traducir, f"Faltan en app/messages: {sin_traducir}"


def test_todo_mensaje_de_la_base_de_datos_tiene_su_traduccion() -> None:
    ficheros = [RAIZ / "tests" / "esquema_ci.sql", *(RAIZ / "sql" / "liga").glob("*.sql")]
    mensajes = {m.replace("''", "'").replace("%", "1")
                for f in ficheros if f.exists()
                for m in re.findall(r"raise exception\s+'((?:[^']|'')*)'",
                                    f.read_text(encoding="utf-8"), re.IGNORECASE)}
    assert mensajes, "No se encontró ningún mensaje de la base de datos"
    sin_traducir = sorted(m for m in mensajes if present_error_detail(m, "en") == m)
    assert not sin_traducir, f"Faltan en app/messages: {sin_traducir}"


def test_los_huecos_de_cada_mensaje_coinciden_en_los_dos_idiomas() -> None:
    def huecos(texto: str) -> set[str]:
        return set(re.findall(r"\{(\w+)\}", texto))

    for clave, texto in MESSAGES["es"].items():
        assert huecos(texto) == huecos(MESSAGES["en"][clave]), clave
