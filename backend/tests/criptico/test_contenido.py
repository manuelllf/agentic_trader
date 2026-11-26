"""Pistas desde la 073: las letras cuadran, nada regala la respuesta y se varía el mecanismo."""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from datetime import date, timedelta
from itertools import pairwise
from pathlib import Path

import pytest

_SQL = Path(__file__).resolve().parents[2] / "sql/liga/073_criptico_contenido_v5.sql"
_COLUMNAS = (
    "idioma", "numero", "dia", "pista", "longitud", "respuesta", "palabra", "nivel", "ayudas",
    "resolucion", "concepto", "ejemplo", "regla_catalogo", "estado",
)
_NUMEROS = range(25, 62)


def _plano(texto: str) -> str:
    return re.sub("[^A-Z]", "", unicodedata.normalize("NFD", texto.upper()))


def _palabras(texto: str) -> list[str]:
    return [p for p in (_plano(t) for t in re.split(r"[^\w]+", texto)) if p]


def _filas() -> list[dict]:
    lineas = _SQL.read_text(encoding="utf-8").splitlines()
    sql = "\n".join(x for x in lineas if not x.startswith("--"))
    cuerpo = sql.split("\nvalues\n", 1)[1].split("\non conflict", 1)[0]
    valores = re.findall(r"'((?:[^']|'')*)'(?:::jsonb)?|\b(null|\d+)\b", cuerpo)
    sueltos = [numero if numero else texto.replace("''", "'") for texto, numero in valores]
    ancho = len(_COLUMNAS)
    assert len(sueltos) % ancho == 0, "alguna fila no tiene todas las columnas"
    filas = [dict(zip(_COLUMNAS, sueltos[i:i + ancho], strict=True))
             for i in range(0, len(sueltos), ancho)]
    for f in filas:
        f["numero"], f["longitud"] = int(f["numero"]), int(f["longitud"])
        f["pista"], f["ayudas"] = json.loads(f["pista"]), json.loads(f["ayudas"])
    return filas


FILAS = {(f["idioma"], f["numero"]): f for f in _filas()}


# Piezas de cada receta: devuelven las letras que aportan a la respuesta.
def anag(material: str, resultado: str) -> str:
    assert Counter(_plano(material)) == Counter(resultado), f"{material} no da {resultado}"
    return resultado


def oculta(texto: str, resultado: str) -> str:
    assert resultado in _plano(texto), f"{resultado} no está en {texto}"
    sueltas = _palabras(texto)
    assert not any(resultado in p for p in sueltas), f"{resultado} se lee en una sola palabra"
    return resultado


def quita(palabra: str, letras: str, donde: int) -> str:
    """Quita `letras` en la posición `donde`; con -1, del final."""
    inicio = donde if donde >= 0 else len(palabra) - len(letras)
    assert palabra[inicio:inicio + len(letras)] == letras
    return palabra[:inicio] + palabra[inicio + len(letras):]


def mete(fuera: str, dentro: str, en: int) -> str:
    return fuera[:en] + dentro + fuera[en:]


def reves(palabra: str) -> str:
    return palabra[::-1]


def iniciales(texto: str) -> str:
    return "".join(p[0] for p in _palabras(texto))


# (mecanismo, piezas). Sin piezas, revisadas a mano: dobles, disfrazadas y homófonos.
_ES: list[tuple[str, list[str]]] = [
    ("dentro", [mete("DUDA", "E", 1)]),
    ("reves", [reves("LAVA")]),
    ("doble", []),
    ("suma", [quita("PRESTO", "O", -1), "AMO"]),
    ("anagrama", [anag("Sergio", "RIESGO")]),
    ("resta", [quita("TORO", "T", 0)]),
    ("suma", ["VA", quita("LORO", "O", -1)]),
    ("oculta", [oculta("súper didáctico", "PERDIDA")]),
    ("criptica", []),
    ("resta", [quita("FRACTURA", "R", 1)]),
    ("suma", ["SOL", "VENCIA"]),
    ("oculta", [oculta("casino mina", "NOMINA")]),
    ("doble", []),
    ("anagrama", [anag("otra fe", "OFERTA")]),
    ("dentro", [mete("MODA", "NE", 2)]),
    ("oculta", [oculta("colega dolido", "LEGADO")]),
    ("resta", [quita("QUID", "D", -1), quita("CEBRA", "C", 0)]),
    ("triple", []),
    ("iniciales", [iniciales("ingresa mucho para un Estado siempre tan ocupado")]),
    ("resta", [quita("ANETO", "A", 0)]),
    ("sonido", []),
    ("dentro", [mete("PAJE", "E", 1)]),
    ("doble", []),
    ("suma", ["A", quita("HORROR", "R", -1)]),
    ("anagrama", [anag("Caín filón", "INFLACION")]),
    ("sonido", []),
    ("anagrama", [anag("duelos", "SUELDO")]),
    ("reves", [reves(quita("AROMA", "A", -1))]),
    ("anagrama", [anag("Guido Alan", "AGUINALDO")]),
    ("oculta", [oculta("dulces también", "CESTA")]),
    ("suma", ["G", "ANA", "N", "CIA"]),
    ("doble", []),
    ("oculta", [oculta("de mandarinas", "DEMANDA")]),
    ("suma", ["MAR", "GEN"]),
    ("cambio", ["C", "U", quita("CAPON", "CA", 0)]),
    ("suma", ["BALAN", "CE"]),
    ("doble", []),
]
_EN: list[tuple[str, list[str]]] = [
    ("resta", [quita("DEBUT", "U", 3)]),
    ("suma", ["P", "LEDGE"]),
    ("dentro", ["PRE", mete("MUM", "I", 1)]),
    ("suma", ["LO", "AN"]),
    ("resta", [quita("BRISK", "B", 0)]),
    ("suma", ["G", "OLD"]),
    ("oculta", [oculta("rival UEFA", "VALUE")]),
    ("resta", [quita("GLOSS", "G", 0)]),
    ("cambio", ["B", quita("RUBBLE", "R", 0)]),
    ("anagrama", [anag("I novice", "INVOICE")]),
    ("doble", []),
    ("oculta", [oculta("universal Arya", "SALARY")]),
    ("sonido", []),
    ("suma", ["OFF", "ER"]),
    ("oculta", [oculta("disco invitation", "COIN")]),
    ("anagrama", [anag("L cagey", "LEGACY")]),
    ("doble", []),
    ("dentro", [mete(anag("toucan", "ACOUNT"), "C", 2)]),
    ("suma", ["TA", "X"]),
    ("reves", [reves("TEN")]),
    ("suma", ["FOR", "TUNE"]),
    ("resta", [quita("ATOLL", "A", 0)]),
    ("suma", ["BROKE", "R"]),
    ("resta", [quita("THERIFT", "E", 2)]),
    ("suma", ["IN", "FLAT", "ION"]),
    ("oculta", [oculta("Java trade", "VAT")]),
    ("doble", []),
    ("suma", ["DE", "FAULT"]),
    ("oculta", [oculta("carbon use", "BONUS")]),
    ("anagrama", [anag("bakes T", "BASKET")]),
    ("sonido", []),
    ("anagrama", [anag("if raft", "TARIFF")]),
    ("suma", ["DEM", "AND"]),
    ("anagrama", [anag("arming", "MARGIN")]),
    ("suma", ["COUP", "ON"]),
    ("oculta", [oculta("global ancestry", "BALANCE")]),
    ("suma", ["TAR", "GET"]),
]
RECETAS = {"es": dict(zip(_NUMEROS, _ES, strict=True)), "en": dict(zip(_NUMEROS, _EN, strict=True))}
CASOS = [(idioma, n) for idioma in ("es", "en") for n in _NUMEROS]


def test_hay_un_acertijo_por_dia_en_los_dos_idiomas_hasta_el_uno_de_enero() -> None:
    assert sorted(FILAS) == sorted(CASOS)
    curva = ("facil", "facil", "media", "media", "media", "dificil", "dificil")
    for (_, numero), f in FILAS.items():
        dia = date.fromisoformat(f["dia"])
        assert dia == date(2026, 11, 26) + timedelta(days=numero - 25)
        assert f["nivel"] == curva[dia.weekday()]
        assert f["estado"] == "borrador"
    assert FILAS["es", 61]["dia"] == "2027-01-01"


@pytest.mark.parametrize(("idioma", "numero"), CASOS)
def test_las_letras_cuadran(idioma: str, numero: int) -> None:
    fila = FILAS[idioma, numero]
    respuesta, piezas = fila["respuesta"], RECETAS[idioma][numero][1]
    assert fila["longitud"] == len(respuesta)
    assert _plano(fila["palabra"]) == respuesta
    if piezas:
        assert "".join(piezas) == respuesta
    assert respuesta in _plano(fila["resolucion"])


@pytest.mark.parametrize(("idioma", "numero"), CASOS)
def test_ni_la_pista_ni_las_ayudas_regalan_la_respuesta(idioma: str, numero: int) -> None:
    fila = FILAS[idioma, numero]
    respuesta = fila["respuesta"]
    pista = "".join(s["texto"] for s in fila["pista"])
    for palabra in _palabras(pista):
        assert respuesta not in palabra, f"«{palabra}» contiene {respuesta}"
        # Misma familia: ALZAR para ALZA, COMPRAMOS para COMPRA, COSTLY para COST.
        assert not palabra.startswith(respuesta[:4]), f"«{palabra}» empieza como {respuesta}"
    assert any(s["papel"] == "def" for s in fila["pista"])
    assert set(fila["ayudas"]) == {"def", "ind", "mat"}
    for ayuda in fila["ayudas"].values():
        assert not any(respuesta in p for p in _palabras(ayuda)), ayuda


@pytest.mark.parametrize("idioma", ["es", "en"])
def test_el_mecanismo_varia(idioma: str) -> None:
    mecanismos = [RECETAS[idioma][n][0] for n in _NUMEROS]
    assert all(a != b for a, b in pairwise(mecanismos)), mecanismos
    for inicio in range(len(mecanismos) - 13):
        quincena = Counter(mecanismos[inicio:inicio + 14])
        assert quincena["doble"] <= 3 and quincena["anagrama"] <= 3, (inicio + 25, quincena)
    assert len(set(mecanismos)) >= 7


def test_ninguna_respuesta_se_repite_dentro_de_un_idioma() -> None:
    for idioma in ("es", "en"):
        respuestas = [FILAS[idioma, n]["respuesta"] for n in _NUMEROS]
        assert len(respuestas) == len(set(respuestas))
