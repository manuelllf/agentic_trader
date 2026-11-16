"""Lista inicial de seguimiento: sale del último escaneo con decisión, sin coste nuevo.
Después el agente decide qué sigue; esto solo se usa al nacer."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.agente.models import Seguimiento

# Las mejores del análisis profundo más la propuesta: ni todo el universo ni solo cinco.
TOP_PROFUNDO = 25

_SQL_ULTIMO_ESCANEO = text("""
with r as (select id, scan_at::date as dia from public.scan_runs
           where decide and error is null order by id desc limit 1),
top as (select a.ticker, max(a.deep_score) as nota from public.scan_audit a, r
        where a.scan_run_id = r.id and a.reached_deep and a.deep_score is not null
        group by a.ticker order by nota desc limit :n),
prop as (select c.ticker from public.scan_run_construction_item c, r where c.scan_run_id = r.id)
select x.ticker, x.nota, x.ticker in (select ticker from prop) as propuesta, r.id, r.dia
from (select ticker, nota from top
      union select p.ticker, (select max(a.deep_score) from public.scan_audit a, r
                              where a.scan_run_id = r.id and a.ticker = p.ticker) from prop p) x, r
order by x.nota desc nulls last
""")


@dataclass(frozen=True)
class Candidata:
    ticker: str
    motivo: str


def leer_ultimo_escaneo(s_vennett: Session, n: int = TOP_PROFUNDO) -> list[Candidata]:
    """Lee la base de Vennett con el usuario de solo lectura."""
    filas = s_vennett.execute(_SQL_ULTIMO_ESCANEO, {"n": n}).all()
    out = []
    for ticker, nota, propuesta, run_id, dia in filas:
        partes = [f"semilla: escaneo {run_id} del {dia.isoformat()}"]
        if nota is not None:
            partes.append(f"nota profunda {float(nota):.0f}")
        if propuesta:
            partes.append("en la propuesta")
        out.append(Candidata(ticker, ", ".join(partes)))
    return out


def sembrar(s: Session, candidatas: list[Candidata]) -> int:
    """Añade las que no se siguen ya; devuelve cuántas entraron."""
    activas = set(s.scalars(select(Seguimiento.ticker).where(Seguimiento.hasta.is_(None))))
    nuevas = [c for c in dict((c.ticker, c) for c in candidatas).values()
              if c.ticker not in activas]
    s.add_all(Seguimiento(ticker=c.ticker, motivo=c.motivo) for c in nuevas)
    s.flush()
    return len(nuevas)
