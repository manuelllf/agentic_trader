"""Datos públicos de la demo de la portada: la foto ordenada por tamaño, el mapa de cada estilo
y la última semana cerrada de las casas. No enseña datos de nadie."""

from __future__ import annotations

import threading
import time
from datetime import date
from decimal import Decimal

from pydantic import BaseModel
from sqlalchemy import text

from app.liga import estrategias
from app.liga.mercado_stats import numero
from app.liga.motor.catalogo import preparar
from app.liga.motor.estilos import ESTILOS
from app.liga.motor.mensajes import presentar
from app.liga.motor.seleccion import seleccionar
from app.liga.procesos.comun import fabrica_sistema

ANILLOS_MUSD = (100000, 10000, 1000)
CASAS = ("alpha", "lambda", "omega")
_VIDA = 600


class Anillo(BaseModel):
    rango: int
    musd: int


class Cinco(BaseModel):
    ticker: str
    nombre: str
    rango: int
    nota: float


class ReglaDemo(BaseModel):
    clave: str
    params: dict
    detalle: str


class EstiloDemo(BaseModel):
    pasan: int
    mapa: str
    cinco: list[Cinco]
    reglas: list[ReglaDemo]


class CasaSemana(BaseModel):
    casa: str
    rentabilidad: Decimal | None
    dif_sp: Decimal | None
    puntos: int | None


class SemanaDemo(BaseModel):
    dia_inicio: date
    dia_fin: date
    sp: Decimal | None
    casa: list[CasaSemana]


class PortadaOut(BaseModel):
    foto_id: int
    notas_del: str | None
    total: int
    anillos: list[Anillo]
    estilos: dict[str, EstiloDemo]
    semana: SemanaDemo | None


class EmpresaRango(BaseModel):
    rango: int
    ticker: str
    nombre: str | None
    musd: float | None
    sector: str | None


_cache: dict[tuple, tuple[float, object]] = {}
_candado = threading.Lock()


def _capitalizacion(empresa) -> float | None:
    cap = numero(empresa.market_cap_usd)
    return cap if cap is not None and cap > 0 else None


def ordenar(empresas) -> list:
    """Con precio, de mayor a menor capitalización (sin dato al final) y por ticker al empatar."""
    con_precio = [e for e in empresas if numero(e.precio) is not None]
    return sorted(con_precio, key=lambda e: (_capitalizacion(e) is None,
                                              -(_capitalizacion(e) or 0), e.ticker))


def codificar_mapa(ordenadas, pasan: set[str]) -> str:
    """Un bit por empresa, 4 por carácter hexadecimal y el más alto primero."""
    digitos = []
    for inicio in range(0, len(ordenadas), 4):
        grupo = [e.ticker in pasan for e in ordenadas[inicio:inicio + 4]]
        grupo += [False] * (4 - len(grupo))
        digitos.append(f"{sum(b << (3 - i) for i, b in enumerate(grupo)):x}")
    return "".join(digitos)


def _anillos(ordenadas) -> list[Anillo]:
    salida = []
    for musd in ANILLOS_MUSD:
        limite = musd * 1_000_000
        salida.append(Anillo(rango=sum((_capitalizacion(e) or 0) >= limite for e in ordenadas),
                             musd=musd))
    return salida


def _estilos(ordenadas, contexto, idioma: str) -> dict[str, EstiloDemo]:
    rango = {e.ticker: i for i, e in enumerate(ordenadas)}
    salida = {}
    for clave, estilo in ESTILOS.items():
        receta = estilo.receta()
        resultado = seleccionar(ordenadas, receta, contexto.notas)
        pasan = {f.ticker for f in resultado.pasan}
        cinco = [Cinco(ticker=e.ticker, nombre=e.fila.empresa.nombre or e.ticker,
                       rango=rango[e.ticker],
                       nota=round(float((e.fila.nota or 0) * 10), 1))
                 for e in resultado.elegidas]
        reglas = [ReglaDemo(clave=r.regla.clave, params=dict(r.params),
                            detalle=presentar(r.regla.detalle(r.params), idioma))
                  for r in preparar(receta.reglas)]
        salida[clave] = EstiloDemo(pasan=len(resultado.pasan),
                                   mapa=codificar_mapa(ordenadas, pasan),
                                   cinco=cinco, reglas=reglas)
    return salida


def _semana(db) -> SemanaDemo | None:
    """Solo cifras oficiales de la última jornada cerrada, sin provisionales."""
    j = db.execute(text("""
        select id, dia_inicio, dia_fin, sp_rentabilidad from liga.jornadas
        where estado = 'cerrada' order by dia_fin desc limit 1""")).one_or_none()
    if j is None:
        return None
    filas = db.execute(text("""
        select e.casa_clave, r.rentabilidad, r.puntos
        from liga.inscripciones i
        join liga.estrategias e on e.id = i.estrategia_id
        left join liga.resultados r on r.inscripcion_id = i.id
        where i.jornada_id = :j and e.casa_clave = any(cast(:casas as text[]))
    """), {"j": j.id, "casas": list(CASAS)}).all()
    por_casa = {f.casa_clave: f for f in filas}
    sp = j.sp_rentabilidad
    casa = [CasaSemana(casa=c, rentabilidad=por_casa[c].rentabilidad,
                       dif_sp=(por_casa[c].rentabilidad - sp)
                       if por_casa[c].rentabilidad is not None and sp is not None else None,
                       puntos=por_casa[c].puntos)
            for c in CASAS if c in por_casa]
    return SemanaDemo(dia_inicio=j.dia_inicio, dia_fin=j.dia_fin, sp=sp, casa=casa)


def _notas_del(scan_run_id: int) -> str | None:
    db = fabrica_sistema()
    try:
        fecha = db.execute(text("select scan_at from scan_runs where id = :id"),
                           {"id": scan_run_id}).scalar()
        return fecha.isoformat() if fecha else None
    finally:
        db.close()


def _vigente(clave: tuple, ahora: float):
    guardado = _cache.get(clave)
    return guardado[1] if guardado and ahora - guardado[0] < _VIDA else None


def _guardar(clave: tuple, valor: object) -> None:
    ahora = time.monotonic()
    for k in [k for k, (inicio, _) in _cache.items() if ahora - inicio >= _VIDA]:
        del _cache[k]
    _cache[clave] = (ahora, valor)


def _ordenadas(contexto) -> list:
    clave = ("orden", contexto.foto_id, contexto.scan_run_id)
    ordenadas = _vigente(clave, time.monotonic())
    if ordenadas is None:
        ordenadas = ordenar(contexto.empresas)
        _guardar(clave, ordenadas)
    return ordenadas


def portada(db, idioma: str) -> PortadaOut:
    idioma = idioma if idioma in ("es", "en") else "es"
    contexto = estrategias.contexto_de_referencia()
    clave = ("portada", contexto.foto_id, contexto.scan_run_id, idioma)
    with _candado:
        vigente = _vigente(clave, time.monotonic())
        if vigente is not None:
            return vigente
        ordenadas = _ordenadas(contexto)
        datos = PortadaOut(
            foto_id=contexto.foto_id, notas_del=_notas_del(contexto.scan_run_id),
            total=len(ordenadas), anillos=_anillos(ordenadas),
            estilos=_estilos(ordenadas, contexto, idioma), semana=_semana(db))
        _guardar(clave, datos)
        return datos


def empresa_de_rango(rango: int) -> EmpresaRango | None:
    contexto = estrategias.contexto_de_referencia()
    with _candado:
        ordenadas = _ordenadas(contexto)
    if not 0 <= rango < len(ordenadas):
        return None
    e = ordenadas[rango]
    cap = _capitalizacion(e)
    return EmpresaRango(rango=rango, ticker=e.ticker, nombre=e.nombre,
                        musd=round(cap / 1_000_000) if cap is not None else None,
                        sector=e.sector)
