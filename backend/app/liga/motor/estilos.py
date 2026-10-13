"""Recetas de partida y pesos del constructor."""

from dataclasses import dataclass

from app.liga.motor.seleccion import PESOS, Receta

PRESETS = {clave: dict(zip(PESOS, (*valores, 0), strict=True))
           for clave, valores in {
               "equilibrado": (25, 25, 25, 25), "negocio": (40, 20, 20, 20),
               "precio": (20, 40, 20, 20), "solidez": (20, 20, 40, 20),
           }.items()}


@dataclass(frozen=True)
class Estilo:
    clave: str
    reglas: tuple[tuple[str, dict], ...]
    preset: str

    def receta(self) -> Receta:
        return Receta(reglas=[{"clave": c, "params": dict(p)} for c, p in self.reglas],
                      pesos=dict(PRESETS[self.preset]), n_empresas=5,
                      reparto="igual", max_por_sector=0)


ESTILOS = {e.clave: e for e in (
    Estilo("calidad", (("rentables", {"roe_pct": 15}), ("margen", {"margen_pct": 15}),
                      ("barata", {"per": 25})), "negocio"),
    Estilo("maduros", (("tamano", {"desde": 10000, "hasta": 5000000}), ("fcf", {"p": 4}),
                      ("payout", {"p": 80}), ("beta", {"p": 1}),
                      ("margen", {"margen_pct": 15})), "solidez"),
    Estilo("dividendo", (("dividendo", {"dividendo_pct": 3}), ("payout", {"p": 70}),
                        ("deuda", {"anios": 2})), "solidez"),
    Estilo("crecimiento", (("crecen", {"crecimiento_pct": 15}),
                          ("margen", {"margen_pct": 10})), "negocio"),
    Estilo("balance", (("caja_neta", {}), ("rentables", {"roe_pct": 10})), "solidez"),
    Estilo("castigadas", (("castigadas_pct", {"p": 30}), ("barata", {"per": 15})), "precio"),
    Estilo("pequenas", (("tamano", {"desde": 300, "hasta": 2000}),
                       ("margen", {"margen_pct": 15}), ("deuda", {"anios": 2})), "negocio"),
)}
