"""Lista de bloqueo de moderación (plan §10, F6-A): insultos y palabrotas en español e inglés.
Normaliza minúsculas, tildes/diacríticos y leetspeak básico para que un acento o un "0" por "o"
no la esquiven. Lista corta y a mano — no pretende ser exhaustiva; el modelo barato
(`moderacion.py`) cubre lo que se le escapa."""

from __future__ import annotations

import re
import unicodedata

_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
                       "@": "a", "$": "s"})

# Se bloquean aunque vayan pegadas a otras letras («xfuckx»): no aparecen dentro de palabras
# normales.
_FUERTES = ("fuck", "asshole", "nigger", "nigga", "faggot", "gilipollas", "hijoputa",
            "hijodeputa", "maricon", "cabron", "mierda", "bitch", "whore", "sudaca")

# Solo cuentan como palabra entera: escondidas en otras son palabras normales («reputation»,
# «computacion», «Scunthorpe», «Fire Retardant», «cash it all»).
_ENTERAS = frozenset({"puta", "puto", "putas", "putos", "marica", "zorra", "subnormal",
                      "retrasado", "shit", "cunt", "retard"})

_FRASES = re.compile(r"\b(?:puta madre|hijo de puta)\b")


def normalizar(texto: str) -> str:
    """Minúsculas, sin tildes/diacríticos y leetspeak básico (0→o, 1→i, 3→e…)."""
    sin_tildes = _sin_tildes(texto)
    return sin_tildes.translate(_LEET)


def _sin_tildes(texto: str) -> str:
    descompuesto = unicodedata.normalize("NFKD", texto.lower())
    return "".join(c for c in descompuesto if not unicodedata.combining(c))


def tiene_bloqueada(texto: str) -> bool:
    """`True` si hay una palabra de la lista. Se mira de dos maneras: con leetspeak («pu7a») y
    tomando cifras y símbolos como separadores («puta123», «asshole_99»)."""
    for limpio in (normalizar(texto), _sin_tildes(texto)):
        if _FRASES.search(re.sub(r"[^a-z]+", " ", limpio)):
            return True
        for token in re.findall(r"[a-z]+", limpio):
            if token in _ENTERAS or any(p in token for p in _FUERTES):
                return True
    return False
