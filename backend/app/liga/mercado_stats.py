"""Estadísticas de la foto compartidas por mercado y vista previa."""

import math
import threading
import time
from collections import Counter
from copy import deepcopy
from statistics import median

from sqlalchemy import text

from app.liga import estrategias
from app.liga.motor.catalogo import CATALOGO, preparar
from app.liga.motor.estilos import ESTILOS
from app.liga.motor.formato import a_decimal
from app.liga.motor.mensajes import presentar
from app.liga.motor.seleccion import seleccionar
from app.liga.procesos.comun import fabrica_sistema

BANDAS = ("micro", "pequenas", "medianas", "grandes", "gigantes")
_CAMPOS = {
    "barata": ("per", 1), "dividendo": ("dividend_yield_pct", 1),
    "crecen": ("crecimiento_ventas", 100), "margen": ("margen_operativo", 100),
    "rentables": ("roe", 100), "fcf": ("fcf_pct", 1), "roa": ("roa", 100),
    "margen_neto": ("margen_neto", 100), "deuda_pn": ("deuda_pn_pct", 1),
    "payout": ("payout_pct", 1), "fuerza_sp": ("vs_sp_52s", 1),
    "liquidez": ("volumen_usd_dia", 1), "directivos": ("directivos_pct", 1),
    "cortos": ("cortos_pct", 1), "tamano": ("market_cap_usd", 0.000001),
    "grandes": ("market_cap_usd", 0.000001), "medianas": ("market_cap_usd", 0.000001),
    "pequenas": ("market_cap_usd", 0.000001),
    "pb": ("pb", 1), "ev_ebitda": ("ev_ebitda", 1),
    "beta": ("beta", 1), "liquidez_corriente": ("liquidez_corriente", 1),
}
_cache = {}
_candado = threading.Lock()


def numero(valor):
    dato = a_decimal(valor)
    return float(dato) if dato is not None else None


def valor_regla(empresa, clave):
    if clave in _CAMPOS:
        campo, escala = _CAMPOS[clave]
        valor = numero(getattr(empresa, campo))
        return valor * escala if valor is not None else None
    if clave in ("deuda", "caja_neta"):
        deuda, caja = numero(empresa.deuda_total), numero(empresa.caja_total)
        if deuda is None or caja is None:
            return None
        if clave == "caja_neta":
            return caja - deuda
        if deuda <= caja:
            return 0.0
        ebitda = numero(empresa.ebitda)
        return (deuda - caja) / ebitda if ebitda and ebitda > 0 else None
    if clave in ("castigadas", "castigadas_pct"):
        precio, maximo = numero(empresa.precio), numero(empresa.max_52s)
        if precio is None or precio <= 0 or maximo is None or maximo <= 0:
            return None
        return 100 * (1 - precio / maximo)
    campo = "industria" if clave in ("sin_bancos", "sin_tabaco", "solo_chips") else "sector"
    return 1.0 if getattr(empresa, campo) else None


def histograma(valores, minimo, maximo, logaritmico=False):
    tramos = [0] * 36
    transformar = math.log if logaritmico else float
    inferior, superior = transformar(minimo), transformar(maximo)
    for valor in valores:
        if valor <= minimo or superior == inferior:
            indice = 0
        elif valor >= maximo:
            indice = 35
        else:
            indice = min(35, int(36 * (transformar(valor) - inferior) / (superior - inferior)))
        tramos[indice] += 1
    return tramos


def banda(empresa):
    cap = numero(empresa.market_cap_usd)
    if cap is None or cap <= 0:
        return None
    return BANDAS[sum(cap >= limite * 1_000_000 for limite in (300, 2000, 10000, 200000))]


def tamanos(empresas):
    cuentas = Counter(banda(e) for e in empresas)
    return {clave: cuentas[clave] for clave in BANDAS}


def metricas(empresas):
    """Medianas del perfil: margen y crecimiento en %, PER y beta tal cual, dividendo medio en %."""
    salida = {}
    for clave, campo in (("per", "per"), ("margen_operativo", "margen_operativo"),
                         ("crecimiento", "crecimiento_ventas"), ("beta", "beta")):
        escala = 100 if campo in ("margen_operativo", "crecimiento_ventas") else 1
        valores = [v * escala for e in empresas if (v := numero(getattr(e, campo))) is not None]
        salida[clave] = median(valores) if valores else None
    salida["dividendo_medio"] = (sum(max(0, numero(e.dividend_yield_pct) or 0)
                                      for e in empresas) / len(empresas) if empresas else None)
    return salida


def perfil_y_avisos(empresas, resultado, receta, pasan):
    elegidas = [e.fila.empresa for e in resultado.elegidas]
    mercado = Counter(e.sector for e in empresas if e.sector)
    pesos = Counter()
    for e in resultado.elegidas:
        pesos[e.fila.empresa.sector] += float(e.peso)
    sectores = [{"sector": s, "peso": pesos[s],
                 "cuota_mercado": 100 * mercado[s] / len(empresas) if empresas else 0}
                for s in sorted(set(mercado) | {s for s in pesos if s})]
    avisos = []
    if len(elegidas) < receta.n_empresas:
        avisos.append({"codigo": "caja", "huecos": receta.n_empresas - len(elegidas),
                       "pct": float(resultado.caja_pct)})
    concentradas = [(s, p) for s, p in pesos.items() if p >= 60]
    for sector, pct in concentradas:
        avisos.append({"codigo": "concentracion", "sector": sector, "pct": pct})
    if not concentradas:
        for sector in ("Financial Services", "Healthcare", "Technology"):
            if not pesos[sector]:
                avisos.append({"codigo": "sin_sector", "sector": sector,
                               "cuota": 100 * mercado[sector] / len(empresas) if empresas else 0})
                break
    if pasan < 15:
        avisos.append({"codigo": "pocas", "n": pasan})
    return {"cartera": metricas(elegidas), "mercado": metricas(empresas),
            "tamanos": tamanos(elegidas), "sectores": sectores}, avisos


def por_regla(empresas, receta, locale):
    reglas = preparar(receta.reglas)
    vectores = [[r.evaluar(e) is None for e in empresas] for r in reglas]
    fallos = [sum(not v[i] for v in vectores) for i in range(len(empresas))]
    return [{"clave": r.regla.clave, "sola": sum(vector),
             "sin_ella": sum(fallos[i] - (not vector[i]) == 0 for i in range(len(empresas))),
             "detalle": presentar(r.regla.detalle(r.params), locale)}
            for r, vector in zip(reglas, vectores, strict=True)]


def calcular_mercado(contexto, notas_del):
    empresas = [e for e in contexto.empresas if numero(e.precio) is not None]
    n = len(empresas)
    reglas = {}
    for clave, regla in CATALOGO.items():
        valores = [v for e in empresas if (v := valor_regla(e, clave)) is not None]
        parametros = [p for p in regla.parametros if p.tipo in ("numero", "lista")]
        if parametros:
            p = parametros[0]
            minimo = float(min(p.valores) if p.valores else p.minimo)
            maximo = float(max(p.valores) if p.valores else p.maximo)
        else:
            minimo, maximo = min(valores, default=0), max(valores, default=1)
        params = regla.params_por_defecto()
        tiene_defecto = all(p.nombre in params for p in regla.parametros)
        reglas[clave] = {
            "cobertura": round(100 * len(valores) / n) if n else 0,
            "mediana": median(valores) if valores else None,
            "histograma": histograma(valores, minimo, maximo,
                                      any(p.tipo == "lista" for p in parametros)),
            "sola": sum(regla.evaluar(e, params) is None for e in empresas)
                    if tiene_defecto else 0,
        }
    estilos = {}
    for clave, estilo in ESTILOS.items():
        resultado = seleccionar(empresas, estilo.receta(), contexto.notas)
        estilos[clave] = {"pasan": len(resultado.pasan), "entran": len(resultado.elegidas)}
    return {"foto_id": contexto.foto_id, "notas_del": notas_del, "n": n,
            "reglas": reglas, "bandas": tamanos(empresas), "estilos": estilos,
            "sectores": dict(Counter(e.sector for e in empresas if e.sector))}


def mercado():
    contexto = estrategias.contexto_de_referencia()
    clave = (contexto.foto_id, contexto.scan_run_id)
    with _candado:
        ahora = time.monotonic()
        if clave in _cache and ahora - _cache[clave][0] < 600:
            return deepcopy(_cache[clave][1])
        db = fabrica_sistema()
        try:
            fecha = db.execute(text("select scan_at from scan_runs where id = :id"),
                               {"id": contexto.scan_run_id}).scalar()
            notas_del = fecha.isoformat() if fecha else None
        finally:
            db.close()
        salida = calcular_mercado(contexto, notas_del)
        caducadas = [k for k, (inicio, _) in _cache.items() if ahora - inicio >= 600]
        for k in caducadas:
            del _cache[k]
        _cache[clave] = (time.monotonic(), salida)
        return deepcopy(salida)
