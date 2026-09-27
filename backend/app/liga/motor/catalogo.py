"""Catálogo de reglas de la liga: los filtros exactos que una estrategia aplica a la foto del mes.

Una regla se guarda en la receta como `{"clave": "deuda", "params": {"anios": 2}}` (jsonb) y la
receta lleva una lista de ellas, en orden. Cada regla sabe describirse y explicar en castellano
por qué una empresa no la cumple, con sus cifras: «vale 1.900 M$ y pides más de 2.000 M$». Un
dato que falta nunca pasa, y la regla lo dice («no hay dato de deuda»).

Es código versionado: si una regla cambia de significado, sube `CATALOGO_VERSION`.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.liga.motor.formato import a_decimal, cifra, millones_usd, porcentaje

CATALOGO_VERSION = 1

# Los 11 sectores de Yahoo, con su nombre para los textos.
SECTORES_ES: dict[str, str] = {
    "Basic Materials": "Materiales básicos",
    "Communication Services": "Comunicaciones",
    "Consumer Cyclical": "Consumo cíclico",
    "Consumer Defensive": "Consumo básico",
    "Energy": "Energía",
    "Financial Services": "Servicios financieros",
    "Healthcare": "Salud",
    "Industrials": "Industria",
    "Real Estate": "Inmobiliario",
    "Technology": "Tecnología",
    "Utilities": "Servicios públicos",
}

_CHIPS = frozenset({"Semiconductors", "Semiconductor Equipment & Materials"})
_MILLON = Decimal(1_000_000)
_GRANDE = Decimal(10_000)
_MEDIANA = Decimal(2_000)
_PEQUENA = Decimal(300)
_DIVIDENDO = Decimal("2.5")
_CRECIMIENTO = Decimal(5)
_MARGEN = Decimal(15)
_ROE = Decimal(15)
_CAIDA = Decimal(30)


class RecetaNoValida(ValueError):
    """Una receta o sus reglas no se pueden aplicar; `errores` dice por qué, en castellano."""

    def __init__(self, errores: list[str]) -> None:
        super().__init__(" ".join(errores))
        self.errores = errores


@dataclass(frozen=True)
class EmpresaFoto:
    """Una empresa de la foto del mes, tal como la lee el motor.

    Unidades: `market_cap_usd`, `deuda_total`, `caja_total` y `ebitda` en dólares (no millones);
    `dividend_yield_pct` ya en % (2.5 es un 2,5 %); `crecimiento_ventas`, `margen_operativo` y
    `roe` en tanto por uno (0.05 es un 5 %); `per`, el de los últimos doce meses; `max_52s`, el
    máximo del último año. `sector` e `industria`, los de Yahoo en inglés."""

    ticker: str
    nombre: str | None = None
    sector: str | None = None
    industria: str | None = None
    market_cap_usd: float | None = None
    precio: float | None = None
    max_52s: float | None = None
    per: float | None = None
    dividend_yield_pct: float | None = None
    crecimiento_ventas: float | None = None
    margen_operativo: float | None = None
    roe: float | None = None
    deuda_total: float | None = None
    caja_total: float | None = None
    ebitda: float | None = None


@dataclass(frozen=True)
class Parametro:
    """Un ajuste de una regla. Los numéricos van de `minimo` a `maximo`, de `paso` en `paso`;
    los de sectores (`tipo="sectores"`) son una lista no vacía de `SECTORES_ES`, sin defecto."""

    nombre: str
    etiqueta: str
    minimo: Decimal | None = None
    maximo: Decimal | None = None
    paso: Decimal | None = None
    defecto: int | float | None = None
    tipo: str = "numero"


@dataclass(frozen=True)
class ReglaCatalogo:
    clave: str
    titulo: str
    fn_detalle: Callable[[Mapping[str, Any]], str] = field(repr=False)
    fn_evaluar: Callable[[EmpresaFoto, Mapping[str, Any]], str | None] = field(repr=False)
    parametros: tuple[Parametro, ...] = ()

    def params_por_defecto(self) -> dict[str, Any]:
        return {p.nombre: p.defecto for p in self.parametros if p.defecto is not None}

    def detalle(self, params: Mapping[str, Any] | None = None) -> str:
        """La regla contada en una línea: «deuda neta de menos de 2 años de beneficio operativo»."""
        return self.fn_detalle(self._con_defectos(params))

    def evaluar(self, empresa: EmpresaFoto, params: Mapping[str, Any] | None = None) -> str | None:
        """`None` si la empresa la cumple; si no, el motivo en castellano, sin punto final."""
        return self.fn_evaluar(empresa, self._con_defectos(params))

    def _con_defectos(self, params: Mapping[str, Any] | None) -> dict[str, Any]:
        todos = {**self.params_por_defecto(), **(params or {})}
        faltan = [p.nombre for p in self.parametros if p.nombre not in todos]
        if faltan:
            raise ValueError(f"«{self.titulo}» necesita {', '.join(faltan)}")
        return todos


@dataclass(frozen=True)
class ReglaPreparada:
    """Una regla ya validada, con sus ajustes: se evalúa miles de veces sin revalidar."""

    regla: ReglaCatalogo
    params: Mapping[str, Any]

    def evaluar(self, empresa: EmpresaFoto) -> str | None:
        return self.regla.fn_evaluar(empresa, self.params)


def sector_es(sector: str) -> str:
    """Nombre en castellano de un sector de Yahoo; si no es de los 11, tal cual."""
    return SECTORES_ES.get(sector, sector)


# --- Evaluación: None si pasa; si no, el motivo -------------------------------------------------


def _texto(valor: str | None) -> str | None:
    if not isinstance(valor, str):
        return None
    return valor.strip() or None


def _capitalizacion(e: EmpresaFoto) -> Decimal | None:
    """En millones de dólares, que es como se habla de ella."""
    cap = a_decimal(e.market_cap_usd)
    return cap / _MILLON if cap is not None and cap > 0 else None


def _mas_de(e: EmpresaFoto, umbral: Decimal) -> str | None:
    cap = _capitalizacion(e)
    if cap is None:
        return "no hay dato de capitalización"
    if cap > umbral:
        return None
    return f"vale {millones_usd(cap, (umbral,))} y pides más de {millones_usd(umbral)}"


def _grandes(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    return _mas_de(e, _GRANDE)


def _medianas(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    return _mas_de(e, _MEDIANA)


def _pequenas(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    cap = _capitalizacion(e)
    if cap is None:
        return "no hay dato de capitalización"
    if _PEQUENA <= cap <= _MEDIANA:
        return None
    return (f"vale {millones_usd(cap, (_PEQUENA, _MEDIANA))} y pides entre "
            f"{cifra(_PEQUENA, 0)} y {millones_usd(_MEDIANA)}")


def _anios(valor: Decimal, frente_a: tuple[Decimal, ...] = ()) -> str:
    t = cifra(valor, 1, frente_a)
    return f"{t} {'año' if t == '1' else 'años'}"


def _deuda_y_caja(e: EmpresaFoto) -> tuple[Decimal, Decimal] | str:
    deuda, caja = a_decimal(e.deuda_total), a_decimal(e.caja_total)
    if deuda is None:
        return "no hay dato de deuda"
    if caja is None:
        return "no hay dato de caja"
    return deuda, caja


def _deuda(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    datos = _deuda_y_caja(e)
    if isinstance(datos, str):
        return datos
    deuda, caja = datos
    neta = deuda - caja
    if neta <= 0:
        return None
    ebitda = a_decimal(e.ebitda)
    if ebitda is None:
        return "no hay dato de beneficio operativo"
    if ebitda <= 0:
        return "no gana con qué pagar su deuda"
    maximo = a_decimal(p["anios"])
    anios = neta / ebitda
    if anios < maximo:
        return None
    return f"debe {_anios(anios, (maximo,))} de beneficio y pides menos de {cifra(maximo)}"


def _caja_neta(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    datos = _deuda_y_caja(e)
    if isinstance(datos, str):
        return datos
    deuda, caja = datos
    if caja > deuda:
        return None
    return "tiene tanta deuda como caja" if caja == deuda else "tiene más deuda que caja"


def _barata(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    per = a_decimal(e.per)
    maximo = a_decimal(p["per"])
    if per is None or per == 0:
        return "no hay dato de PER"
    if per < 0:
        return "tiene un PER negativo: pierde dinero"
    if per < maximo:
        return None
    return f"tiene un PER de {cifra(per, 1, (maximo,))} y pides menos de {cifra(maximo)}"


def _dividendo(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    rentabilidad = a_decimal(e.dividend_yield_pct)
    if rentabilidad is None:
        return "no consta que reparta dividendo"
    if rentabilidad > _DIVIDENDO:
        return None
    return (f"su dividendo es del {porcentaje(rentabilidad, 1, (_DIVIDENDO,))} "
            f"y pides más del {porcentaje(_DIVIDENDO)}")


def _crecen(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    ratio = a_decimal(e.crecimiento_ventas)
    if ratio is None:
        return "no hay dato de cómo crecen sus ventas"
    pct = ratio * 100
    if pct > _CRECIMIENTO:
        return None
    pides = f"más de un {porcentaje(_CRECIMIENTO)}"
    if pct < 0 and cifra(-pct) != "0":
        return f"sus ventas caen un {porcentaje(-pct)} al año y pides que crezcan {pides}"
    return f"sus ventas crecen un {porcentaje(pct, 1, (_CRECIMIENTO,))} al año y pides {pides}"


def _margen(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    ratio = a_decimal(e.margen_operativo)
    if ratio is None:
        return "no hay dato de margen operativo"
    pct = ratio * 100
    if pct > _MARGEN:
        return None
    return (f"su margen es del {porcentaje(pct, 1, (_MARGEN,))} "
            f"y pides más del {porcentaje(_MARGEN)}")


def _rentables(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    ratio = a_decimal(e.roe)
    if ratio is None:
        return "no hay dato de rentabilidad sobre su capital"
    pct = ratio * 100
    if pct > _ROE:
        return None
    pides = f"más del {porcentaje(_ROE)}"
    if pct < 0 and cifra(-pct) != "0":
        return f"pierde un {porcentaje(-pct)} sobre su capital y pides que gane {pides}"
    return f"gana un {porcentaje(pct, 1, (_ROE,))} sobre su capital y pides {pides}"


def _castigadas(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    precio, maximo = a_decimal(e.precio), a_decimal(e.max_52s)
    if precio is None or precio <= 0:
        return "no hay dato de precio"
    if maximo is None or maximo <= 0:
        return "no hay dato de su máximo del último año"
    caida = (1 - precio / maximo) * 100
    if caida >= _CAIDA:
        return None
    pides = f"un {porcentaje(_CAIDA)} o más"
    if caida <= 0 or cifra(caida) == "0":
        return f"está en su máximo del último año y pides que haya caído {pides}"
    return f"está a un {porcentaje(caida, 1, (_CAIDA,))} de su máximo y pides {pides}"


def _sin_energia(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    sector = _texto(e.sector)
    if sector is None:
        return "no hay dato de sector"
    return "es del sector energético, que dejaste fuera" if sector == "Energy" else None


def _sin_bancos(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    industria = _texto(e.industria)
    if industria is None:
        return "no hay dato de industria"
    return "es un banco, y dejaste fuera la banca" if industria.startswith("Banks") else None


def _sin_tabaco(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    industria = _texto(e.industria)
    if industria is None:
        return "no hay dato de industria"
    return "es tabaquera, y dejaste fuera el tabaco" if industria == "Tobacco" else None


def _solo_chips(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    industria = _texto(e.industria)
    if industria is None:
        return "no hay dato de industria"
    return None if industria in _CHIPS else "no es de chips"


def _solo_sectores(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    sector = _texto(e.sector)
    if sector is None:
        return "no hay dato de sector"
    if sector in p["sectores"]:
        return None
    return f"es de {sector_es(sector).lower()}, que no está entre tus sectores"


def _sin_sectores(e: EmpresaFoto, p: Mapping[str, Any]) -> str | None:
    sector = _texto(e.sector)
    if sector is None:
        return "no hay dato de sector"
    if sector in p["sectores"]:
        return f"es de {sector_es(sector).lower()}, que dejaste fuera"
    return None


def _lista_sectores(sectores: Any) -> str:
    nombres = [SECTORES_ES[s].lower() for s in SECTORES_ES if s in sectores]
    if len(nombres) == 1:
        return nombres[0]
    # «tecnología e industria»: la «y» pasa a «e» ante el sonido «i».
    y = "e" if nombres[-1].startswith("i") else "y"
    return f"{', '.join(nombres[:-1])} {y} {nombres[-1]}"


_ANIOS = Parametro("anios", "la deuda máxima", Decimal("0.5"), Decimal(5), Decimal("0.5"), 2)
_PER = Parametro("per", "el PER máximo", Decimal(8), Decimal(40), Decimal(1), 18)
_SECTORES = Parametro("sectores", "los sectores", tipo="sectores")

CATALOGO: dict[str, ReglaCatalogo] = {r.clave: r for r in (
    ReglaCatalogo("grandes", "Empresas grandes",
                  lambda p: f"capitalización de más de {millones_usd(_GRANDE)}", _grandes),
    ReglaCatalogo("medianas", "Medianas o grandes",
                  lambda p: f"capitalización de más de {millones_usd(_MEDIANA)}", _medianas),
    ReglaCatalogo("pequenas", "Pequeñas",
                  lambda p: f"capitalización entre {cifra(_PEQUENA)} y {millones_usd(_MEDIANA)}",
                  _pequenas),
    ReglaCatalogo("deuda", "Poca deuda",
                  lambda p: (f"deuda neta de menos de {_anios(a_decimal(p['anios']))} "
                             "de beneficio operativo"),
                  _deuda, (_ANIOS,)),
    ReglaCatalogo("caja_neta", "Más caja que deuda", lambda p: "caja neta positiva", _caja_neta),
    ReglaCatalogo("barata", "Que no esté cara",
                  lambda p: f"PER por debajo de {cifra(a_decimal(p['per']))}", _barata, (_PER,)),
    ReglaCatalogo("dividendo", "Reparte dividendo",
                  lambda p: f"rentabilidad por dividendo de más del {porcentaje(_DIVIDENDO)}",
                  _dividendo),
    ReglaCatalogo("crecen", "Venden cada año más",
                  lambda p: f"ventas creciendo más de un {porcentaje(_CRECIMIENTO)} al año",
                  _crecen),
    ReglaCatalogo("margen", "Buen margen",
                  lambda p: f"margen operativo por encima del {porcentaje(_MARGEN)}", _margen),
    ReglaCatalogo("rentables", "Muy rentables",
                  lambda p: f"ganan más de un {porcentaje(_ROE)} sobre su capital (ROE)",
                  _rentables),
    ReglaCatalogo("castigadas", "Castigadas",
                  lambda p: f"a un {porcentaje(_CAIDA)} o más de su máximo del último año",
                  _castigadas),
    ReglaCatalogo("sin_energia", "Sin energía", lambda p: "fuera el petróleo y el gas",
                  _sin_energia),
    ReglaCatalogo("sin_bancos", "Sin bancos", lambda p: "fuera la banca", _sin_bancos),
    ReglaCatalogo("sin_tabaco", "Sin tabaco", lambda p: "fuera las tabaqueras", _sin_tabaco),
    ReglaCatalogo("solo_chips", "Solo chips", lambda p: "empresas de semiconductores",
                  _solo_chips),
    ReglaCatalogo("solo_sectores", "Solo estos sectores",
                  lambda p: _lista_sectores(p["sectores"]), _solo_sectores, (_SECTORES,)),
    ReglaCatalogo("sin_sectores", "Sin estos sectores",
                  lambda p: _lista_sectores(p["sectores"]), _sin_sectores, (_SECTORES,)),
)}

# Rangos de tamaño que no se solapan: juntas no dejan pasar a nadie.
_INCOMPATIBLES = (("grandes", "pequenas"), ("medianas", "pequenas"))


# --- Validación ----------------------------------------------------------------------------------


def validar_reglas(reglas: object) -> list[str]:
    """Errores en castellano de una lista de reglas; vacía si se puede aplicar tal cual."""
    if not isinstance(reglas, list):
        return ["Las reglas tienen que ir en una lista."]
    errores: list[str] = []
    validas: dict[str, Mapping[str, Any]] = {}
    vistas: set[str] = set()
    for i, regla in enumerate(reglas, 1):
        if not isinstance(regla, Mapping) or not isinstance(regla.get("clave"), str):
            errores.append(f"La regla {i} tiene que llevar «clave» y, si hace falta, «params».")
            continue
        sobran = sorted(str(k) for k in set(regla) - {"clave", "params"})
        if sobran:
            errores.append(f"La regla {i} lleva campos que no existen: {', '.join(sobran)}.")
        clave = regla["clave"]
        entrada = CATALOGO.get(clave)
        if entrada is None:
            errores.append(f"La regla «{clave}» no está en el catálogo.")
            continue
        if clave in vistas:
            errores.append(f"«{entrada.titulo}» está repetida.")
            continue
        vistas.add(clave)
        params = regla.get("params", {})
        if not isinstance(params, Mapping):
            errores.append(f"Los ajustes de «{entrada.titulo}» tienen que ser un objeto.")
            continue
        propios = _validar_params(entrada, params)
        errores += propios
        if not propios:
            validas[clave] = params
    return errores + _contradicciones(validas)


def _validar_params(entrada: ReglaCatalogo, params: Mapping[str, Any]) -> list[str]:
    sobran = sorted(str(k) for k in set(params) - {p.nombre for p in entrada.parametros})
    errores = [f"«{entrada.titulo}» no lleva el ajuste «{extra}»." for extra in sobran]
    for p in entrada.parametros:
        if p.nombre not in params:
            errores.append(f"A «{entrada.titulo}» le falta el ajuste «{p.nombre}».")
        elif p.tipo == "sectores":
            errores += _validar_sectores(entrada, params[p.nombre])
        else:
            errores += _validar_numero(entrada, p, params[p.nombre])
    return errores


def _validar_numero(entrada: ReglaCatalogo, p: Parametro, valor: Any) -> list[str]:
    donde = f"En «{entrada.titulo}», {p.etiqueta}"
    if isinstance(valor, bool) or not isinstance(valor, int | float | Decimal):
        return [f"{donde} tiene que ser un número."]
    d = a_decimal(valor)
    if d is None:
        return [f"{donde} tiene que ser un número."]
    if p.minimo is None or p.maximo is None or p.paso is None:
        raise TypeError(f"el ajuste numérico «{p.nombre}» no tiene rango")
    if not p.minimo <= d <= p.maximo:
        return [f"{donde} va de {cifra(p.minimo)} a {cifra(p.maximo)}."]
    if (d - p.minimo) % p.paso != 0:
        return [f"{donde} va de {cifra(p.paso)} en {cifra(p.paso)}."]
    return []


def _validar_sectores(entrada: ReglaCatalogo, valor: Any) -> list[str]:
    if not isinstance(valor, list | tuple) or not valor:
        return [f"En «{entrada.titulo}», elige al menos un sector."]
    errores: list[str] = []
    vistos: set[str] = set()
    for s in valor:
        if not isinstance(s, str) or s not in SECTORES_ES:
            errores.append(f"En «{entrada.titulo}», «{s}» no es uno de los 11 sectores.")
        elif s in vistos:
            errores.append(f"En «{entrada.titulo}», {sector_es(s).lower()} está repetido.")
        else:
            vistos.add(s)
    return errores


def _contradicciones(validas: Mapping[str, Mapping[str, Any]]) -> list[str]:
    errores = [f"«{CATALOGO[a].titulo}» y «{CATALOGO[b].titulo}» no pueden ir juntas: ninguna "
               "empresa cumple las dos."
               for a, b in _INCOMPATIBLES if a in validas and b in validas]
    permitidos = set(SECTORES_ES)
    if "solo_sectores" in validas:
        permitidos &= set(validas["solo_sectores"]["sectores"])
    if "sin_sectores" in validas:
        permitidos -= set(validas["sin_sectores"]["sectores"])
    if "sin_energia" in validas:
        permitidos.discard("Energy")
    if not permitidos:
        errores.append("Con estas reglas no queda ningún sector: no pasaría ninguna empresa.")
    elif "solo_chips" in validas and "Technology" not in permitidos:
        errores.append("«Solo chips» necesita el sector tecnología, y tus reglas lo dejan fuera.")
    return errores


# --- Aplicación ----------------------------------------------------------------------------------


def preparar(reglas: list[dict[str, Any]]) -> tuple[ReglaPreparada, ...]:
    """Valida las reglas y las deja listas para evaluar; `RecetaNoValida` si alguna no vale."""
    errores = validar_reglas(reglas)
    if errores:
        raise RecetaNoValida(errores)
    preparadas = []
    for regla in reglas:
        params = {k: tuple(v) if isinstance(v, list) else v
                  for k, v in (regla.get("params") or {}).items()}
        preparadas.append(ReglaPreparada(CATALOGO[regla["clave"]], params))
    return tuple(preparadas)


def primer_fallo(empresa: EmpresaFoto, preparadas: tuple[ReglaPreparada, ...]) -> str | None:
    for regla in preparadas:
        motivo = regla.evaluar(empresa)
        if motivo is not None:
            return motivo
    return None


def fallo(empresa: EmpresaFoto, reglas: list[dict[str, Any]]) -> str | None:
    """El motivo de la primera regla que no cumple, en el orden de la receta; `None` si pasa."""
    return primer_fallo(empresa, preparar(reglas))


def regla_por_defecto(clave: str) -> dict[str, Any]:
    """La regla con sus ajustes por defecto, lista para guardar. Las de sectores no tienen
    defecto: hay que elegirlos."""
    return {"clave": clave, "params": CATALOGO[clave].params_por_defecto()}
