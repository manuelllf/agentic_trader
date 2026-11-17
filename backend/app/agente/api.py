"""API de lectura del panel de admin del agente (más una única escritura: la parada).

La identidad es la de Vennett (JWT de Supabase): aquí solo firma, 2FA y lista de admins."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agente import base, libro, limites, puerta, reloj
from app.agente.config import ajustes
from app.agente.models import Estado, Evento
from app.mercado.calendario import TZ_NUEVA_YORK, es_dia_de_bolsa
from app.supabase_auth import Identidad, verificar

router = APIRouter(prefix="/v1")

DIAS_SERIE = 400
RECORTE = 280
MAX_BUSQUEDA = 30
MAX_PAGINA = 100
EVENTOS_HOY = 50


def admin_agente(authorization: str = Header(default="")) -> Identidad:
    """Sin token 401; sin 2FA 403; quien no es admin del agente, 404 para no revelar la ruta."""
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Entra en tu cuenta para seguir.")
    ident = verificar(token)
    if ident.aal != "aal2":
        raise HTTPException(403, "Falta el código de verificación en dos pasos.")
    admins = {u.strip() for u in ajustes.admin_ids.split(",") if u.strip()}
    if ident.uid not in admins:
        raise HTTPException(404, "Not Found")
    return ident


def _json(v: Any) -> Any:  # noqa: ANN401
    """Dinero y números como texto decimal; fechas en ISO."""
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, datetime | date):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: _json(x) for k, x in v.items()}
    if isinstance(v, list | tuple):
        return [_json(x) for x in v]
    return v


def _filas(s: Session, sql: str, **params: Any) -> list[dict[str, Any]]:  # noqa: ANN401
    return [_json(dict(r._mapping)) for r in s.execute(text(sql), params)]


def _recortar(texto: str) -> str:
    return texto if len(texto) <= RECORTE else texto[:RECORTE].rstrip() + "…"


def _resumen(fila: dict[str, Any]) -> dict[str, Any]:
    return {"id": fila["id"], "fecha": fila["fecha_ny"], "tipo": fila["tipo"],
            "sombra": fila["sombra"], "veredicto": fila["revisor_veredicto"],
            "razonamiento": _recortar(fila["razonamiento"])}


_COLUMNAS_RESUMEN = "id, fecha_ny, tipo, sombra, revisor_veredicto, razonamiento"


def _cartera_json(c: limites.Cartera) -> dict[str, Any]:
    return {
        "caja": str(c.caja), "valor_total": str(c.valor_total),
        "valor_maximo": str(c.valor_maximo),
        "caida_desde_maximo": str(c.caida_desde_maximo),
        "posiciones": [{
            "ticker": p.ticker, "acciones": str(p.acciones), "coste_medio": str(p.coste_medio),
            "precio": str(p.precio), "valor": str(p.valor), "rentabilidad": str(p.rentabilidad),
            "peso": str(c.peso(p.ticker))} for p in c.posiciones]}


def _siguiente_dia_de_bolsa(d: date) -> date:
    d += timedelta(days=1)
    while not es_dia_de_bolsa(d):
        d += timedelta(days=1)
    return d


def _despertares(hoy: date) -> list[dict[str, str]]:
    salida = []
    for dia in (hoy, _siguiente_dia_de_bolsa(hoy)):
        for tarea, hora in reloj.programa_del_dia(dia):
            salida.append({"fecha": dia.isoformat(), "tarea": tarea.value,
                           "hora": hora.isoformat()})
    return salida


@router.get("/hoy")
def hoy(_: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    dia = datetime.now(TZ_NUEVA_YORK).date()
    with base.sesion() as s:
        estado = s.get_one(Estado, 1)
        try:
            c = libro.cartera(s, dia)
        except ValueError as e:  # falta un precio: no se inventa nada
            cartera: dict[str, Any] = {"error": str(e)}
            modo = "parada" if estado.parada else None
        else:
            cartera = _cartera_json(c)
            modo = limites.modo(c, estado.parada).value
        serie = _filas(
            s, "select fecha, valor_total, valor_maximo from agente.v_valor_diario "
               "where fecha >= :d order by fecha", d=dia - timedelta(days=DIAS_SERIE))
        ultima = _filas(s, f"select {_COLUMNAS_RESUMEN} from agente.decisiones "
                           "order by id desc limit 1")
        eventos = _filas(
            s, "select id, ocurrido, origen, tipo, ticker, datos from agente.eventos "
               "where (ocurrido at time zone 'America/New_York')::date = :d "
               "order by id desc limit :n", d=dia, n=EVENTOS_HOY)
        return {
            "estado": {"parada": estado.parada, "parada_motivo": estado.parada_motivo,
                       "modo": modo, "ia_activa": ajustes.ia_activa, "sombra": ajustes.sombra},
            "cartera": cartera, "serie": serie,
            "ultima_decision": _resumen(ultima[0]) if ultima else None,
            "eventos": eventos, "despertares": _despertares(dia)}


@router.get("/decisiones")
def decisiones(limite: int = Query(20, ge=1, le=MAX_PAGINA), antes_de: int | None = None,
               _: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    with base.sesion() as s:
        filas = _filas(
            s, f"select {_COLUMNAS_RESUMEN} from agente.decisiones "
               "where (cast(:a as bigint) is null or id < :a) order by id desc limit :n",
            a=antes_de, n=limite + 1)
    hay_mas = len(filas) > limite
    items = [_resumen(f) for f in filas[:limite]]
    return {"items": items, "siguiente": items[-1]["id"] if hay_mas else None}


@router.get("/decisiones/{decision_id}")
def decision(decision_id: int, _: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    with base.sesion() as s:
        filas = _filas(
            s, "select id, ejecucion_id, fecha_ny, tipo, sombra, playbook_version_id, propuesta, "
               "razonamiento, previsiones, revisor_veredicto, revisor_motivo, modelo, creado "
               "from agente.decisiones where id = :i", i=decision_id)
        if not filas:
            raise HTTPException(404, "Not Found")
        ordenes = _filas(
            s, "select o.id, o.ticker, o.lado, o.acciones, o.importe_objetivo, o.fecha_objetivo, "
               "o.estado, o.motivo, e.ejecutada_en, e.acciones as acciones_ejecutadas, "
               "e.precio, e.comision from agente.ordenes o "
               "left join agente.ejecutadas e on e.orden_id = o.id "
               "where o.decision_id = :i order by o.id", i=decision_id)
    return {**filas[0], "ordenes": ordenes}


_COLUMNAS_LLAMADA = ("id, etapa, paso, modelo, enviado, respuesta, razonamiento, "
                     "herramientas_pedidas, coste_usd, latencia_ms, ok, error, creado")


@router.get("/decisiones/{decision_id}/llamadas")
def llamadas(decision_id: int, _: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    """Las llamadas al modelo que llevaron a la decisión, en orden. Las de antes de la columna
    `ciclo` se toman de su ejecución: desde que empezó la decisión hasta la siguiente."""
    with base.sesion() as s:
        fila = s.execute(text("select ejecucion_id, ciclo, creado from agente.decisiones "
                              "where id = :i"), {"i": decision_id}).first()
        if fila is None:
            raise HTTPException(404, "Not Found")
        if fila.ciclo is not None:
            items = _filas(s, f"select {_COLUMNAS_LLAMADA} from agente.llamadas_modelo "
                              "where ciclo = :c order by id", c=fila.ciclo)
        elif fila.ejecucion_id is None:
            items = []
        else:
            items = _filas(
                s, f"select {_COLUMNAS_LLAMADA} from agente.llamadas_modelo "
                   "where ciclo is null and ejecucion_id = :e and creado >= :desde "
                   "and etapa in ('agente', 'revisor', 'nacimiento') "
                   "and creado < coalesce((select min(creado) from agente.decisiones "
                   "  where ejecucion_id = :e and id > :i), 'infinity') order by id",
                e=fila.ejecucion_id, desde=fila.creado, i=decision_id)
    return {"items": items}


@router.get("/informes")
def informes(tipo: str | None = None, _: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    with base.sesion() as s:
        items = _filas(
            s, "select id, tipo, fecha_ny, decision_id, estado, titulo, modelo, creado "
               "from agente.informes where (cast(:t as text) is null or tipo = :t) "
               "order by fecha_ny desc, id desc limit :n", t=tipo, n=MAX_PAGINA)
    return {"items": items}


@router.get("/informes/{informe_id}")
def informe(informe_id: int, _: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    with base.sesion() as s:
        filas = _filas(
            s, "select id, tipo, fecha_ny, decision_id, estado, titulo, cuerpo, cifras, modelo, "
               "creado from agente.informes where id = :i", i=informe_id)
    if not filas:
        raise HTTPException(404, "Not Found")
    return filas[0]


@router.get("/agente")
def agente(_: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    dia = datetime.now(TZ_NUEVA_YORK).date()
    with base.sesion() as s:
        versiones = _filas(
            s, "select version, estado, motivo, adoptada_en, creado from "
               "agente.playbook_versiones order by version desc")
        vigente = _filas(
            s, "select version, contenido from agente.playbook_versiones "
               "where estado = 'vigente'")
        lecciones = _filas(
            s, "select id, texto, decision_ids, creado from agente.lecciones "
               "where estado = 'aprobada' order by id desc")
        fichas = _filas(
            s, "select ticker, certeza, version, coalesce(actualizado_en, creado) as actualizada "
               "from agente.fichas order by ticker")
        seguimiento = _filas(
            s, "select id, ticker, motivo, desde, niveles from agente.seguimiento "
               "where hasta is null order by ticker")
        gasto = _filas(
            s, "select tipo, sum(coste_usd) as coste_usd from agente.gasto "
               "where fecha_ny >= :d group by tipo order by tipo", d=dia.replace(day=1))
    gastado = sum((Decimal(g["coste_usd"]) for g in gasto), Decimal(0))
    return {
        "filosofia": vigente[0] if vigente else None, "versiones": versiones,
        "lecciones": lecciones, "fichas": fichas, "seguimiento": seguimiento,
        "gasto_mes": {"por_tipo": gasto, "total_usd": str(gastado),
                      "tope_usd": str(limites.LIMITES.presupuesto_ia_mes_usd)}}


@router.get("/diario")
def diario(q: str = Query("", max_length=200),
           _: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    patron = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    if not patron:
        return {"items": []}
    with base.sesion() as s:
        filas = _filas(
            s, f"select {_COLUMNAS_RESUMEN} from agente.decisiones "
               "where razonamiento ilike :p order by id desc limit :n",
            p=f"%{patron}%", n=MAX_BUSQUEDA)
    return {"items": [_resumen(f) for f in filas]}


@router.get("/fichas/{ticker}")
def ficha(ticker: str, _: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    with base.sesion() as s:
        filas = _filas(
            s, "select ticker, contenido, certeza, version, creado, actualizado_en "
               "from agente.fichas where ticker = :t", t=ticker.upper())
    if not filas:
        raise HTTPException(404, "Not Found")
    return filas[0]


def _control(s: Session) -> dict[str, Any]:
    e = s.get_one(Estado, 1)
    mejora = _filas(
        s, "select id, estado, hipotesis, sombra_desde, sombra_hasta from agente.fichas_mejora "
           "where estado in ('propuesta', 'en_sombra') order by id desc limit 1")
    return {"parada": e.parada, "motivo": e.parada_motivo, "modo": e.modo,
            "actualizado_en": _json(e.actualizado_en), "actualizado_por": e.actualizado_por,
            "ia_activa": ajustes.ia_activa, "sombra": ajustes.sombra,
            "mejora": mejora[0] if mejora else None, "revertible": puerta.revertible(s)}


@router.get("/control")
def control(_: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    with base.sesion() as s:
        return _control(s)


class CambioParada(BaseModel):
    parada: bool
    motivo: str = Field(default="", max_length=500)


@router.post("/control/parada")
def cambiar_parada(cambio: CambioParada,
                   ident: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    motivo = cambio.motivo.strip()
    with base.con_actor(f"admin:{ident.uid}"), base.sesion() as s:
        e = s.get_one(Estado, 1)
        e.parada = cambio.parada
        e.parada_motivo = (motivo or None) if cambio.parada else None
        s.add(Evento(origen="admin", tipo="parada" if cambio.parada else "reanudada",
                     datos={"motivo": motivo, "uid": ident.uid}))
        s.flush()
        s.refresh(e)
        return _control(s)


@router.post("/control/filosofia/revertir")
def revertir_filosofia(ident: Identidad = Depends(admin_agente)) -> dict[str, Any]:
    """Vuelve a la filosofía anterior a la última adopción. 409 si no hay nada que deshacer."""
    with base.con_actor(f"admin:{ident.uid}"), base.sesion() as s:
        try:
            version = puerta.revertir(s)
        except ValueError:
            raise HTTPException(409, "No hay ningún cambio de filosofía que deshacer.") from None
        s.add(Evento(origen="admin", tipo="filosofia_revertida",
                     datos={"version": version, "uid": ident.uid}))
        s.flush()
        return _control(s)
