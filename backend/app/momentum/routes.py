"""Endpoints de Omega (momentum) -- todos protegidos por `require_auth` (se engancha en
main.py, igual que el resto de la API). Solo lectura salvo dos escrituras explícitas:
marcar ejecutada/vendida y decidir un candidato -- nunca una orden a IBKR (esta sala no
ejecuta, ver docs/momentum-sala-real-x.md).

Sin ORM para las tablas momentum_* a propósito (SQL manda, ver [[supabase-db-first]]):
son 3 tablas nuevas y sencillas, y esta sala no comparte modelos con el ranker.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import bindparam, text, update
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import MomentumCandidato, MomentumEjecucion, MomentumSenal, MomentumUniversoEstado
from app.momentum import candidatos as candidatos_mod
from app.momentum import capital, gate_config, gate_progress, gate_runner, signals

logger = logging.getLogger(__name__)

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
    resumen = capital.resumen(db)
    gasto = db.execute(text("""
        select coalesce(sum(cost_usd), 0) as usd, count(*) as n
        from momentum_gate_llamadas where ok = true
    """)).mappings().first()
    resumen["gate_gastado_usd"] = str(gasto["usd"])
    resumen["gate_llamadas"] = int(gasto["n"])
    return resumen


@router.get("/regimen")
def regimen_actual(db: Session = Depends(get_db)) -> dict:
    """Termómetro de régimen EN VIVO (cesta equiponderada del universo a 60 sesiones), para
    enseñarlo en la sala. Puramente informativo -- ver `app.momentum.regimen`, no bloquea nada.

    `signals.UNIVERSO` empieza vacío en cada proceso nuevo y solo se rellena al llamar a
    `sincronizar_universo` (bug real: `/alertas`/`/historial` no lo hacían, así que en un
    backend recién arrancado este endpoint devolvía `cesta_60d: null` siempre, hasta que
    alguien abría la pestaña Universo por su cuenta)."""
    from app.momentum import regimen as regimen_mod
    from app.momentum import signals

    candidatos_mod.sincronizar_universo(db)
    cesta = regimen_mod.cesta_60d(list(signals.UNIVERSO))
    return {
        "cesta_60d": cesta,
        "umbral": regimen_mod.UMBRAL,
        "activo": cesta is not None and cesta < regimen_mod.UMBRAL,
    }


def _mantener_map(db: Session) -> dict[str, bool]:
    """Overrides de 'mantener en universo' -- sin fila = True por defecto (ver doc §5)."""
    rows = db.execute(text("select ticker, mantener from momentum_universo_estado")).mappings().all()
    return {r["ticker"]: bool(r["mantener"]) for r in rows}


@router.get("/universo")
def universo(db: Session = Depends(get_db)) -> list[dict]:
    candidatos_mod.sincronizar_universo(db)
    mantener = _mantener_map(db)
    return [{"ticker": t, "sector": signals.SECTOR[t], "mantener": mantener.get(t, True)}
            for t in signals.UNIVERSO]


_PRECIOS_VIVOS_HILOS = 4  # tope bajo a propósito -- yfinance sin key, cubrirse cuesta cero


@router.get("/precios-vivos")
def precios_vivos(tickers: str) -> dict[str, float | None]:
    """Precio en vivo (best-effort) de los tickers pedidos -- SOLO para pintar de referencia en
    Alertas activas. `null` si yfinance no responde para ese ticker; nunca toca entrada/salida.

    En paralelo (máx 4 hilos) desde el 9-sep-2026: antes era un `fast_info` por ticker EN SERIE
    dentro de la misma petición -- con 10+ alertas activas eran 10+ ida-vueltas de red seguidas
    bloqueando el hilo de FastAPI. No es el scraper grande (un solo precio, sin histórico), pero
    4 a la vez de margen no cuesta nada y evita saturar a Yahoo con un pico de golpe."""
    lista = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not lista:
        return {}
    with ThreadPoolExecutor(max_workers=min(_PRECIOS_VIVOS_HILOS, len(lista))) as ex:
        precios = ex.map(signals.precio_vivo, lista)
    return dict(zip(lista, precios, strict=True))


def _ultimas_ejecuciones(db: Session, senal_ids: list[int]) -> dict[int, dict]:
    """Última compra registrada por señal (`momentum_ejecuciones`, accion='compra') -- lo que
    Manuel escribió de verdad al marcar "Ejecutada" (acciones/precio/comisión/notas). Vive en
    tabla aparte y hasta ahora ningún endpoint la devolvía: se guardaba y no se volvía a ver
    (bug real, 14-sep-2026)."""
    if not senal_ids:
        return {}
    rows = db.execute(text("""
        select senal_id, acciones, precio, comision, notas, ejecutada_at
        from momentum_ejecuciones
        where senal_id in :ids and accion = 'compra'
        order by ejecutada_at desc
    """).bindparams(bindparam("ids", expanding=True)), {"ids": senal_ids}).mappings().all()
    out: dict[int, dict] = {}
    for r in rows:
        out.setdefault(r["senal_id"], _row(dict(r)))  # primera vista = la más reciente (ORDER BY)
    return out


@router.get("/alertas")
def alertas(db: Session = Depends(get_db)) -> list[dict]:
    """Señales sin resolver, no descartadas -- más reciente primero. `cuidado` se calcula aquí
    (no se guarda): son días reales desde hoy, no un valor que se pueda quedar desactualizado.
    Los tickers apagados (`momentum_universo_estado.mantener=false`) se siguen escaneando pero
    sus señales no cuentan como alerta activa."""
    rows = db.execute(text("""
        select * from momentum_senales
        where resuelta = false and estado not in ('descartada', 'vendida')
          and ticker not in (select ticker from momentum_universo_estado where mantener = false)
        order by entry_date desc
    """)).mappings().all()
    hoy = date.today()
    ejecuciones = _ultimas_ejecuciones(db, [m["id"] for m in rows if m["estado"] == "ejecutada"])
    posiciones = capital.posiciones_abiertas(db)
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
        if m["estado"] == "ejecutada":
            r["ejecucion"] = ejecuciones.get(m["id"])
            pos = posiciones.get(m["id"])
            if pos:
                r["posicion_abierta"] = {"acciones": str(pos["neto"]), "coste_medio": str(pos["coste_medio"])}
        out.append(r)
    return out


def _cierres_manuales(db: Session, senales: list[dict]) -> dict[int, dict]:
    """Resultado real de una posición cerrada A MANO: proceeds reales menos coste medio de
    compra. Aparte de `resuelta`/`ret` de `momentum_senales` a propósito (ver `ejecutar()`) --
    esto es lo que de verdad pasó con tu dinero, no la resolución uniforme que usa /validacion.

    `ret_sistema`: la salida del algoritmo (si ya resolvió) aplicada a TU coste medio -- lo que
    habría dado dejarla correr sola desde tu entrada. Nunca sustituye a `ret`."""
    por_id = {s["id"]: s for s in senales}
    senal_ids = list(por_id)
    if not senal_ids:
        return {}
    rows = db.execute(text("""
        select senal_id,
               sum(case when accion = 'compra' then acciones else 0 end) as compradas,
               sum(case when accion = 'compra' then acciones * precio + comision else 0 end) as coste,
               sum(case when accion = 'venta' then acciones else 0 end) as vendidas,
               sum(case when accion = 'venta' then acciones * precio - comision else 0 end) as proceeds,
               max(case when accion = 'venta' then ejecutada_at end) as exit_at
        from momentum_ejecuciones
        where senal_id in :ids
        group by senal_id
    """).bindparams(bindparam("ids", expanding=True)), {"ids": senal_ids}).mappings().all()
    out: dict[int, dict] = {}
    for r in rows:
        compradas = Decimal(str(r["compradas"] or 0))
        if compradas <= 0:
            continue
        coste_medio = Decimal(str(r["coste"])) / compradas
        vendidas = Decimal(str(r["vendidas"] or 0))
        coste_vendido = vendidas * coste_medio
        if coste_vendido <= 0:
            continue
        ret = (Decimal(str(r["proceeds"] or 0)) / coste_vendido - 1) * 100
        exit_at = r["exit_at"]
        if isinstance(exit_at, str):
            exit_at = datetime.fromisoformat(exit_at)
        s = por_id[r["senal_id"]]
        ret_sistema = None
        if s["resuelta"] and s["ret"] is not None and s["entry_price"]:
            salida = Decimal(str(s["entry_price"])) * (1 + Decimal(str(s["ret"])) / 100)
            ret_sistema = str((salida / coste_medio - 1) * 100)
        out[r["senal_id"]] = {
            "acciones": str(vendidas), "ret": str(ret), "ret_sistema": ret_sistema,
            "exit_date": exit_at.date().isoformat() if exit_at else None,
        }
    return out


@router.get("/historial")
def historial(db: Session = Depends(get_db)) -> list[dict]:
    """Señales resueltas + las descartadas/vendidas a mano que el algoritmo aún no ha resuelto.
    Una descartada NO desaparece: sigue en el escaneo diario, se ve en curso con retorno
    mark-to-market en vivo -- para ver "la descarté y habría hecho X%". Una vendida a mano
    entra ya con su resultado REAL (`cierre_manual`), no espera a que el job diario la alcance
    (bug real: antes se quedaba fantasma en Alertas activas trackeando precio en vivo de una
    posición que ya no existía). `dias` se recalcula aquí para las abiertas (como en /alertas),
    el guardado se queda viejo."""
    rows = db.execute(text("""
        select * from momentum_senales
        where resuelta = true
           or (estado in ('descartada', 'vendida') and resuelta = false)
        order by resuelta, entry_date desc
    """)).mappings().all()
    hoy = date.today()
    mantener = _mantener_map(db)
    # También las ya resueltas: si la cerraste a mano, tu cierre manda aunque el job la alcance.
    cierres = _cierres_manuales(db, [dict(m) for m in rows if m["estado"] == "vendida"])
    out = []
    for m in rows:
        r = _row(dict(m))
        r["mantener"] = mantener.get(m["ticker"], True)
        if not m["resuelta"]:
            entry_date = m["entry_date"]
            if isinstance(entry_date, str):
                entry_date = date.fromisoformat(entry_date)
            r["dias"] = (hoy - entry_date).days
        if m["estado"] == "vendida":
            r["cierre_manual"] = cierres.get(m["id"])
        out.append(r)
    return out


@router.get("/validacion")
def validacion(db: Session = Depends(get_db)) -> list[dict]:
    """Agregado por ticker (n, media, mediana, % positivas) sobre señales YA resueltas. La
    mediana no tiene función nativa portable en SQL simple -- se calcula en Python sobre los
    retornos, la tabla no es lo bastante grande para que importe el viaje extra."""
    candidatos_mod.sincronizar_universo(db)
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
    candidatos_mod.sincronizar_universo(db)
    if ticker not in signals.UNIVERSO:
        raise HTTPException(404, "Ticker fuera del universo fijo.")
    estado = db.get(MomentumUniversoEstado, ticker)
    if estado is None:
        db.add(MomentumUniversoEstado(ticker=ticker, mantener=body.mantener))
    else:
        estado.mantener = body.mantener
        estado.actualizado_at = datetime.now(UTC)
    db.commit()
    return {"ok": True, "ticker": ticker, "mantener": body.mantener}


@router.get("/candidatos")
def candidatos(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(text("""
        select * from momentum_candidatos order by fecha_evaluacion desc
    """)).mappings().all()
    return [_row(dict(m)) for m in rows]


@router.get("/candidatos/buscar")
def buscar_candidato(ticker: str, db: Session = Depends(get_db)) -> dict | None:
    """Para el buscador de la sala: la fila más reciente de ese ticker si ya existe (de
    ApeWisdom o de un alta manual anterior), o `null` si nunca se vio -- el frontend crea
    uno nuevo en ese caso (`POST /candidatos`)."""
    row = db.execute(text("""
        select * from momentum_candidatos where ticker = :t
        order by fecha_evaluacion desc, id desc limit 1
    """), {"t": ticker.strip().upper()}).mappings().first()
    return _row(dict(row)) if row else None


class CandidatoManualIn(BaseModel):
    ticker: str


@router.post("/candidatos")
def crear_candidato_manual(body: CandidatoManualIn, db: Session = Depends(get_db)) -> dict:
    """Alta manual -- Manuel ficha un ticker que él mismo detectó, sin esperar a ApeWisdom.
    Mismo pipeline desde aquí en adelante (filtros -> gate) que un candidato automático."""
    try:
        return _row(candidatos_mod.crear_manual(body.ticker, db))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/admin/candidatos-detectar")
def admin_detectar_candidatos(db: Session = Depends(get_db)) -> dict:
    """Rescate manual de la detección diaria de ApeWisdom (mismo patrón que `/admin/scan`):
    por si el cron `apewisdom_capture` (16:10 ET) no ha corrido todavía o falló. Gratis, sin
    gate -- no dispara ningún gasto real."""
    try:
        n = candidatos_mod.detectar_rupturas(db)
        return {"ok": True, "nuevos": n}
    except Exception:  # noqa: BLE001
        # Detalle entero al log; al panel, mensaje corto (nunca el SQL/stacktrace en la cara).
        logger.exception("Fallo en la detección manual de rupturas")
        return {"ok": False, "error": "No se pudo completar la detección. Revisa los logs del servidor."}


class EjecucionIn(BaseModel):
    accion: Literal["compra", "venta"]
    acciones: float
    precio: float
    comision: float = 0.0
    notas: str = ""


@router.post("/senales/{senal_id}/ejecutar")
def ejecutar(senal_id: int, body: EjecucionIn, db: Session = Depends(get_db)) -> dict:
    """Marcar ejecutada/vendida/aumentada: SIEMPRE a mano, nunca dispara una orden. Admite
    varias filas por señal -- aumentar una posición abierta, o cerrarla en varias veces -- el
    estado se recalcula por ACCIONES NETAS tras esta fila, no a ciegas según su tipo (bug real:
    una venta parcial marcaba la señal entera como 'vendida')."""
    senal = db.execute(text("select id from momentum_senales where id = :id"),
                       {"id": senal_id}).mappings().first()
    if senal is None:
        raise HTTPException(404, "Señal no encontrada.")

    neto_previo = Decimal(str(db.execute(text("""
        select coalesce(sum(case when accion = 'compra' then acciones else -acciones end), 0)
        from momentum_ejecuciones where senal_id = :id
    """), {"id": senal_id}).scalar() or 0))

    if body.accion == "venta" and Decimal(str(body.acciones)) > neto_previo:
        raise HTTPException(400, f"Solo hay {neto_previo} acciones abiertas -- no puedes vender {body.acciones}.")

    # Dinero a NUMERIC exacto: Decimal desde el texto, nunca el float tal cual.
    db.add(MomentumEjecucion(
        senal_id=senal_id, accion=body.accion, acciones=Decimal(str(body.acciones)),
        precio=Decimal(str(body.precio)), comision=Decimal(str(body.comision)), notas=body.notas,
    ))

    delta = Decimal(str(body.acciones)) if body.accion == "compra" else -Decimal(str(body.acciones))
    nuevo_estado = "ejecutada" if (neto_previo + delta) > 0 else "vendida"
    db.execute(update(MomentumSenal).where(MomentumSenal.id == senal_id)
               .values(estado=nuevo_estado))
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
    db.execute(update(MomentumSenal).where(MomentumSenal.id == senal_id)
               .values(estado="descartada"))
    db.commit()
    return {"ok": True, "senal_id": senal_id, "estado": "descartada"}


class CandidatoDecisionIn(BaseModel):
    decision: Literal["incorporado", "descartado"]


@router.post("/candidatos/{candidato_id}/decision")
def decidir_candidato(candidato_id: int, body: CandidatoDecisionIn, db: Session = Depends(get_db)) -> dict:
    """Decisión SIEMPRE de Manuel, nunca automática -- ni el filtro ni el gate deciden por él
    (corregido 8-sep-2026, era un sesgo real). Si incorpora, se propaga al universo real
    (escaneo, validación, universo) Y se calcula ya su historial/alerta activa -- como
    cualquiera de los 34 fijos, sin esperar al cron (ver `candidatos.backfill_señales`)."""
    row = db.execute(text("select id, ticker from momentum_candidatos where id = :id"),
                     {"id": candidato_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "Candidato no encontrado.")
    db.execute(update(MomentumCandidato).where(MomentumCandidato.id == candidato_id)
               .values(decision=body.decision, decidido_por="manual"))
    db.commit()
    if body.decision == "incorporado":
        candidatos_mod.sincronizar_universo(db)
        candidatos_mod.backfill_señales(row["ticker"], db)
    return {"ok": True, "candidato_id": candidato_id, "decision": body.decision}


@router.post("/candidatos/{candidato_id}/comprobar-filtros")
def comprobar_filtros_candidato(candidato_id: int, db: Session = Depends(get_db)) -> dict:
    """Etapas 1+2 (sector + estadística) -- gratis, a demanda, candidato a candidato."""
    try:
        return _row(candidatos_mod.comprobar_filtros(candidato_id, db))
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/candidatos/{candidato_id}/gate")
def gate_candidato(candidato_id: int, db: Session = Depends(get_db)) -> dict:
    """Única llamada LLM del candidato -- siempre un clic explícito, uno a la vez, nunca en
    bloque (decidido 8-sep-2026: aparte del gate de señales a propósito, ver `candidatos.py`).

    Valida al momento y solo LANZA la llamada real en segundo plano -- esperar aquí es lo que
    daba timeout en el navegador con el gate ya en curso por detrás (14-sep-2026, mismo patrón
    que el gate de señales y el escaneo). El progreso real se sondea en
    `GET /candidatos/{id}/gate/progreso`."""
    try:
        candidatos_mod.lanzar_gate_candidato(candidato_id, db)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"lanzado": True}


@router.get("/candidatos/{candidato_id}/gate/progreso")
def gate_progreso_candidato(candidato_id: int, db: Session = Depends(get_db)) -> dict:
    estado = candidatos_mod.gate_progreso_candidato(candidato_id)
    row = None
    if estado["status"] != "running":
        row = db.execute(text("select * from momentum_candidatos where id = :id"),
                         {"id": candidato_id}).mappings().first()
    return {**estado, "candidato": _row(dict(row)) if row else None}


class EvaluarPendientesIn(BaseModel):
    ids: list[int]


@router.post("/gate/evaluar-pendientes")
def evaluar_pendientes(body: EvaluarPendientesIn, db: Session = Depends(get_db)) -> dict:
    """ÚNICO punto donde el gate gasta dinero real -- se llama SOLO con un clic explícito desde
    la sala, nunca desde el cron. `ids` los elige Manuel señal a señal (decidido 8-sep-2026: no
    hay "evaluar todas" a ciegas, igual que el gate de candidatos). Solo LANZA el trabajo en
    segundo plano (ver `gate_runner`) y responde al momento -- varias llamadas reales en serie
    tardan minutos, y esperar aquí es lo que se colgó en producción el 7-sep-2026. El progreso
    real se sondea en `GET /gate/progreso`."""
    ids = list(dict.fromkeys(body.ids))  # sin duplicados, mismo orden
    if not ids:
        return {"lanzado": False, "motivo": "sin selección", "pendientes": 0}
    pendientes = db.execute(text("""
        select count(*) from momentum_senales
        where id in :ids and gate_resultado is null and estado != 'descartada'
    """).bindparams(bindparam("ids", expanding=True)), {"ids": ids}).scalar()
    if pendientes == 0:
        return {"lanzado": False, "motivo": "sin pendientes", "pendientes": 0}
    if not gate_runner.start(ids):
        return {"lanzado": False, "motivo": "ya en curso", "pendientes": pendientes}
    return {"lanzado": True, "pendientes": pendientes}


@router.get("/gate/progreso")
def gate_progreso() -> dict:
    return gate_progress.snapshot()


class GateConfigIn(BaseModel):
    provider: Literal["deepseek", "qwen"]


@router.get("/gate/config")
def gate_config_get(db: Session = Depends(get_db)) -> dict:
    return {"provider": gate_config.get_gate_provider(db)}


@router.put("/gate/config")
def gate_config_set(body: GateConfigIn, db: Session = Depends(get_db)) -> dict:
    """Selector MANUAL del proveedor del gate (candidatos + señales), persistido hasta que
    Manuel lo vuelva a cambiar -- sin failover automático (ver `gate_config.py`)."""
    return {"provider": gate_config.set_gate_provider(db, body.provider)}


@router.post("/admin/scan")
def admin_scan() -> dict:
    """Rescate manual del escaneo diario (mismo patrón que `/admin/universe-snapshot` del
    ranker): por si el cron `momentum_scan` (16:45 ET) todavía no ha corrido o falló. Gratis
    (yfinance, sin gate) -- no dispara ningún gasto real.

    Segundo plano desde el 9-sep-2026 (ver `scan_runner.py`): recorrer el universo entero puede
    superar el timeout del cliente -- antes esto se esperaba dentro de la propia petición y
    podía dar un "timeout" en el navegador con el escaneo ya completado por detrás (mismo bug
    que ya mordió al gate). Solo lanza y responde al momento; `GET /momentum/scan/progreso`
    sondea el resultado real."""
    from app.momentum import scan_runner

    if not scan_runner.start():
        return {"lanzado": False, "motivo": "ya en curso"}
    return {"lanzado": True}


@router.get("/scan/progreso")
def scan_progreso() -> dict:
    from app.momentum import scan_progress

    return scan_progress.snapshot()
