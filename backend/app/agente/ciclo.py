"""Ciclo del despertar con IA: el agente mira, pide herramientas y decide; el código aplica los
límites, el revisor juzga y, fuera de sombra, nacen las órdenes. Toda llamada pasa por `_llamar`."""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ValidationError, model_validator
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.agente import (
    avisos,
    base,
    despertares,
    herramientas,
    interruptor,
    libro,
    limites,
    memoria,
    prompts,
    revisor,
)
from app.agente.config import ajustes
from app.agente.interruptor import EnPausa, Interruptor
from app.agente.models import Decision as DecisionFila
from app.agente.models import Estado, Evento, Gasto, LlamadaModelo, PlaybookVersion, Seguimiento
from app.ledger.money import D
from app.mercado.calendario import dias_de_bolsa

logger = logging.getLogger(__name__)

PROVEEDOR = "deepseek"
_CERO = D("0")


class Operacion(BaseModel):
    ticker: str
    lado: Literal["compra", "venta"]
    importe: Decimal | None = None
    acciones: Decimal | None = None
    tesis: str = ""
    supuestos: str = ""
    salidas: str = ""
    ruptura: str = ""
    prevision_12m: str = ""
    proximo_evento: date | None = None

    @model_validator(mode="after")
    def _con_cantidad(self) -> Operacion:
        # Sin cantidad la orden no se podría ejecutar, ni compra ni venta.
        if self.importe is None and self.acciones is None:
            raise ValueError(f"{self.lado} de {self.ticker}: falta importe o acciones")
        return self


class Decision(BaseModel):
    tipo: Literal["nada", "operar", "revision"]
    operaciones: list[Operacion] = []
    razonamiento: str
    previsiones: list[dict] = []
    id: int | None = None

    @model_validator(mode="after")
    def _coherente(self) -> Decision:
        if self.tipo == "operar" and not self.operaciones:
            raise ValueError("tipo operar exige al menos una operación")
        if self.tipo == "nada" and self.operaciones:
            raise ValueError("tipo nada no lleva operaciones")
        return self


class Fallo(Exception):
    """El ciclo no puede seguir (JSON inválido, pasos agotados, proveedor caído)."""


class SinPresupuesto(Exception):
    """El tope mensual de IA no deja hacer otra llamada."""


def _llamar(llm: Any, system: str, user: str) -> tuple[str, Decimal | None]:  # noqa: ANN401
    """Única puerta al modelo: devuelve el texto y el coste real si el proveedor lo cuenta."""
    def acumulado() -> Decimal | None:
        try:
            return D(str(llm.usage["cost_usd"]))
        except (AttributeError, KeyError, TypeError, ValueError, ArithmeticError):
            return None

    antes = acumulado()
    texto = llm.chat(system, user)
    despues = acumulado()
    if antes is None or despues is None or despues < antes:
        return texto, None
    return texto, despues - antes


def _llamar_herramientas(llm: Any, mensajes: list[dict],  # noqa: ANN401
                         herr: list[dict] | None) -> tuple[dict, Decimal | None]:
    """Como `_llamar`, con llamadas nativas a herramientas: devuelve la respuesta entera."""
    def acumulado() -> Decimal | None:
        try:
            return D(str(llm.usage["cost_usd"]))
        except (AttributeError, KeyError, TypeError, ValueError, ArithmeticError):
            return None

    antes = acumulado()
    respuesta = llm.chat_con_herramientas(mensajes, herr)
    despues = acumulado()
    if antes is None or despues is None or despues < antes:
        return respuesta, None
    return respuesta, despues - antes


class Presupuesto:
    """Lleva el gasto del mes durante un ciclo y lo apunta en `agente.gasto`."""

    def __init__(self, s: Session, hoy: date, ejecucion_id: int | None, gastado: Decimal,
                 corte: Interruptor | None = None) -> None:
        self.s, self.hoy, self.ejecucion_id, self.gastado = s, hoy, ejecucion_id, gastado
        self.corte = corte or interruptor.deepseek
        # Lo comparten la decisión y sus llamadas: así el panel enseña cómo se llegó a cada una.
        self.ciclo = uuid.uuid4()
        self._pasos: dict[str, int] = {}
        # Hasta dónde se ha registrado de la lista de mensajes que se está usando ahora.
        self._lista: list[dict] | None = None
        self._visto = 0

    def llamar(self, llm: Any, modelo: str, system: str, user: str,  # noqa: ANN401
               etapa: str = "revisor") -> str:
        enviado = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        return self._con_presupuesto(
            llm, modelo, lambda: _llamar(llm, system, user), etapa, enviado,
            lambda texto: (texto, None, []))

    def _nuevos(self, mensajes: list[dict]) -> list[dict]:
        """Lo que el modelo aún no había visto de esta lista. Una lista nueva empieza desde cero:
        la corrección reinicia la conversación y no hereda el contador anterior."""
        if mensajes is not self._lista:
            self._lista, self._visto = mensajes, 0
        nuevos = [m for m in mensajes[self._visto:] if m.get("role") != "assistant"]
        self._visto = len(mensajes)
        return nuevos

    def llamar_herramientas(self, llm: Any, modelo: str, mensajes: list[dict],  # noqa: ANN401
                            herr: list[dict] | None, etapa: str = "agente") -> dict:
        # De cada vuelta solo se guarda lo nuevo; sus propias respuestas ya quedaron en su fila.
        return self._con_presupuesto(
            llm, modelo, lambda: _llamar_herramientas(llm, mensajes, herr), etapa,
            self._nuevos(mensajes),
            lambda r: (r["content"], (r.get("mensaje") or {}).get("reasoning_content"),
                       r["tool_calls"]))

    def llamar_texto(self, llm: Any, modelo: str, mensajes: list[dict],  # noqa: ANN401
                     etapa: str) -> str:
        """Respuesta de texto por la misma vía que el agente: así se guarda su razonamiento."""
        return self.llamar_herramientas(llm, modelo, mensajes, None, etapa)["content"]

    def _anotar(self, etapa: str, modelo: str, enviado: list[dict], salida: tuple | None,
                coste: Decimal | None, inicio: float, error: str | None) -> None:
        """Deja constancia de la llamada en su propia conexión: sobrevive aunque el ciclo falle y
        deshaga lo suyo. Un fallo al anotar nunca tumba el ciclo."""
        self._pasos[etapa] = paso = self._pasos.get(etapa, 0) + 1
        respuesta, razonamiento, pedidas = salida or (None, None, [])
        try:
            with base.sesion() as t:
                t.add(LlamadaModelo(
                    ejecucion_id=self.ejecucion_id, etapa=etapa, paso=paso, modelo=modelo,
                    enviado=enviado, respuesta=respuesta, razonamiento=razonamiento,
                    herramientas_pedidas=pedidas, coste_usd=coste,
                    latencia_ms=int((time.monotonic() - inicio) * 1000),
                    ok=error is None, error=error, ciclo=self.ciclo))
        except Exception:
            logger.exception("No se pudo anotar la llamada al modelo")

    def _con_presupuesto(self, llm: Any, modelo: str, invocar: Any,  # noqa: ANN401
                         etapa: str, enviado: list[dict], extraer: Any) -> Any:  # noqa: ANN401
        estimado = D(str(ajustes.coste_estimado_llamada_usd))
        if not limites.puede_gastar_ia(self.gastado, estimado):
            raise SinPresupuesto
        self.corte.antes()
        inicio = time.monotonic()
        try:
            resultado, coste = invocar()
        except Exception as exc:
            logger.exception("Llamada al modelo fallida")
            self._anotar(etapa, modelo, enviado, None, None, inicio,
                         f"{type(exc).__name__}: {exc}"[:500])
            if self.corte.fallo():
                datos = {"motivo": f"{type(exc).__name__}"[:200],
                         "pausa_min": ajustes.interruptor_pausa_min}
                _evento(self.s, "proveedor_pausado", self.ejecucion_id, datos)
                avisos.avisar(self.s, "agente_proveedor_pausado", datos, self.ejecucion_id)
            raise Fallo(f"proveedor: {type(exc).__name__}: {exc}") from exc
        self.corte.exito()
        coste = estimado if coste is None else coste
        self._anotar(etapa, modelo, enviado, extraer(resultado), coste, inicio, None)
        self.s.add(Gasto(fecha_ny=self.hoy, tipo="ia", proveedor=PROVEEDOR, modelo=modelo,
                         coste_usd=coste, ejecucion_id=self.ejecucion_id))
        self.s.flush()
        self.gastado += coste
        return resultado


class Medido:
    """Proveedor con `chat` que pasa por el presupuesto: así el revisor y el nacimiento
    cuentan igual que el agente."""

    def __init__(self, g: Presupuesto, llm: Any, modelo: str,  # noqa: ANN401
                 etapa: str = "revisor") -> None:
        self.g, self.llm, self.modelo, self.etapa = g, llm, modelo, etapa

    def chat(self, system: str, user: str) -> str:
        mensajes = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        return self.g.llamar_texto(self.llm, self.modelo, mensajes, self.etapa)


def _evento(s: Session, tipo: str, ejecucion_id: int | None,
            datos: dict[str, Any] | None = None) -> None:
    s.add(Evento(origen="ciclo", tipo=tipo, datos=datos or {}, ejecucion_id=ejecucion_id))
    s.flush()


def _playbook_vigente(s: Session) -> PlaybookVersion | None:
    return s.execute(select(PlaybookVersion).where(PlaybookVersion.estado == "vigente")
                     ).scalar_one_or_none()


def filosofia_vigente(s: Session) -> str | None:
    s.flush()
    p = _playbook_vigente(s)
    return None if p is None else p.contenido


def nacer(s: Session, llm: Any, motivo: str = "nacimiento") -> str:  # noqa: ANN401
    """Pide una filosofía desde cero y la guarda como la siguiente versión vigente; la anterior,
    si la hay, queda retirada. Sin JSON válido no se cambia nada."""
    texto = llm.chat(prompts.SYSTEM_FILOSOFIA, prompts.usuario_nacer(herramientas.describir()))
    try:
        filosofia = str(_json_de(texto)["philosophy"]).strip()  # type: ignore[index]
    except (ValueError, KeyError, TypeError) as exc:
        raise Fallo("filosofía inicial no válida") from exc
    if not filosofia:
        raise Fallo("filosofía inicial vacía")
    previa = _playbook_vigente(s)
    if previa is not None:
        # Solo puede haber una vigente: la retirada va antes de insertar la nueva.
        previa.estado = "retirada"
        s.flush()
    ultima = s.execute(select(func.max(PlaybookVersion.version))).scalar() or 0
    s.add(PlaybookVersion(version=ultima + 1, contenido=filosofia, motivo=motivo,
                          estado="vigente", adoptada_en=func.now()))
    s.flush()
    return filosofia


def _gastado_del_mes(s: Session, hoy: date) -> Decimal:
    s.flush()
    v = s.execute(text(
        "select coalesce(sum(coste_usd), 0) from agente.gasto where tipo = 'ia' "
        "and date_trunc('month', fecha_ny) = date_trunc('month', cast(:h as date))"),
        {"h": hoy}).scalar_one()
    return D(str(v))


def _alertas_de_hoy(s: Session, hoy: date) -> list[dict]:
    filas = s.execute(text(
        "select e.tipo, e.ticker, e.datos from agente.eventos e "
        "join agente.ejecuciones x on x.id = e.ejecucion_id "
        "where e.origen = 'vigia' and x.fecha_ny = :h and e.tipo <> 'ciclo_pendiente' "
        "order by e.id"), {"h": hoy}).all()
    return [{"tipo": f.tipo, "ticker": f.ticker, "datos": f.datos} for f in filas]


def _seguimiento(s: Session) -> list[dict]:
    filas = s.execute(select(Seguimiento).where(Seguimiento.hasta.is_(None))
                      .order_by(Seguimiento.ticker)).scalars()
    return [{"ticker": f.ticker, "motivo": f.motivo, "niveles": f.niveles} for f in filas]


def _json_de(texto: str) -> object:
    """El primer objeto JSON de la respuesta, aunque venga envuelto en texto o en un bloque de
    código. El modelo a veces escribe varias peticiones con texto entre medias: se toma la primera,
    que es la que se ejecuta en este turno."""
    t = texto.strip()
    try:
        return json.loads(t)
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    for i, c in enumerate(t):
        if c != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(t, i)
        except ValueError:
            continue
        return obj
    raise ValueError("la respuesta no es JSON")


def _usuario(base: str, rastro: list[dict], nota: str | None) -> str:
    partes = [base]
    if rastro:
        partes.append("## Tool results so far")
        partes += [f"[{i}] {r['tool']} {json.dumps(r['args'], ensure_ascii=False)} -> "
                   f"{json.dumps(r['resultado'], ensure_ascii=False, default=str)}"
                   for i, r in enumerate(rastro, 1)]
    if nota:
        partes.append(f"## Note\n{nota}")
    return "\n".join(partes)


_AVISO_ULTIMO = ("Last turn: no more tools are available. Give your final decision now, in the "
                 "decision format.")


def _decision_de(texto: str) -> Decision:
    """La decisión final: {"decision": {...}} validada. Cualquier otra cosa es ValueError."""
    obj = _json_de(texto)
    if not isinstance(obj, dict) or "decision" not in obj:
        raise ValueError('la respuesta final debe ser {"decision": {...}}')
    try:
        return Decision.model_validate(obj["decision"])
    except ValidationError as exc:
        raise ValueError(f"decisión no válida: {exc.errors(include_url=False)}") from exc


def _bucle(s: Session, g: Presupuesto, llm: Any, ctx: herramientas.Contexto,  # noqa: ANN401
           base: str, rastro: list[dict], nota: str | None = None) -> Decision:
    """Hasta `max_pasos` turnos con llamadas NATIVAS a herramientas: el modelo pide herramientas
    por la API y el resultado vuelve como mensaje de herramienta. Su respuesta de texto solo se
    acepta como decisión final. Respuesta vacía: se repite la misma llamada (hasta dos veces).
    Decisión inválida: un aviso de corrección. En el último turno no hay herramientas."""
    herr = herramientas.esquemas_nativos()
    mensajes: list[dict] = [
        {"role": "system", "content": prompts.SYSTEM_AGENTE},
        {"role": "user", "content": _usuario(base, [], nota)},
    ]
    avisos, vacias = 0, 0
    for paso in range(ajustes.max_pasos):
        ultimo = paso == ajustes.max_pasos - 1
        if ultimo:
            mensajes.append({"role": "user", "content": _AVISO_ULTIMO})
        r = g.llamar_herramientas(llm, ajustes.modelo, mensajes, None if ultimo else herr)
        llamadas = [] if ultimo else r["tool_calls"]
        if llamadas:
            mensajes.append(r["mensaje"])
            for c in llamadas:
                nombre = c["function"]["name"]
                try:
                    args = json.loads(c["function"].get("arguments") or "{}")
                    if not isinstance(args, dict):
                        raise ValueError("los argumentos deben ser un objeto")
                except ValueError as exc:
                    args, resultado = {}, {"error": f"arguments no válidos: {exc}"}
                else:
                    resultado = herramientas.ejecutar(s, nombre, args, ctx)
                rastro.append({"tool": nombre, "args": args, "resultado": resultado})
                mensajes.append({"role": "tool", "tool_call_id": c["id"],
                                 "content": json.dumps(resultado, ensure_ascii=False, default=str)})
            continue
        texto = r["content"]
        if not texto.strip():
            vacias += 1
            if vacias > 2:
                raise Fallo("el modelo devolvió respuestas vacías tres veces seguidas")
            continue
        try:
            return _decision_de(texto)
        except ValueError as exc:
            if avisos:
                raise Fallo(f"respuesta inválida dos veces: {exc}; empieza así: {texto[:200]!r}"
                            ) from exc
            avisos = 1
            mensajes.append({"role": "assistant", "content": texto})
            mensajes.append({"role": "user", "content": (
                f"Your last reply was invalid ({exc}). Reply with exactly one JSON object: "
                '{"decision": {...}}. Use the tools if you still need data.')})
    pedidas = ", ".join(x["tool"] for x in rastro) or "ninguna"
    raise Fallo(f"sin decisión tras agotar los pasos; herramientas pedidas: {pedidas}")


def _ultimo_cierre(s: Session, ticker: str, hoy: date) -> tuple[Decimal | None, date | None]:
    fila = s.execute(text("select fecha, cierre from agente.precios "
                          "where ticker = :t and fecha <= :d order by fecha desc limit 1"),
                     {"t": ticker, "d": hoy}).first()
    return (None, None) if fila is None else (D(str(fila.cierre)), fila.fecha)


def _tiene_ficha(s: Session, ticker: str) -> bool:
    s.flush()  # una ficha escrita en este mismo ciclo ya cuenta
    return s.execute(text("select 1 from agente.fichas where ticker = :t"),
                     {"t": ticker}).first() is not None


def _violaciones(s: Session, d: Decision, hoy: date) -> list[dict]:
    cartera = libro.cartera(s, hoy)
    parada = bool(s.execute(select(Estado.parada).where(Estado.id == 1)).scalar())
    out: list[dict] = []
    for op in d.operaciones:
        ticker = op.ticker.upper()
        precio, fecha_cierre = _ultimo_cierre(s, ticker, hoy)
        if precio is None or precio <= _CERO:
            vs = [limites.Violacion("sin_precio", f"No hay cierre guardado de {ticker}.")]
        elif op.lado == "compra":
            importe = op.importe if op.importe is not None else op.acciones * precio  # type: ignore[operator]
            vs = (limites.comprobar_cierre_reciente(ticker, fecha_cierre, hoy)
                  + limites.comprobar_ficha(ticker, _tiene_ficha(s, ticker))
                  + limites.comprobar_compra(limites.PropuestaCompra(
                      ticker, importe, precio, op.salidas, op.ruptura, op.proximo_evento),
                      cartera, hoy, parada))
        else:
            acciones = (op.acciones if op.acciones is not None
                        else limites.acciones_por_importe(op.importe, precio))  # type: ignore[arg-type]
            vs = limites.comprobar_venta(limites.PropuestaVenta(ticker, acciones), cartera, parada)
        out += [{"ticker": ticker, "lado": op.lado, "codigo": v.codigo, "detalle": v.detalle}
                for v in vs]
    return out


def _proxima_sesion(hoy: date) -> date:
    return dias_de_bolsa(hoy + timedelta(days=1), hoy + timedelta(days=10))[0]


def _crear_ordenes(s: Session, d: Decision, decision_id: int, hoy: date) -> None:
    objetivo = _proxima_sesion(hoy)
    for op in d.operaciones:
        libro.crear_orden(s, decision_id, op.ticker.upper(), op.lado, objetivo,
                          importe=op.importe,
                          acciones=op.acciones if op.importe is None else None)


def presupuesto(s: Session, hoy: date, ejecucion_id: int | None,
                corte: Interruptor | None = None) -> Presupuesto:
    """Presupuesto con lo gastado este mes, para quien llame al modelo fuera del ciclo."""
    return Presupuesto(s, hoy, ejecucion_id, _gastado_del_mes(s, hoy), corte)


def despertar(s: Session, hoy: date, *, llm: Any, revisor_llm: Any,  # noqa: ANN401
              ctx: herramientas.Contexto, sombra: bool = True,
              gastado_mes: Decimal | None = None,
              corte: Interruptor | None = None,
              candidata: PlaybookVersion | None = None) -> Decision | None:
    """Un ciclo completo; None si no hubo decisión (presupuesto, proveedor en pausa o fallo).
    Con `candidata`, decide con esa filosofía en prueba: siempre en sombra y sin escribir."""
    if candidata is not None and not ctx.solo_lectura:
        raise ValueError("una candidata solo decide con herramientas de solo lectura")
    if gastado_mes is None:
        gastado_mes = _gastado_del_mes(s, hoy)
    g = Presupuesto(s, hoy, ctx.ejecucion_id, D(str(gastado_mes)), corte)
    try:
        return _ciclo(s, hoy, g, llm, revisor_llm, ctx, sombra or candidata is not None,
                      candidata)
    except SinPresupuesto:
        datos = {"gastado_usd": str(g.gastado)}
        _evento(s, "presupuesto_agotado", ctx.ejecucion_id, datos)
        avisos.avisar(s, "agente_presupuesto_agotado", datos, ctx.ejecucion_id)
    except EnPausa as exc:
        # Ya se avisó al abrirse el interruptor: aquí solo queda constancia.
        _evento(s, "proveedor_en_pausa", ctx.ejecucion_id,
                {"segundos_restantes": round(exc.segundos_restantes)})
    except Fallo as exc:
        datos = {"motivo": str(exc)[:500]}
        _evento(s, "ciclo_fallido", ctx.ejecucion_id, datos)
        avisos.avisar(s, "agente_ciclo_fallido", {"motivo": str(exc)[:200]}, ctx.ejecucion_id)
    return None


def _ciclo(s: Session, hoy: date, g: Presupuesto, llm: Any, revisor_llm: Any,  # noqa: ANN401
           ctx: herramientas.Contexto, sombra: bool,
           candidata: PlaybookVersion | None = None) -> Decision:
    playbook: PlaybookVersion | None
    if candidata is not None:
        filosofia, playbook = candidata.contenido, candidata
    else:
        filosofia = filosofia_vigente(s) or nacer(s, Medido(g, llm, ajustes.modelo, "nacimiento"))
        playbook = _playbook_vigente(s)

    cartera = herramientas.ejecutar(s, "portfolio", {}, ctx)
    base = prompts.usuario_ciclo(hoy, filosofia, cartera, _alertas_de_hoy(s, hoy),
                                 _seguimiento(s), herramientas.describir(),
                                 memoria.lecciones_aprobadas(s), memoria.decisiones_recientes(s),
                                 despertares.razones_de(s, ctx.ejecucion_id),
                                 despertares.pendientes(s), despertares.topes(s, hoy))
    rastro: list[dict] = []
    d = _bucle(s, g, llm, ctx, base, rastro)
    viol = _violaciones(s, d, hoy)
    veredicto, motivo = _juzgar(g, d, viol, filosofia, rastro, revisor_llm)

    if veredicto == "corregir":
        previa = json.dumps(d.model_dump(mode="json"), ensure_ascii=False)
        nota = (f"A correction is needed. Reason: {motivo}\n"
                f"Your previous decision: {previa}\nGive a corrected final decision.")
        try:
            d = _bucle(s, g, llm, ctx, base, rastro, nota)
            viol = _violaciones(s, d, hoy)
            veredicto, motivo = _juzgar(g, d, viol, filosofia, rastro, revisor_llm)
        except Fallo as exc:
            veredicto, motivo = "rechazada", f"corrección fallida: {exc}"
        if veredicto == "corregir":
            veredicto = "rechazada"

    propuesta = d.model_dump(mode="json")
    propuesta["violaciones"] = viol
    propuesta["herramientas"] = [{"nombre": r["tool"], "args": r["args"]} for r in rastro]
    fila = DecisionFila(
        ejecucion_id=ctx.ejecucion_id, fecha_ny=hoy, tipo=d.tipo, sombra=sombra,
        playbook_version_id=None if playbook is None else playbook.id, propuesta=propuesta,
        razonamiento=d.razonamiento, previsiones=d.previsiones, revisor_veredicto=veredicto,
        revisor_motivo=motivo, modelo=ajustes.modelo, ciclo=g.ciclo)
    s.add(fila)
    s.flush()
    d.id = fila.id
    _evento(s, "decision", ctx.ejecucion_id, {"decision_id": fila.id, "veredicto": veredicto})
    if not sombra and candidata is None and veredicto == "aprobada" and d.tipo == "operar":
        _crear_ordenes(s, d, fila.id, hoy)
    return d


def _juzgar(g: Presupuesto, d: Decision, viol: list[dict], filosofia: str,
            rastro: list[dict], revisor_llm: Any) -> tuple[str, str]:  # noqa: ANN401
    """Límites primero (sin gastar en revisor), luego el revisor salvo que no se opere."""
    if viol:
        # Una vuelta de corrección con el motivo exacto; si sigue igual, se rechaza con ese motivo.
        return "corregir", "Límites incumplidos: " + "; ".join(
            f"{v['codigo']}: {v['detalle']}" for v in viol)
    if d.tipo == "nada":
        return "aprobada", "Sin operaciones: no requiere revisión"
    datos = [{"tool": r["tool"], "args": r["args"], "resultado": r["resultado"]} for r in rastro]
    medido = Medido(g, revisor_llm, ajustes.modelo_revisor)
    return revisor.revisar({**d.model_dump(mode="json"), "violaciones": viol}, filosofia, datos,
                           medido)
