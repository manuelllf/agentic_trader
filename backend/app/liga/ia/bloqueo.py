"""Lista de bloqueo de moderación (plan §10, F6-A): insultos y palabrotas en español e inglés.
Normaliza minúsculas, tildes/diacríticos y leetspeak básico para que un acento o un "0" por "o"
no la esquiven. Lista corta y a mano — no pretende ser exhaustiva; el modelo barato
(`moderacion.py`) cubre lo que se le escapa."""

from __future__ import annotations

import re
import unicodedata

_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
                       "@": "a", "$": "s"})

# Solo palabras sueltas (comparadas como token) salvo las que llevan espacio, que se buscan como
# subcadena. Sin ánimo de exhaustividad: es la primera barrera, la segunda es el modelo.
_PALABRAS = frozenset({
    # español
    "puta", "puto", "putas", "putos", "gilipollas", "mierda", "cabron", "cabrona", "maricon",
    "marica", "zorra", "hijoputa", "hijodeputa", "subnormal", "retrasado", "sudaca",
    "puta madre", "hijo de puta",
    # inglés
    "fuck", "fucking", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "retard", "whore",
    "asshole", "motherfucker",
})

_CON_ESPACIO = tuple(p for p in _PALABRAS if " " in p)


def normalizar(texto: str) -> str:
    """Minúsculas, sin tildes/diacríticos y leetspeak básico (0→o, 1→i, 3→e…)."""
    sin_tildes = unicodedata.normalize("NFKD", texto.lower())
    sin_tildes = "".join(c for c in sin_tildes if not unicodedata.combining(c))
    return sin_tildes.translate(_LEET)


def tiene_bloqueada(texto: str) -> bool:
    """`True` si alguna palabra de la lista aparece, sola o pegada a otras (alias sin espacios)."""
    limpio = normalizar(texto)
    if any(p in limpio for p in _CON_ESPACIO):
        return True
    solo_letras = re.sub(r"[^a-z]+", " ", limpio)
    palabras = set(solo_letras.split())
    if palabras & _PALABRAS:
        return True
    # Alias tipo "puta123" o "asshole_99": basta con que la palabra aparezca pegada a otra cosa.
    return any(p in solo_letras.replace(" ", "") for p in _PALABRAS if " " not in p)
