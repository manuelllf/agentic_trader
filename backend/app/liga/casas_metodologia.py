"""Cómo construye su cartera cada equipo de la casa: texto fijo que viaja en el idioma de quien
mira. El resumen es para todos; los pasos, para quien puede ver la cartera en directo."""

from __future__ import annotations

from app.i18n import translate

# Pasos de cada equipo; sus textos viven en `app/messages` como `liga_casa_<clave>_paso_<n>_*`.
PASOS = {"alpha": 5, "lambda": 3, "omega": 4}


def metodologia(clave: str, completa: bool) -> dict:
    pasos = [{"titulo": translate(f"liga_casa_{clave}_paso_{n}_titulo"),
              "texto": translate(f"liga_casa_{clave}_paso_{n}_texto")}
             for n in range(1, PASOS[clave] + 1)] if completa else []
    return {"resumen": translate(f"liga_casa_{clave}_resumen"), "pasos": pasos}
