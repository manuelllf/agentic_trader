"""Endpoints de Sala Real X (momentum) -- todos protegidos por `require_auth` (se engancha en
main.py, igual que el resto de la API). Solo lectura salvo dos escrituras explícitas:
marcar ejecutada/vendida y decidir un candidato -- nunca una orden a IBKR (esta sala no
ejecuta, ver docs/momentum-sala-real-x.md).

Sin ORM para las tablas momentum_* a propósito (SQL manda, ver [[supabase-db-first]]):
son 3 tablas nuevas y sencillas, y esta sala no comparte modelos con el ranker.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi import Depends

from app.db import get_db
from app.momentum import capital, news_gate, signals

router = APIRouter(prefix="/momentum", tags=["momentum"])


def _row(m: dict[str, Any]) -> dict[str, Any]:
    """Una fila de `.mappings()` a JSON-seguro: Decimal/date/datetime a str."""
    out = {}
    for k, v in m.items():
        if isinstance(v, Decimal):
            out[k] = str(v)
        elif isinstance(v, (date, datetime)):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


@router.get("/cuenta")
def cuenta(db: Session = Depends(get_db)) -> dict:
    return capital.resumen(db)


def _mantener_map(db: Session) -> dict[str, bool]:
    """Overrides de 'mantener en universo' -- sin fila = True por defecto (ver doc §5)."""
    rows = db.execute(text("select ticker, mantener from momentum_universo_estado")).mappings().all()
    return {r["ticker"]: bool(r["mantener"]) for r in rows}


@router.get("/universo")
def universo(db: Session = Depends(get_db)) -> list[dict]:
    mantener = _mantener_map(db)
    return [{"ticker": t, "sector": signals.SECTOR[t], "mantener": mantener.get(t, True)}
            for t in signals.UNIVERSO]


@router.get("/alertas")
def alertas(db: Session = Depends(get_db)) -> list[dict]:
    """Señales sin resolver, no descartadas -- más reciente primero. `cuidado` se calcula aquí
    (no se guarda): son días reales desde hoy, no un valor que se pueda quedar desactualizado."""
    rows = db.execute(text("""
        select * from momentum_senales
        where resuelta = false and estado != 'descartada'
        order by entry_date desc
    """)).mappings().all()
    hoy = date.today()
    out = []
    for m in rows:
        r = _row(dict(m))
        # Postgres devuelve `date` real; SQLite (dev local) lo guarda como texto -- se
        # normaliza aquí para que el cálculo no dependa del motor de base de datos.
        entry_date = m["entry_date"]
        if isinstance(entry_date, str):
            entry_date = date.fromisoformat(entry_date)
        dias = (hoy - entry_date).days
        r["dias"] = dias
        r["cuidado"] = dias > signals.CUIDADO_DIAS
        out.append(r)
    return out


@router.get("/historial")
def historial(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(text("""
        select * from momentum_senales where resuelta = true order by entry_date desc
    """)).mappings().all()
    return [_row(dict(m)) for m in rows]


@router.get("/validacion")
def validacion(db: Session = Depends(get_db)) -> list[dict]:
    """Agregado por ticker (n, media, mediana, % positivas) sobre señales YA resueltas. La
    mediana no tiene función nativa portable en SQL simple -- se calcula en Python sobre los
    retornos, la tabla no es lo bastante grande para que importe el viaje extra."""
    rows = db.execute(text("""
        select ticker, sector, ret from momentum_senales where resuelta = true
    """)).mappings().all()
    por_ticker: dict[str, list[dict]] = {}
    for m in rows:
        por_ticker.setdefault(m["ticker"], []).append(m)
    mantener = _mantener_map(db)
    out = []
    for ticker in signals.UNIVERSO:
        rs = por_ticker.get(ticker, [])
        n = len(rs)
        base = {"ticker": ticker, "sector": signals.SECTOR[ticker], "mantener": mantener.get(ticker, True)}
        if n == 0:
            out.append({**base, "n": 0, "media": None, "mediana": None, "pct_positivas": None})
            continue
        rets = sorted(float(r["ret"]) for r in rs)
        media = sum(rets) / n
        mediana = rets[n // 2] if n % 2 else (rets[n // 2 - 1] + rets[n // 2]) / 2
        pct_pos = sum(1 for x in rets if x > 0) / n * 100
        out.append({**base, "n": n, "media": round(media, 1), "mediana": round(mediana, 1),
                   "pct_positivas": round(pct_pos)})
    return out


class MantenerIn(BaseModel):
    mantener: bool


@router.post("/universo/{ticker}/mantener")
def set_mantener(ticker: str, body: MantenerIn, db: Session = Depends(get_db)) -> dict:
    """Toggle manual de un ticker fijo -- nunca lo saca del código, solo lo marca para que la
    sala lo destaque como pendiente de revisión (ver doc §5). El sistema recomienda, no decide."""
    ticker = ticker.upper()
    if ticker not in signals.UNIVERSO:
        raise HTTPException(404, "Ticker fuera del universo fijo.")
    # Update-then-insert en vez de ON CONFLICT: portable entre Postgres (real) y SQLite (dev
    # local), que difieren en la sintaxis del upsert y en la función de fecha por defecto.
    existe = db.execute(text("select 1 from momentum_universo_estado where ticker = :t"),
                        {"t": ticker}).first()
    if existe:
        db.execute(text("update momentum_universo_estado set mantener = :m where ticker = :t"),
                  {"m": body.mantener, "t": ticker})
    else:
        db.execute(text("insert into momentum_universo_estado (ticker, mantener) values (:t, :m)"),
                  {"t": ticker, "m": body.mantener})
    db.commit()
    return {"ok": True, "ticker": ticker, "mantener": body.mantener}


@router.get("/candidatos")
def candidatos(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(text("""
        select * from momentum_candidatos order by fecha_evaluacion desc
    """)).mappings().all()
    return [_row(dict(m)) for m in rows]


class EjecucionIn(BaseModel):
    accion: Literal["compra", "venta"]
    acciones: float
    precio: float
    comision: float = 0.0
    notas: str = ""


@router.post("/senales/{senal_id}/ejecutar")
def ejecutar(senal_id: int, body: EjecucionIn, db: Session = Depends(get_db)) -> dict:
    """Marcar ejecutada/vendida: SIEMPRE a mano, nunca dispara una orden. `acciones`/`precio`/
    `comision` van editables desde la sala, prellenados con la señal pero el fill real puede
    no cuadrar (ver doc §5)."""
    senal = db.execute(text("select id, estado from momentum_senales where id = :id"),
                       {"id": senal_id}).mappings().first()
    if senal is None:
        raise HTTPException(404, "Señal no encontrada.")
    db.execute(text("""
        insert into momentum_ejecuciones (senal_id, accion, acciones, precio, comision, notas)
        values (:senal_id, :accion, :acciones, :precio, :comision, :notas)
    """), {"senal_id": senal_id, **body.model_dump()})
    nuevo_estado = "ejecutada" if body.accion == "compra" else "vendida"
    db.execute(text("update momentum_senales set estado = :estado where id = :id"),
              {"estado": nuevo_estado, "id": senal_id})
    db.commit()
    return {"ok": True, "senal_id": senal_id, "estado": nuevo_estado}


@router.post("/senales/{senal_id}/descartar")
def descartar(senal_id: int, db: Session = Depends(get_db)) -> dict:
    """Descartar una alerta a mano -- distinto de que falle el gate (eso ya pone
    estado='descartada' solo). Aquí es una decisión explícita de Manuel de no actuarla."""
    senal = db.execute(text("select id from momentum_senales where id = :id"),
                       {"id": senal_id}).mappings().first()
    if senal is None:
        raise HTTPException(404, "Señal no encontrada.")
    db.execute(text("update momentum_senales set estado = 'descartada' where id = :id"),
              {"id": senal_id})
    db.commit()
    return {"ok": True, "senal_id": senal_id, "estado": "descartada"}


class CandidatoDecisionIn(BaseModel):
    decision: Literal["incorporado", "descartado"]


@router.post("/candidatos/{candidato_id}/decision")
def decidir_candidato(candidato_id: int, body: CandidatoDecisionIn, db: Session = Depends(get_db)) -> dict:
    """Decisión SIEMPRE de Manuel, nunca automática -- el sistema solo propone un valor por
    defecto al crear la fila (ver doc §1: pasa las 3 condiciones → incorporado por defecto,
    falla cualquiera → descartado por defecto). Esto la sobreescribe explícitamente."""
    row = db.execute(text("select id from momentum_candidatos where id = :id"),
                     {"id": candidato_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "Candidato no encontrado.")
    db.execute(text("""
        update momentum_candidatos set decision = :decision, decidido_por = 'manual'
        where id = :id
    """), {"decision": body.decision, "id": candidato_id})
    db.commit()
    return {"ok": True, "candidato_id": candidato_id, "decision": body.decision}


@router.post("/gate/evaluar-pendientes")
def evaluar_pendientes(db: Session = Depends(get_db)) -> dict:
    """ÚNICO punto donde el gate gasta dinero real -- se llama SOLO con un clic explícito desde
    la sala, nunca desde el cron (ver `_momentum_scan_job`, que guarda gate pendiente y para
    ahí). Evalúa todas las señales con `gate_resultado is null`; idempotente por construcción
    -- una vez evaluada, deja de estar pendiente."""
    pendientes = db.execute(text("""
        select * from momentum_senales where gate_resultado is null and estado != 'descartada'
    """)).mappings().all()
    resultados = []
    for m in pendientes:
        entry_date = m["entry_date"]
        if isinstance(entry_date, str):
            entry_date = date.fromisoformat(entry_date)
        desde = m["desde_noticias"]
        if isinstance(desde, str):
            desde = date.fromisoformat(desde)
        try:
            r = news_gate.evaluar(
                m["ticker"], signals.NOMBRE.get(m["ticker"], m["ticker"]),
                ath=float(m["ath"]), entry_date=entry_date, entry_price=float(m["entry_price"]),
                caida_pct=float(m["caida_pct"]), desde=desde,
            )
            nuevo_estado = "nueva" if r.pasa else "descartada"
            db.execute(text("""
                update momentum_senales
                set gate_resultado = :res, gate_detalle = :detalle, estado = :estado
                where id = :id
            """), {"res": "pasa" if r.pasa else "falla", "detalle": r.motivo,
                   "estado": nuevo_estado, "id": m["id"]})
            resultados.append({"id": m["id"], "ticker": m["ticker"], "pasa": r.pasa, "motivo": r.motivo})
        except Exception as exc:
            resultados.append({"id": m["id"], "ticker": m["ticker"], "pasa": None, "motivo": f"error: {exc}"})
    db.commit()
    return {"evaluadas": len(resultados), "resultados": resultados}
