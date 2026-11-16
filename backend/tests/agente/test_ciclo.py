"""Ciclo del agente con proveedor falso y herramientas falsas: sin red ni llamadas de pago."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agente import ciclo, herramientas, libro, tareas
from app.agente.config import ajustes
from app.agente.datos import Barra
from app.agente.interruptor import EstadoInterruptor, Interruptor
from app.agente.models import Ejecucion, Leccion, PlaybookVersion, Seguimiento
from app.agente.reloj import Tarea
from app.config import settings

HOY = date(2026, 11, 17)
SIGUIENTE = date(2026, 11, 18)
NY = ZoneInfo("America/New_York")
FILOSOFIA = json.dumps({"philosophy": "# Filosofía v1\nElijo poco y con calma."})
OPERAR = {"decision": {
    "tipo": "operar", "razonamiento": "porque sí",
    "operaciones": [{"ticker": "AAA", "lado": "compra", "importe": "1000", "tesis": "t",
                     "supuestos": "s", "salidas": "si baja", "ruptura": "si miente",
                     "prevision_12m": "sube", "proximo_evento": None}]}}
NADA = {"decision": {"tipo": "nada", "razonamiento": "sin novedades"}}
APRUEBA = {"verdict": "approve", "reason": "coherente"}


class Falso:
    """Proveedor con respuestas escritas en orden y coste acumulado creciente."""

    def __init__(self, respuestas: list, coste: float = 0.01) -> None:
        self.respuestas = [r if isinstance(r, str) else json.dumps(r) for r in respuestas]
        self.coste = coste
        self.llamadas: list[tuple[str, str]] = []
        self._acumulado = 0.0

    @property
    def usage(self) -> dict:
        return {"cost_usd": self._acumulado}

    def chat(self, system: str, user: str, **_: object) -> str:
        self.llamadas.append((system, user))
        self._acumulado += self.coste
        return self.respuestas.pop(0)

    def chat_con_herramientas(self, mensajes: list, herramientas: list | None = None,
                              **_: object) -> dict:
        """Como la API: una petición de herramienta llega como `tool_calls`; el resto como texto."""
        self.llamadas.append(("", json.dumps(mensajes, ensure_ascii=False)))
        self._acumulado += self.coste
        texto = self.respuestas.pop(0)
        try:
            obj = json.loads(texto)
        except ValueError:
            obj = None
        if isinstance(obj, dict) and isinstance(obj.get("tool"), str):
            llamada = {"id": f"call_{len(self.llamadas)}", "type": "function",
                       "function": {"name": obj["tool"],
                                    "arguments": json.dumps(obj.get("args") or {})}}
            msg = {"role": "assistant", "content": None, "tool_calls": [llamada]}
            return {"content": "", "tool_calls": [llamada], "mensaje": msg}
        msg = {"role": "assistant", "content": texto}
        return {"content": texto, "tool_calls": [], "mensaje": msg}


@pytest.fixture(autouse=True)
def _entorno(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "commission_per_share", 0.005)
    monkeypatch.setattr(settings, "commission_min", 1)
    monkeypatch.setattr(settings, "commission_max_pct", 1)
    resultados = {"portfolio": {"caja": "5000", "posiciones": []}, "price": {"AAA": 100}}

    def ejecutar(s, nombre, args, ctx):  # noqa: ANN001, ARG001
        return resultados.get(nombre, {"error": "desconocida"})
    monkeypatch.setattr(herramientas, "describir", lambda: "- price(ticker): last price")
    monkeypatch.setattr(herramientas, "ejecutar", ejecutar)


def _preparar(s: Session, precio: str = "100") -> herramientas.Contexto:
    libro.abrir_libro(s, HOY)
    libro.guardar_precios(s, "AAA", [(HOY, None, None, None, Decimal(precio), 1)])
    ej = tareas.reclamar(s, Tarea.DESPERTAR, HOY)
    assert ej is not None
    return herramientas.Contexto(hoy=HOY, ejecucion_id=ej.id)


def _una(s: Session, sql: str):
    s.flush()
    return s.execute(text(sql)).one()


def _eventos(s: Session) -> list[str]:
    s.flush()
    return [r.tipo for r in s.execute(text("select tipo from agente.eventos order by id"))]


def _despertar(s, ctx, agente, revisor, **kw):  # noqa: ANN001, ANN003, ANN202
    return ciclo.despertar(s, HOY, llm=agente, revisor_llm=revisor, ctx=ctx, **kw)


def test_nacer_guarda_la_filosofia_v1(sesion_agente: Session) -> None:
    s = sesion_agente
    assert ciclo.filosofia_vigente(s) is None
    texto = ciclo.nacer(s, Falso([FILOSOFIA]))
    assert texto.startswith("# Filosofía v1")
    fila = _una(s, "select version, estado, motivo, contenido from agente.playbook_versiones")
    assert (fila.version, fila.estado, fila.motivo) == (1, "vigente", "nacimiento")
    assert ciclo.filosofia_vigente(s) == texto


def test_nacer_recibe_los_limites_reales_y_las_herramientas(sesion_agente: Session) -> None:
    falso = Falso([FILOSOFIA])
    ciclo.nacer(sesion_agente, falso)
    usuario = falso.llamadas[0][1]
    assert "At most 5 positions" in usuario
    assert "above 30% of the portfolio (15% in defensive mode)" in usuario
    assert "- price(ticker): last price" in usuario


def test_renacer_retira_la_vigente_y_crea_la_siguiente(sesion_agente: Session) -> None:
    s = sesion_agente
    ciclo.nacer(s, Falso([FILOSOFIA]))
    nueva = json.dumps({"philosophy": "# Filosofía nueva"})
    assert ciclo.nacer(s, Falso([nueva]), motivo="renacimiento") == "# Filosofía nueva"
    s.flush()
    filas = s.execute(text("select version, estado, motivo from agente.playbook_versiones "
                           "order by version")).all()
    assert [tuple(f) for f in filas] == [(1, "retirada", "nacimiento"),
                                         (2, "vigente", "renacimiento")]
    assert ciclo.filosofia_vigente(s) == "# Filosofía nueva"


def test_renacer_con_respuesta_invalida_no_toca_la_vigente(sesion_agente: Session) -> None:
    s = sesion_agente
    ciclo.nacer(s, Falso([FILOSOFIA]))
    with pytest.raises(ciclo.Fallo):
        ciclo.nacer(s, Falso(["no es json"]), motivo="renacimiento")
    assert ciclo.filosofia_vigente(s).startswith("# Filosofía v1")


def test_herramienta_y_luego_nada_se_aprueba_sin_revisor(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    s.add(Seguimiento(ticker="AAA", motivo="vigilo"))
    agente = Falso([FILOSOFIA, {"tool": "price", "args": {"ticker": "AAA"}}, NADA])
    revisor = Falso([])
    d = _despertar(s, ctx, agente, revisor)
    assert d is not None and d.tipo == "nada" and d.id is not None
    assert revisor.llamadas == []
    fila = _una(s, "select tipo, sombra, revisor_veredicto, propuesta from agente.decisiones")
    assert (fila.tipo, fila.sombra, fila.revisor_veredicto) == ("nada", True, "aprobada")
    assert fila.propuesta["herramientas"] == [{"nombre": "price", "args": {"ticker": "AAA"}}]
    # El segundo turno ya lleva el resultado de la herramienta.
    assert r'\"AAA\": 100' in agente.llamadas[2][1] and '"role": "tool"' in agente.llamadas[2][1]
    assert "decision" in _eventos(s)


def test_operar_aprobado_en_sombra_no_crea_ordenes(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    d = _despertar(s, ctx, Falso([FILOSOFIA, OPERAR]), Falso([APRUEBA]), sombra=True)
    assert d is not None
    fila = _una(s, "select revisor_veredicto, sombra from agente.decisiones")
    assert (fila.revisor_veredicto, fila.sombra) == ("aprobada", True)
    assert _una(s, "select count(*) as n from agente.ordenes").n == 0


def test_operar_aprobado_sin_sombra_crea_la_orden_del_siguiente_dia(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    d = _despertar(s, ctx, Falso([FILOSOFIA, OPERAR]), Falso([APRUEBA]), sombra=False)
    assert d is not None
    o = _una(s, "select ticker, lado, importe_objetivo, fecha_objetivo, decision_id, estado "
                "from agente.ordenes")
    assert (o.ticker, o.lado, o.importe_objetivo, o.fecha_objetivo, o.decision_id, o.estado) == (
        "AAA", "compra", Decimal("1000"), SIGUIENTE, d.id, "pendiente")


def test_violacion_de_limites_rechaza_sin_llamar_al_revisor(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    grande = json.loads(json.dumps(OPERAR))
    grande["decision"]["operaciones"][0]["importe"] = "4000"  # pasa del 30 % de peso
    revisor = Falso([])
    d = _despertar(s, ctx, Falso([FILOSOFIA, grande]), revisor, sombra=False)
    assert d is not None
    assert revisor.llamadas == []
    fila = _una(s, "select revisor_veredicto, propuesta from agente.decisiones")
    assert fila.revisor_veredicto == "rechazada"
    assert "peso_maximo" in {v["codigo"] for v in fila.propuesta["violaciones"]}
    assert _una(s, "select count(*) as n from agente.ordenes").n == 0


def test_revisor_pide_corregir_y_la_segunda_version_se_aprueba(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    chica = json.loads(json.dumps(OPERAR))
    chica["decision"]["operaciones"][0]["importe"] = "500"
    agente = Falso([FILOSOFIA, OPERAR, chica])
    revisor = Falso([{"verdict": "revise", "reason": "menos tamaño"}, APRUEBA])
    d = _despertar(s, ctx, agente, revisor, sombra=False)
    assert d is not None and d.operaciones[0].importe == Decimal("500")
    assert "menos tamaño" in agente.llamadas[2][1]
    fila = _una(s, "select revisor_veredicto from agente.decisiones")
    assert fila.revisor_veredicto == "aprobada"
    assert _una(s, "select importe_objetivo from agente.ordenes").importe_objetivo == Decimal("500")


def test_json_invalido_dos_veces_es_ciclo_fallido(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    agente = Falso([FILOSOFIA, "esto no es json", "{tampoco"])
    assert _despertar(s, ctx, agente, Falso([])) is None
    assert "ciclo_fallido" in _eventos(s)
    assert _una(s, "select count(*) as n from agente.decisiones").n == 0
    assert "invalid" in agente.llamadas[2][1]


def test_presupuesto_agotado_no_llama_al_modelo(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    agente = Falso([])
    assert _despertar(s, ctx, agente, Falso([]), gastado_mes=Decimal("9.995")) is None
    assert agente.llamadas == []
    assert _eventos(s) == ["presupuesto_agotado", "aviso"]


def test_el_gasto_queda_apuntado(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    _despertar(s, ctx, Falso([FILOSOFIA, OPERAR], coste=0.02), Falso([APRUEBA], coste=0.05))
    filas = s.execute(text(
        "select tipo, proveedor, modelo, coste_usd from agente.gasto order by id")).all()
    assert [(f.tipo, f.proveedor, f.modelo, f.coste_usd) for f in filas] == [
        ("ia", "deepseek", ajustes.modelo, Decimal("0.02")),
        ("ia", "deepseek", ajustes.modelo, Decimal("0.02")),
        ("ia", "deepseek", ajustes.modelo_revisor, Decimal("0.05"))]


def test_ia_apagada_no_llama_a_get_llm(sesion_agente: Session,
                                       monkeypatch: pytest.MonkeyPatch) -> None:
    s = sesion_agente
    import app.llm

    def prohibido(*a: object, **k: object) -> None:
        raise AssertionError("get_llm no debía llamarse")
    monkeypatch.setattr(app.llm, "get_llm", prohibido)
    monkeypatch.setattr(ajustes, "ia_activa", False)
    libro.abrir_libro(s, date(2026, 11, 16))
    # Una posición con nivel cruzado dispara el aviso de ciclo pendiente.
    from app.agente.models import Decision as Fila
    from app.agente.models import Ejecutada
    f = Fila(fecha_ny=date(2026, 11, 16), tipo="operar", propuesta={}, razonamiento="r",
             modelo="m")
    s.add(f)
    s.flush()
    o = libro.crear_orden(s, f.id, "AAA", "compra", date(2026, 11, 16), acciones=Decimal("10"))
    s.add(Ejecutada(orden_id=o.id, ejecutada_en=datetime(2026, 11, 16, 9, 35, tzinfo=NY),
                    acciones=Decimal("10"), precio=Decimal("100"), comision=Decimal("1")))
    o.estado = "ejecutada"
    s.add(Seguimiento(ticker="AAA", motivo="m", niveles=[
        {"precio": "105", "direccion": "arriba", "motivo": "ruptura"}]))
    ej = tareas.reclamar(s, Tarea.DESPERTAR, HOY)
    assert isinstance(ej, Ejecucion)
    barras = {"AAA": [
        Barra(date(2026, 11, 16), None, None, None, Decimal("100"), 1, Decimal("0"), Decimal("1")),
        Barra(HOY, None, None, None, Decimal("106"), 1, Decimal("0"), Decimal("1"))]}
    tareas.hacer_despertar(s, ej, HOY, lambda tickers, desde: barras)
    assert _eventos(s)[-2:] == ["ciclo_pendiente", "ia_apagada"]


def _candidata(s: Session) -> PlaybookVersion:
    ciclo.nacer(s, Falso([FILOSOFIA]))
    cand = PlaybookVersion(version=2, contenido="# Candidata\nEspero más.", motivo="m",
                           estado="candidata")
    s.add(cand)
    s.flush()
    return cand


def test_la_candidata_decide_con_su_filosofia_y_nunca_crea_ordenes(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = replace(_preparar(s), solo_lectura=True)
    cand = _candidata(s)
    agente = Falso([OPERAR])
    d = _despertar(s, ctx, agente, Falso([APRUEBA]), sombra=False, candidata=cand)
    assert d is not None
    assert "# Candidata" in agente.llamadas[0][1]
    fila = _una(s, "select playbook_version_id, sombra from agente.decisiones")
    assert (fila.playbook_version_id, fila.sombra) == (cand.id, True)
    assert _una(s, "select count(*) as n from agente.ordenes").n == 0


def test_la_candidata_exige_solo_lectura(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    with pytest.raises(ValueError):
        _despertar(s, ctx, Falso([]), Falso([]), candidata=_candidata(s))


def test_el_ciclo_recibe_lecciones_y_decisiones_recientes(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    ciclo.nacer(s, Falso([FILOSOFIA]))
    _despertar(s, ctx, Falso([NADA]), Falso([]))
    s.add(Leccion(texto="No compro antes de resultados.", decision_ids=[1], estado="aprobada"))
    agente = Falso([NADA])
    _despertar(s, ctx, agente, Falso([]))
    usuario = agente.llamadas[0][1]
    assert "No compro antes de resultados." in usuario
    assert "sin novedades" in usuario.split("## Your recent decisions")[1]


class Caido:
    """Proveedor que nunca responde; cuenta cuántas veces se le llamó."""

    usage = {"cost_usd": 0.0}

    def __init__(self) -> None:
        self.llamadas = 0

    def chat(self, system: str, user: str, **_: object) -> str:
        self.llamadas += 1
        raise TimeoutError("sin respuesta")


def _avisos(s: Session) -> list[str]:
    s.flush()
    return list(s.execute(text(
        "select datos->>'tipo' from agente.eventos where tipo = 'aviso' order by id")).scalars())


def test_tres_fallos_abren_el_interruptor_y_dejan_de_llamar(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = _preparar(s)
    corte = Interruptor(fallos=3, pausa_s=60, reloj=lambda: 0.0)
    caido = Caido()
    for _ in range(3):
        assert _despertar(s, ctx, caido, caido, corte=corte) is None
    assert corte.estado is EstadoInterruptor.ABIERTO
    # Abierto: el cuarto ciclo no llega al proveedor ni gasta.
    assert _despertar(s, ctx, caido, caido, corte=corte) is None
    assert caido.llamadas == 3
    tipos = [t for t in _eventos(s) if t != "aviso"]
    assert tipos == ["ciclo_fallido", "ciclo_fallido", "proveedor_pausado", "ciclo_fallido",
                     "proveedor_en_pausa"]
    assert _avisos(s) == ["agente_ciclo_fallido", "agente_ciclo_fallido",
                          "agente_proveedor_pausado", "agente_ciclo_fallido"]
    assert _una(s, "select count(*) as n from agente.gasto").n == 0


def test_json_de_saca_el_objeto_aunque_venga_envuelto() -> None:
    assert ciclo._json_de('```json\n{"decision": {"tipo": "nada"}}\n```') == {
        "decision": {"tipo": "nada"}}
    assert ciclo._json_de('Aquí va: {"a": 1} fin') == {"a": 1}
    with pytest.raises(ValueError, match="no es JSON"):
        ciclo._json_de("sin llaves por ningún lado")


def test_respuesta_vacia_se_repite_sin_gastar_el_aviso(sesion_agente) -> None:
    hoy = date(2026, 11, 16)
    llm = Falso(["", "", '{"decision": {"tipo": "nada", "razonamiento": "espero"}}'])
    g = ciclo.Presupuesto(sesion_agente, hoy, None, Decimal("0"))
    d = ciclo._bucle(sesion_agente, g, llm, herramientas.Contexto(hoy=hoy), "base", [])
    assert d.tipo == "nada" and len(llm.llamadas) == 3


def test_tres_respuestas_vacias_fallan(sesion_agente) -> None:
    hoy = date(2026, 11, 16)
    llm = Falso(["", "", "", '{"decision": {"tipo": "nada", "razonamiento": "x"}}'])
    g = ciclo.Presupuesto(sesion_agente, hoy, None, Decimal("0"))
    with pytest.raises(ciclo.Fallo, match="respuestas vacías"):
        ciclo._bucle(sesion_agente, g, llm, herramientas.Contexto(hoy=hoy), "base", [])


def test_en_el_ultimo_turno_se_avisa_que_ya_no_hay_herramientas(sesion_agente, monkeypatch) -> None:
    monkeypatch.setattr(ajustes, "max_pasos", 2)
    hoy = HOY
    llm = Falso(['{"tool": "portfolio", "args": {}}',
                 '{"decision": {"tipo": "nada", "razonamiento": "decido ya"}}'])
    g = ciclo.Presupuesto(sesion_agente, hoy, None, Decimal("0"))
    d = ciclo._bucle(sesion_agente, g, llm, herramientas.Contexto(hoy=hoy), "base", [])
    assert d.tipo == "nada"
    assert "Last turn" not in llm.llamadas[0][1] and "Last turn" in llm.llamadas[1][1]


def test_json_de_toma_el_primero_si_hay_varios() -> None:
    respuesta = 'Ahora miro META.\n{"a": 1}\nY luego {"b": 2}'
    assert ciclo._json_de(respuesta) == {"a": 1}


def test_herramienta_nativa_vuelve_como_mensaje_de_herramienta(sesion_agente) -> None:
    from decimal import Decimal

    from app.agente import herramientas

    hoy = date(2026, 11, 16)
    llm = Falso(['{"tool": "portfolio", "args": {}}',
                 '{"decision": {"tipo": "nada", "razonamiento": "espero"}}'])
    g = ciclo.Presupuesto(sesion_agente, hoy, None, Decimal("0"))
    rastro: list[dict] = []
    d = ciclo._bucle(sesion_agente, g, llm, herramientas.Contexto(hoy=hoy), "base", rastro)
    assert d.tipo == "nada"
    assert [x["tool"] for x in rastro] == ["portfolio"]
    assert '"role": "tool"' in llm.llamadas[1][1]


# --- Registro de las llamadas al modelo ---------------------------------------------------------


def _confirmada(s: Session, fecha: date) -> int:
    """Ejecución ya confirmada: el registro escribe en otra conexión y necesita verla."""
    ej = tareas.reclamar(s, Tarea.DESPERTAR, fecha)
    assert ej is not None
    s.commit()
    return ej.id


def _llamadas(s: Session, ej_id: int):  # noqa: ANN202
    return s.execute(text(
        "select etapa, paso, modelo, enviado, respuesta, razonamiento, herramientas_pedidas, "
        "coste_usd, ok, error from agente.llamadas_modelo where ejecucion_id = :e order by id"),
        {"e": ej_id}).all()


class ConRazonamiento(Falso):
    def chat_con_herramientas(self, mensajes, herramientas=None, **kw):  # noqa: ANN001, ANN003, ANN202
        r = super().chat_con_herramientas(mensajes, herramientas, **kw)
        r["mensaje"] = {**r["mensaje"], "reasoning_content": "pienso en voz alta"}
        return r


def test_cada_vuelta_del_agente_queda_registrada(sesion_agente: Session) -> None:
    s = sesion_agente
    hoy = date(2027, 1, 4)
    ej_id = _confirmada(s, hoy)
    llm = ConRazonamiento(['{"tool": "portfolio", "args": {}}',
                           '{"decision": {"tipo": "nada", "razonamiento": "espero"}}'])
    g = ciclo.Presupuesto(s, hoy, ej_id, Decimal("0"))
    ciclo._bucle(s, g, llm, herramientas.Contexto(hoy=hoy), "base", [])
    uno, dos = _llamadas(s, ej_id)
    assert (uno.etapa, uno.paso, dos.paso, uno.modelo) == ("agente", 1, 2, ajustes.modelo)
    assert [m["role"] for m in uno.enviado] == ["system", "user"]
    assert uno.herramientas_pedidas[0]["function"]["name"] == "portfolio"
    assert uno.razonamiento == "pienso en voz alta"
    # De la segunda vuelta solo se guarda lo nuevo: el resultado de la herramienta.
    assert [m["role"] for m in dos.enviado] == ["tool"]
    assert '"tipo": "nada"' in dos.respuesta
    assert (uno.coste_usd, uno.ok, uno.error) == (Decimal("0.01"), True, None)


def test_la_llamada_fallida_queda_aunque_el_ciclo_deshaga_lo_suyo(sesion_agente: Session) -> None:
    s = sesion_agente
    hoy = date(2027, 1, 5)
    ej_id = _confirmada(s, hoy)

    class Roto(Falso):
        def chat_con_herramientas(self, *a, **k):  # noqa: ANN002, ANN003, ANN202
            raise TimeoutError("sin red")

    g = ciclo.Presupuesto(s, hoy, ej_id, Decimal("0"))
    with pytest.raises(ciclo.Fallo):
        ciclo._bucle(s, g, Roto([]), herramientas.Contexto(hoy=hoy), "base", [])
    s.rollback()
    (fila,) = _llamadas(s, ej_id)
    assert fila.ok is False
    assert "TimeoutError: sin red" in fila.error


def test_el_revisor_deja_lo_que_se_le_envio_y_lo_que_respondio(sesion_agente: Session) -> None:
    s = sesion_agente
    hoy = date(2027, 1, 6)
    ej_id = _confirmada(s, hoy)
    g = ciclo.Presupuesto(s, hoy, ej_id, Decimal("0"))
    ciclo.Medido(g, Falso([APRUEBA]), ajustes.modelo_revisor).chat("sistema", "usuario")
    (fila,) = _llamadas(s, ej_id)
    assert fila.etapa == "revisor"
    assert fila.enviado == [{"role": "system", "content": "sistema"},
                            {"role": "user", "content": "usuario"}]
    assert json.loads(fila.respuesta) == APRUEBA


def test_las_llamadas_registradas_no_se_reescriben(sesion_agente: Session) -> None:
    s = sesion_agente
    hoy = date(2027, 1, 7)
    ej_id = _confirmada(s, hoy)
    g = ciclo.Presupuesto(s, hoy, ej_id, Decimal("0"))
    g.llamar(Falso([APRUEBA]), "m", "a", "b")
    with pytest.raises(Exception, match="solo se añaden filas"):
        s.execute(text("update agente.llamadas_modelo set ok = false where ejecucion_id = :e"),
                  {"e": ej_id})
