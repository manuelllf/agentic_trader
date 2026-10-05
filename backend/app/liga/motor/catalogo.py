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

from app.liga.motor.formato import a_decimal, cifra
from app.liga.motor.mensajes import (
    Ajuste,
    Cifra,
    Lista,
    ListaSectores,
    Pct,
    Regla,
    Sector,
    Texto,
    Usd,
    UsdAbierto,
    Veces,
)

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
    opcional: bool = False


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


def _mas_de(e: EmpresaFoto, umbral: Decimal) -> Texto | None:
    cap = _capitalizacion(e)
    if cap is None:
        return Texto("motor_sin_dato_capitalizacion")
    if cap > umbral:
        return None
    return Texto("motor_cap_mayor", cap=Usd(cap, (umbral,)), umbral=Usd(umbral))


def _grandes(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    return _mas_de(e, _GRANDE)


def _medianas(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    return _mas_de(e, _MEDIANA)


def _pequenas(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    cap = _capitalizacion(e)
    if cap is None:
        return Texto("motor_sin_dato_capitalizacion")
    if _PEQUENA <= cap <= _MEDIANA:
        return None
    return Texto("motor_cap_entre", cap=Usd(cap, (_PEQUENA, _MEDIANA)), desde=UsdAbierto(_PEQUENA),
                 hasta=Usd(_MEDIANA))


def _deuda_y_caja(e: EmpresaFoto) -> tuple[Decimal, Decimal] | Texto:
    deuda, caja = a_decimal(e.deuda_total), a_decimal(e.caja_total)
    if deuda is None:
        return Texto("motor_sin_dato_deuda")
    if caja is None:
        return Texto("motor_sin_dato_caja")
    return deuda, caja


def _deuda(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    datos = _deuda_y_caja(e)
    if isinstance(datos, Texto):
        return datos
    deuda, caja = datos
    neta = deuda - caja
    if neta <= 0:
        return None
    ebitda = a_decimal(e.ebitda)
    if ebitda is None:
        return Texto("motor_sin_dato_ebitda")
    if ebitda <= 0:
        return Texto("motor_ebitda_no_positivo")
    maximo = a_decimal(p["anios"])
    ratio = neta / ebitda
    if ratio < maximo:
        return None
    return Texto("motor_deuda_ratio", ratio=Veces(ratio, (maximo,)), maximo=Veces(maximo))


def _caja_neta(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    datos = _deuda_y_caja(e)
    if isinstance(datos, Texto):
        return datos
    deuda, caja = datos
    if caja > deuda:
        return None
    return Texto("motor_caja_igual" if caja == deuda else "motor_caja_menor")


def _barata(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    per = a_decimal(e.per)
    maximo = a_decimal(p["per"])
    if per is None or per == 0:
        return Texto("motor_sin_dato_per")
    if per < 0:
        return Texto("motor_per_negativo")
    if per < maximo:
        return None
    return Texto("motor_per_alto", per=Cifra(per, 1, (maximo,)), maximo=Cifra(maximo))


def _dividendo(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    rentabilidad = a_decimal(e.dividend_yield_pct)
    if rentabilidad is None:
        return Texto("motor_sin_dato_dividendo")
    minimo = a_decimal(p["dividendo_pct"])
    if rentabilidad > minimo:
        return None
    return Texto("motor_dividendo_bajo", dividendo=Pct(rentabilidad, 1, (minimo,)),
                 minimo=Pct(minimo))


def _crecen(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    ratio = a_decimal(e.crecimiento_ventas)
    if ratio is None:
        return Texto("motor_sin_dato_crecimiento")
    minimo = a_decimal(p["crecimiento_pct"])
    pct = ratio * 100
    if pct > minimo:
        return None
    if pct < 0 and cifra(-pct) != "0":
        return Texto("motor_crecimiento_caida", caida=Pct(-pct), minimo=Pct(minimo))
    return Texto("motor_crecimiento_bajo", pct=Pct(pct, 1, (minimo,)), minimo=Pct(minimo))


def _margen(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    ratio = a_decimal(e.margen_operativo)
    if ratio is None:
        return Texto("motor_sin_dato_margen")
    minimo = a_decimal(p["margen_pct"])
    pct = ratio * 100
    if pct > minimo:
        return None
    return Texto("motor_margen_bajo", pct=Pct(pct, 1, (minimo,)), minimo=Pct(minimo))


def _rentables(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    ratio = a_decimal(e.roe)
    if ratio is None:
        return Texto("motor_sin_dato_roe")
    minimo = a_decimal(p["roe_pct"])
    pct = ratio * 100
    if pct > minimo:
        return None
    if pct < 0 and cifra(-pct) != "0":
        return Texto("motor_roe_perdida", pct=Pct(-pct), minimo=Pct(minimo))
    return Texto("motor_roe_bajo", pct=Pct(pct, 1, (minimo,)), minimo=Pct(minimo))


def _castigadas(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    precio, maximo = a_decimal(e.precio), a_decimal(e.max_52s)
    if precio is None or precio <= 0:
        return Texto("motor_sin_dato_precio")
    if maximo is None or maximo <= 0:
        return Texto("motor_sin_dato_maximo")
    caida = (1 - precio / maximo) * 100
    if caida >= _CAIDA:
        return None
    if caida <= 0 or cifra(caida) == "0":
        return Texto("motor_castigada_en_maximo", umbral=Pct(_CAIDA))
    return Texto("motor_castigada_distancia", caida=Pct(caida, 1, (_CAIDA,)), umbral=Pct(_CAIDA))


def _sin_energia(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    sector = _texto(e.sector)
    if sector is None:
        return Texto("motor_sin_dato_sector")
    return Texto("motor_energia") if sector == "Energy" else None


def _sin_bancos(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    industria = _texto(e.industria)
    if industria is None:
        return Texto("motor_sin_dato_industria")
    return Texto("motor_banco") if industria.startswith("Banks") else None


def _sin_tabaco(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    industria = _texto(e.industria)
    if industria is None:
        return Texto("motor_sin_dato_industria")
    return Texto("motor_tabaco") if industria == "Tobacco" else None


def _solo_chips(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    industria = _texto(e.industria)
    if industria is None:
        return Texto("motor_sin_dato_industria")
    return None if industria in _CHIPS else Texto("motor_no_chips")


def _solo_sectores(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    sector = _texto(e.sector)
    if sector is None:
        return Texto("motor_sin_dato_sector")
    if sector in p["sectores"]:
        return None
    return Texto("motor_sector_fuera", sector=Sector(sector))


def _sin_sectores(e: EmpresaFoto, p: Mapping[str, Any]) -> Texto | None:
    sector = _texto(e.sector)
    if sector is None:
        return Texto("motor_sin_dato_sector")
    if sector in p["sectores"]:
        return Texto("motor_sector_dejado", sector=Sector(sector))
    return None


_ANIOS = Parametro("anios", "el ratio deuda neta/EBITDA máximo (veces)",
                   Decimal("0.5"), Decimal(5), Decimal("0.5"), 2)
_PER = Parametro("per", "el PER máximo", Decimal(8), Decimal(40), Decimal(1), 18)
_CRECIMIENTO_PCT = Parametro("crecimiento_pct", "el crecimiento interanual mínimo (%)",
                             Decimal(0), Decimal(100), Decimal(1), 5, opcional=True)
_MARGEN_PCT = Parametro("margen_pct", "el margen operativo mínimo (%)",
                        Decimal(0), Decimal(100), Decimal(1), 15, opcional=True)
_ROE_PCT = Parametro("roe_pct", "el ROE mínimo (%)", Decimal(0), Decimal(100), Decimal(1), 15,
                     opcional=True)
_DIVIDENDO_PCT = Parametro("dividendo_pct", "la rentabilidad por dividendo mínima (%)",
                           Decimal(0), Decimal(30), Decimal("0.5"), Decimal("2.5"),
                           opcional=True)
_SECTORES = Parametro("sectores", "los sectores", tipo="sectores")

CATALOGO: dict[str, ReglaCatalogo] = {r.clave: r for r in (
    ReglaCatalogo("grandes", "Empresas grandes",
                  lambda p: Texto("motor_det_cap_mayor", umbral=Usd(_GRANDE)), _grandes),
    ReglaCatalogo("medianas", "Medianas o grandes",
                  lambda p: Texto("motor_det_cap_mayor", umbral=Usd(_MEDIANA)), _medianas),
    ReglaCatalogo("pequenas", "Pequeñas",
                  lambda p: Texto("motor_det_cap_entre", desde=UsdAbierto(_PEQUENA),
                                  hasta=Usd(_MEDIANA)),
                  _pequenas),
    ReglaCatalogo("deuda", "Poca deuda",
                  lambda p: Texto("motor_det_deuda", veces=Veces(a_decimal(p["anios"]))),
                  _deuda, (_ANIOS,)),
    ReglaCatalogo("caja_neta", "Más caja que deuda", lambda p: Texto("motor_det_caja_neta"),
                  _caja_neta),
    ReglaCatalogo("barata", "Que no esté cara",
                  lambda p: Texto("motor_det_per", per=Cifra(a_decimal(p["per"]))), _barata,
                  (_PER,)),
    ReglaCatalogo("dividendo", "Reparte dividendo",
                  lambda p: Texto("motor_det_dividendo",
                                  pct=Pct(a_decimal(p["dividendo_pct"]))),
                  _dividendo, (_DIVIDENDO_PCT,)),
    ReglaCatalogo("crecen", "Crecimiento interanual de ventas",
                  lambda p: Texto("motor_det_crecimiento",
                                  pct=Pct(a_decimal(p["crecimiento_pct"]))),
                  _crecen, (_CRECIMIENTO_PCT,)),
    ReglaCatalogo("margen", "Buen margen",
                  lambda p: Texto("motor_det_margen", pct=Pct(a_decimal(p["margen_pct"]))),
                  _margen, (_MARGEN_PCT,)),
    ReglaCatalogo("rentables", "Muy rentables",
                  lambda p: Texto("motor_det_roe", pct=Pct(a_decimal(p["roe_pct"]))),
                  _rentables, (_ROE_PCT,)),
    ReglaCatalogo("castigadas", "Castigadas",
                  lambda p: Texto("motor_det_castigadas", pct=Pct(_CAIDA)), _castigadas),
    ReglaCatalogo("sin_energia", "Sin energía", lambda p: Texto("motor_det_sin_energia"),
                  _sin_energia),
    ReglaCatalogo("sin_bancos", "Sin bancos", lambda p: Texto("motor_det_sin_bancos"),
                  _sin_bancos),
    ReglaCatalogo("sin_tabaco", "Sin tabaco", lambda p: Texto("motor_det_sin_tabaco"),
                  _sin_tabaco),
    ReglaCatalogo("solo_chips", "Solo chips", lambda p: Texto("motor_det_chips"), _solo_chips),
    ReglaCatalogo("solo_sectores", "Solo estos sectores",
                  lambda p: Texto("motor_det_sectores", lista=ListaSectores(tuple(p["sectores"]))),
                  _solo_sectores, (_SECTORES,)),
    ReglaCatalogo("sin_sectores", "Sin estos sectores",
                  lambda p: Texto("motor_det_sectores", lista=ListaSectores(tuple(p["sectores"]))),
                  _sin_sectores, (_SECTORES,)),
)}

# Rangos de tamaño que no se solapan: juntas no dejan pasar a nadie.
_INCOMPATIBLES = (("grandes", "pequenas"), ("medianas", "pequenas"))


# --- Validación ----------------------------------------------------------------------------------


def validar_reglas(reglas: object) -> list[Texto]:
    """Errores de una lista de reglas, redactados en castellano; vacía si se puede aplicar."""
    if not isinstance(reglas, list):
        return [Texto("motor_val_lista")]
    errores: list[Texto] = []
    validas: dict[str, Mapping[str, Any]] = {}
    vistas: set[str] = set()
    for i, regla in enumerate(reglas, 1):
        if not isinstance(regla, Mapping) or not isinstance(regla.get("clave"), str):
            errores.append(Texto("motor_val_regla_forma", i=i))
            continue
        sobran = sorted(str(k) for k in set(regla) - {"clave", "params"})
        if sobran:
            errores.append(Texto("motor_val_campos_sobran", i=i, campos=Lista(tuple(sobran))))
        clave = regla["clave"]
        entrada = CATALOGO.get(clave)
        if entrada is None:
            errores.append(Texto("motor_val_regla_desconocida", clave=clave))
            continue
        if clave in vistas:
            errores.append(Texto("motor_val_repetida", regla=Regla(clave)))
            continue
        vistas.add(clave)
        params = regla.get("params", {})
        if not isinstance(params, Mapping):
            errores.append(Texto("motor_val_ajustes_objeto", regla=Regla(clave)))
            continue
        propios = _validar_params(entrada, params)
        errores += propios
        if not propios:
            validas[clave] = params
    return errores + _contradicciones(validas)


def _validar_params(entrada: ReglaCatalogo, params: Mapping[str, Any]) -> list[Texto]:
    sobran = sorted(str(k) for k in set(params) - {p.nombre for p in entrada.parametros})
    errores = [Texto("motor_val_ajuste_sobra", regla=Regla(entrada.clave), extra=extra)
               for extra in sobran]
    for p in entrada.parametros:
        if p.nombre not in params:
            if not p.opcional:
                errores.append(Texto("motor_val_ajuste_falta", regla=Regla(entrada.clave),
                                     ajuste=p.nombre))
        elif p.tipo == "sectores":
            errores += _validar_sectores(entrada, params[p.nombre])
        else:
            errores += _validar_numero(entrada, p, params[p.nombre])
    return errores


def _validar_numero(entrada: ReglaCatalogo, p: Parametro, valor: Any) -> list[Texto]:
    donde = {"regla": Regla(entrada.clave), "etiqueta": Ajuste(p.nombre)}
    if isinstance(valor, bool) or not isinstance(valor, int | float | Decimal):
        return [Texto("motor_val_numero", **donde)]
    d = a_decimal(valor)
    if d is None:
        return [Texto("motor_val_numero", **donde)]
    if p.minimo is None or p.maximo is None or p.paso is None:
        raise TypeError(f"el ajuste numérico «{p.nombre}» no tiene rango")
    if not p.minimo <= d <= p.maximo:
        return [Texto("motor_val_rango", **donde, desde=Cifra(p.minimo), hasta=Cifra(p.maximo))]
    if (d - p.minimo) % p.paso != 0:
        return [Texto("motor_val_paso", **donde, paso=Cifra(p.paso))]
    return []


def _validar_sectores(entrada: ReglaCatalogo, valor: Any) -> list[Texto]:
    regla = Regla(entrada.clave)
    if not isinstance(valor, list | tuple) or not valor:
        return [Texto("motor_val_sector_minimo", regla=regla)]
    errores: list[Texto] = []
    vistos: set[str] = set()
    for s in valor:
        if not isinstance(s, str) or s not in SECTORES_ES:
            errores.append(Texto("motor_val_sector_invalido", regla=regla, sector=s))
        elif s in vistos:
            errores.append(Texto("motor_val_sector_repetido", regla=regla, sector=Sector(s)))
        else:
            vistos.add(s)
    return errores


def _contradicciones(validas: Mapping[str, Mapping[str, Any]]) -> list[Texto]:
    errores = [Texto("motor_val_incompatibles", a=Regla(a), b=Regla(b))
               for a, b in _INCOMPATIBLES if a in validas and b in validas]
    permitidos = set(SECTORES_ES)
    if "solo_sectores" in validas:
        permitidos &= set(validas["solo_sectores"]["sectores"])
    if "sin_sectores" in validas:
        permitidos -= set(validas["sin_sectores"]["sectores"])
    if "sin_energia" in validas:
        permitidos.discard("Energy")
    if not permitidos:
        errores.append(Texto("motor_val_sin_sectores"))
    elif "solo_chips" in validas and "Technology" not in permitidos:
        errores.append(Texto("motor_val_chips", regla=Regla("solo_chips"),
                             sector=Sector("Technology")))
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
                  for k, v in CATALOGO[regla["clave"]]._con_defectos(
                      regla.get("params") or {}).items()}
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
