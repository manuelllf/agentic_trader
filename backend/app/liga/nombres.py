"""Normalización de nombres libres (plan §14: «normalización Unicode… sin homoglifos de Alpha»).

El alias ya tiene su propio `CHECK` en la BD (formato `[a-z0-9_.]` + lista de reservados,
`sql/liga/001` y `008`): no hace falta nada aquí para él. Esto es para nombres LIBRES que no
pueden llevar un `CHECK` tan listo (nombre de estrategia, nombre de liga): NFKC-normaliza y
rechaza lo que, tras plegar los homoglifos habituales (cirílico, griego, dígitos que imitan
letras) y quitar espacios y puntuación, coincide con un nombre de la casa o reservado."""

from __future__ import annotations

import unicodedata

from fastapi import HTTPException

# Mismos reservados que la BD (`alias_reservado`) más las tres casas, que no llevan alias propio.
RESERVADOS = frozenset({
    "alpha", "omega", "lambda", "admin", "administrador", "liguilla", "liga", "moderacion",
    "moderador", "soporte", "ayuda", "casa", "sistema", "root", "staff", "jev",
})

# Cirílico y griego que se leen igual que una letra latina, más el leetspeak básico ya usado en
# `ia/bloqueo.py` — aquí además se pliegan may/minúsculas de ambos alfabetos.
_HOMOGLIFOS = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ѕ": "s",
    "А": "a", "Е": "e", "О": "o", "Р": "p", "С": "c", "У": "y", "Х": "x", "В": "b", "Н": "h",
    "К": "k", "М": "m", "Т": "t", "І": "i",
    "α": "a", "β": "b", "ο": "o", "ρ": "p", "τ": "t", "υ": "y", "ν": "v", "μ": "m", "λ": "l",
    "Α": "a", "Β": "b", "Ο": "o", "Ρ": "p", "Τ": "t", "Χ": "x", "Λ": "l",
    "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s",
})


def _llave(texto: str) -> str:
    """NFKC + homoglifos plegados (antes de minúsculas: la tabla lleva sus propias mayúsculas) +
    solo letras y dígitos: la forma que se compara contra los reservados (así "Аlpha", "a1pha" y
    "alpha " chocan igual que "alpha")."""
    normal = unicodedata.normalize("NFKC", texto)
    plegado = normal.translate(_HOMOGLIFOS).casefold()
    return "".join(c for c in plegado if c.isalnum())


def choca_con_reservado(texto: str) -> bool:
    return _llave(texto) in RESERVADOS


def validar_nombre(texto: str) -> str:
    """NFKC-normaliza y rechaza si el nombre imita a la casa o a un reservado; devuelve el texto
    ya normalizado (NFKC), listo para guardar."""
    normalizado = unicodedata.normalize("NFKC", texto)
    if choca_con_reservado(normalizado):
        raise HTTPException(422, "Ese nombre está reservado. Prueba con otro.")
    return normalizado
