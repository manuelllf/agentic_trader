"""Datos semanales con sesiones y proveedores falsos, sin red ni base de datos externa."""

import uuid
from contextlib import contextmanager, nullcontext
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.agents.scorer import PrescoreResult
from app.liga import actualizacion as servicio
from app.liga import preview_seleccion, rutas_estrategias
from app.liga.auth import Identidad, require_jugador
from app.liga.db import db_usuario
from app.liga.estrategias import Contexto
from app.liga.ia import pregunta
from app.liga.models import RespuestaFresca
from app.liga.motor.catalogo import EmpresaFoto
from app.liga.motor.seleccion import NotasJev
from app.liga.procesos.datos import hash_pregunta


class Resultado:
    def __init__(self, filas=(), valor=None):
        self.filas, self.valor = list(filas), valor

    def scalar_one(self):
        return self.valor

    def first(self):
        return self.filas[0] if self.filas else None

    def all(self):
        return self.filas

    def mappings(self):
        return self

    def one_or_none(self):
        return self.first()


class BaseFalsa:
    def __init__(self):
        self.ahora = datetime(2026, 10, 13, 15, tzinfo=UTC)
        self.actualizaciones = {}
        self.notas = {}
        self.respuestas = {}
        self.respuestas_foto = {}
        self.consultas = []
        self.sesiones = []
        self.eventos = []

    def fabrica(self):
        sesion = Sesion(self)
        self.sesiones.append(sesion)
        return sesion


class Sesion:
    def __init__(self, base):
        self.base, self.cerrada = base, False

    def execute(self, sql, params=None):
        q = " ".join(str(sql).split()).lower()
        p, b = params or {}, self.base
        b.consultas.append(q)
        if "pg_advisory" in q:
            return Resultado()
        if q.startswith("insert into liga.actualizaciones"):
            i = len(b.actualizaciones) + 1
            b.actualizaciones[i] = dict(id=i, usuario_id=p["u"], estado="en_curso",
                                       total=p["n"], hechas=0, creado_en=b.ahora)
            return Resultado(valor=i)
        if "from liga.actualizaciones" in q:
            filas = list(b.actualizaciones.values())
            if "usuario_id = :u" in q:
                filas = [f for f in filas if f["usuario_id"] == p["u"]]
            if "estado in" in q:
                filas = [f for f in filas if f["estado"] in ("en_curso", "hecha")
                         and f["creado_en"] > b.ahora - timedelta(days=7)]
            if "select not exists" in q:
                return Resultado(valor=not filas)
            if "select max" in q:
                return Resultado(valor=max(f["creado_en"] for f in filas) + timedelta(days=7))
            if "select total" in q:
                return Resultado(valor=b.actualizaciones[p["i"]]["total"])
            filas.sort(key=lambda f: (f["creado_en"], f["id"]), reverse=True)
            return Resultado([dict(f, creada=f["creado_en"],
                                   puede_repetir_el=f["creado_en"] + timedelta(days=7)
                                   if f["estado"] != "fallida" else b.ahora) for f in filas[:1]])
        if q.startswith("update liga.actualizaciones"):
            f = b.actualizaciones[p["i"]]
            campo = "estado" if "set estado" in q else "hechas" if "set hechas" in q else "total"
            f[campo] = p["e"] if campo == "estado" else p["n"]
            return Resultado()
        if q.startswith("insert into liga.notas_frescas"):
            b.notas.setdefault((p["t"], p["d"]), SimpleNamespace(ticker=p["t"], dia=p["d"],
                **{k: v for k, v in p.items() if k.startswith("jev_")}))
            return Resultado()
        if "from liga.notas_frescas" in q and q.startswith("select"):
            return Resultado([f for (t, d), f in b.notas.items()
                              if d == p["d"] and ("t" not in p or t == p["t"])])
        if "from liga.respuestas_frescas" in q and q.startswith("select"):
            return Resultado([f for (h, t, d), f in b.respuestas.items()
                              if h == p["h"] and d == p["d"]
                              and ("t" not in p or t in p["t"])])
        if "from liga.respuestas_ia" in q:
            return Resultado([f for (h, t, foto), f in b.respuestas_foto.items()
                              if h == p["h"] and foto == p["f"] and t in p["t"]])
        if q.startswith("delete from liga."):
            tabla = b.notas if "notas_frescas" in q else b.respuestas
            for k in list(tabla):
                if k[-1] < p["d"] - timedelta(days=8):
                    del tabla[k]
            return Resultado()
        raise AssertionError(q)

    def add(self, fila):
        b = self.base
        if isinstance(fila, RespuestaFresca):
            b.respuestas[(fila.pregunta_hash, fila.ticker, fila.dia)] = fila
        else:
            b.respuestas_foto[(fila.pregunta_hash, fila.ticker, fila.foto_id)] = fila

    def flush(self):
        pass

    def begin_nested(self):
        return nullcontext()

    def commit(self):
        self.base.eventos.append("commit")

    def rollback(self):
        self.base.eventos.append("rollback")

    def close(self):
        self.cerrada = True


@pytest.fixture
def entorno(monkeypatch):
    b = BaseFalsa()
    monkeypatch.setattr(servicio, "fabrica_sistema", b.fabrica)
    monkeypatch.setattr(pregunta, "fabrica_sistema", b.fabrica)
    monkeypatch.setattr(servicio, "hoy", lambda: b.ahora.date())
    empresas = tuple(EmpresaFoto(f"T{i:03}", precio=10, market_cap_usd=1000-i,
                                sector="Technology") for i in range(310))
    notas = {e.ticker: NotasJev(9, 8, 7, 6) for e in empresas}
    ctx = Contexto(1, 2, False, empresas, notas)
    monkeypatch.setattr(servicio.estrategias, "contexto_de_referencia", lambda: ctx)
    monkeypatch.setattr(servicio.estrategias, "respuestas_sistema", lambda *_: {})
    cuenta = SimpleNamespace(gratis=False, consultas=[])

    def gratis_en_juego(uid, estrategia):
        cuenta.consultas.append((uid, estrategia))
        return cuenta.gratis

    monkeypatch.setattr(servicio.estrategias, "pregunta_gratis", gratis_en_juego)
    gathers, prescores, preguntas, cobros = [], [], [], []

    def gather(ticker, *, db, ttl_h):
        assert db is None and ttl_h == 0
        gathers.append(ticker)
        return SimpleNamespace(ticker=ticker), None

    def puntuar(llm, datos, bloque, **kw):
        assert llm is proveedor and bloque == "macro compartido"
        assert kw["temperature"] == servicio.settings.prescore_temperature
        prescores.append(datos.ticker)
        return PrescoreResult(datos.ticker, 80,
                              dimensiones={k: [8.25, .9] for k in servicio._DIMENSIONES})

    proveedor = object()
    monkeypatch.setattr(servicio.fund_mod, "gather", gather)
    monkeypatch.setattr(servicio.scorer_mod, "prescore_one", puntuar)
    monkeypatch.setattr(servicio.scan_service, "_prescore_llm", lambda *_: proveedor)
    monkeypatch.setattr(servicio.macro_mod, "get_macro", lambda _: {})
    monkeypatch.setattr(servicio.scan_service, "bloque_macro_prescore",
                        lambda *_: ("macro compartido", False))
    monkeypatch.setattr(pregunta.comun, "verificar_disponible", lambda *_: None)

    def responder(**kw):
        preguntas.append(kw["state"])
        return (.9, .95), SimpleNamespace(coste_usd=.000002)

    monkeypatch.setattr(pregunta.comun, "llamar_ia_jev", responder)
    monkeypatch.setattr(pregunta.comun, "registrar_llamada", lambda **_: len(preguntas))
    monkeypatch.setattr(servicio.comun, "reservar_creditos",
                        lambda *args: cobros.append(("reserva", args)))
    monkeypatch.setattr(servicio.comun, "liquidar_creditos",
                        lambda *args: cobros.append(("cobro", args)))
    monkeypatch.setattr(servicio.comun, "devolver_reserva",
                        lambda *args: cobros.append(("devolucion", args)))

    @contextmanager
    def sesion_como(ident):
        assert ident.claims["sub"] == ident.uid
        s = b.fabrica()
        try:
            yield s
            s.commit()
        finally:
            s.close()

    monkeypatch.setattr(servicio, "sesion_como", sesion_como)
    pendientes = []

    class Hilo:
        def __init__(self, *, target, args, daemon):
            assert daemon
            self.target, self.args = target, args

        def start(self):
            assert b.eventos[-1] == "commit"
            pendientes.append((self.target, self.args))

    monkeypatch.setattr(servicio, "threading", SimpleNamespace(Thread=Hilo))
    return SimpleNamespace(b=b, ctx=ctx, gathers=gathers, prescores=prescores,
                           preguntas=preguntas, cobros=cobros, pendientes=pendientes,
                           cuenta=cuenta)


def receta(**kw):
    return preview_seleccion.PreviewSeleccionIn(
        pesos={"negocio": 30, "precio": 20, "deuda": 20, "pronto": 20,
               "pregunta": 10 if kw.get("pregunta") else 0},
        n_empresas=3, reparto="igual", max_por_sector=0, **kw)


def ejecutar(e, body=None, uid="usuario", estrategia=None):
    aid = servicio.iniciar(uid, body or receta(), estrategia)
    funcion, args = e.pendientes.pop(0)
    funcion(*args)
    return e.b.actualizaciones[aid]


@pytest.mark.parametrize("estado, dias, permitido", [
    ("en_curso", 0, False), ("hecha", 6.99, False), ("hecha", 7, True),
    ("en_curso", 8, True), ("fallida", 0, True),
])
def test_limite_semanal(entorno, estado, dias, permitido):
    e = entorno
    e.b.actualizaciones[1] = dict(id=1, usuario_id="uno", estado=estado,
        total=1, hechas=0, creado_en=e.b.ahora-timedelta(days=dias))
    assert servicio.puede_actualizar(e.b.fabrica(), "uno") is permitido
    assert servicio.puede_actualizar(e.b.fabrica(), "otro")
    if not permitido:
        with pytest.raises(HTTPException) as exc:
            servicio.iniciar("uno", receta())
        assert exc.value.status_code == 409
        assert exc.value.detail["puede_repetir_el"]
        assert not e.pendientes


def test_tope_300_y_progreso(entorno):
    f = ejecutar(entorno)
    assert (f["estado"], f["total"], f["hechas"]) == ("hecha", 300, 300)
    assert len(entorno.gathers) == len(entorno.prescores) == 300
    assert entorno.gathers == [f"T{i:03}" for i in range(300)]
    assert entorno.b.notas[("T000", entorno.b.ahora.date())].jev_fundamentals == 825
    assert all(s.cerrada for s in entorno.b.sesiones)


def test_total_real_y_exclusiones(entorno, monkeypatch):
    ctx = entorno.ctx
    monkeypatch.setattr(servicio.estrategias, "contexto_de_referencia",
        lambda: Contexto(1, 2, False, ctx.empresas[:4], ctx.notas))
    f = ejecutar(entorno, receta(excluidas=["T000"]))
    assert f["total"] == f["hechas"] == 3
    assert entorno.gathers == ["T001", "T002", "T003"]


def test_cache_compartida_y_cobro_de_cache(entorno):
    e = entorno
    body = receta(pregunta="¿Crece?")
    assert ejecutar(e, body, "uno")["estado"] == "hecha"
    assert ejecutar(e, body, "otro")["estado"] == "hecha"
    assert len(e.gathers) == len(e.prescores) == len(e.preguntas) == 300
    assert len(e.b.respuestas) == 300
    assert not e.b.respuestas_foto
    assert [(tipo, args[2]) for tipo, args in e.cobros if tipo == "cobro"] == [
        ("cobro", Decimal(3)), ("cobro", Decimal(3))]


def test_sin_pregunta_no_cobra(entorno):
    ejecutar(entorno)
    assert not entorno.cobros and not entorno.preguntas


def test_sin_creditos_falla_sin_preguntar(entorno, monkeypatch):
    def sin_saldo(*_):
        raise HTTPException(402, "Sin saldo")
    monkeypatch.setattr(servicio.comun, "reservar_creditos", sin_saldo)
    assert ejecutar(entorno, receta(pregunta="¿Crece?"))["estado"] == "fallida"
    assert not entorno.preguntas


def test_fallo_proveedor_y_limpieza(entorno, monkeypatch, caplog):
    def fallar(*_, **__):
        raise RuntimeError("correo-privado@example.com")
    monkeypatch.setattr(servicio.fund_mod, "gather", fallar)
    liberadas = []
    monkeypatch.setattr(servicio, "_liberar_memoria", lambda: liberadas.append(True))
    f = ejecutar(entorno)
    assert f["estado"] == "fallida" and f["hechas"] == 0
    assert liberadas == [True]
    assert "RuntimeError" in caplog.text and "correo-privado" not in caplog.text
    assert all(s.cerrada for s in entorno.b.sesiones)


def test_fallo_pregunta_devuelve_reserva(entorno, monkeypatch):
    def fallar(**_):
        raise RuntimeError("proveedor")
    monkeypatch.setattr(pregunta.comun, "llamar_ia_jev", fallar)
    assert ejecutar(entorno, receta(pregunta="¿Crece?"))["estado"] == "fallida"
    assert [tipo for tipo, _ in entorno.cobros] == ["reserva", "devolucion"]


def test_poda_ocho_dias(entorno):
    e = entorno
    viejo, borde = e.b.ahora.date()-timedelta(days=9), e.b.ahora.date()-timedelta(days=8)
    e.b.notas[("OLD", viejo)] = e.b.notas[("EDGE", borde)] = SimpleNamespace()
    e.b.respuestas[("a"*64, "OLD", viejo)] = SimpleNamespace()
    ejecutar(e)
    assert ("OLD", viejo) not in e.b.notas
    assert ("EDGE", borde) in e.b.notas
    assert not e.b.respuestas


def test_dia_nueva_york(monkeypatch):
    class Reloj:
        @staticmethod
        def now(tz):
            return datetime(2026, 10, 14, 1, tzinfo=UTC).astimezone(tz)
    monkeypatch.setattr(servicio, "datetime", Reloj)
    assert servicio.hoy() == date(2026, 10, 13)


def test_preview_sustituye_solo_frescas_y_es_opt_in(entorno, monkeypatch):
    e = entorno
    monkeypatch.setattr(preview_seleccion._LIMITE_PREVIEW, "permitido", lambda _: True)
    e.b.notas[("T309", servicio.hoy())] = SimpleNamespace(ticker="T309",
        jev_fundamentals=900, jev_valuation=900, jev_financing=900, jev_catalyst=900)
    ident = Identidad("uno", "aal1", {})
    normal = preview_seleccion.previsualizar(receta(), ident)
    fresco = preview_seleccion.previsualizar(receta(usar_frescas=True), ident)
    assert normal.elegidas[0].ticker == "T000"
    assert fresco.elegidas[0].ticker == "T309"
    assert e.ctx.notas["T309"] == NotasJev(9, 8, 7, 6)
    assert len(fresco.elegidas) == 3


def test_pregunta_de_formacion_ignora_cache_diaria(entorno):
    e = entorno
    h = hash_pregunta("¿Crece?")
    e.b.respuestas[(h, "T000", servicio.hoy())] = SimpleNamespace(
        ticker="T000", si=False, seguridad="alta")
    resultado = pregunta.responder_pendientes(pregunta="¿Crece?", foto_id=1,
        empresas={"T000": e.ctx.empresas[0]}, candidatas=["T000"], finalidad="formacion")
    assert resultado.nuevas == 1 and resultado.respuestas["T000"].si
    assert len(e.preguntas) == 1
    assert not any("frescas" in q for q in e.b.consultas)


def test_formacion_y_escaneo_no_importan_ni_leen_fresco():
    raiz = Path(__file__).resolve().parents[2] / "app"
    for nombre in ("liga/procesos/formar.py", "liga/procesos/datos.py", "scan_service.py"):
        codigo = (raiz / nombre).read_text(encoding="utf-8")
        assert "actualizacion" not in codigo
        assert "notas_frescas" not in codigo and "respuestas_frescas" not in codigo


def test_rutas_202_estado_y_409(entorno, monkeypatch):
    app = FastAPI()
    app.include_router(rutas_estrategias.router)
    ident = Identidad("uno", "aal1", {"sub": "uno", "role": "authenticated"})
    app.dependency_overrides[require_jugador] = lambda: ident
    app.dependency_overrides[db_usuario] = entorno.b.fabrica
    monkeypatch.setattr("app.liga.db.sesion_como", servicio.sesion_como)
    with TestClient(app) as cliente:
        assert cliente.get("/seleccion/actualizacion").json() is None
        salida = cliente.post("/seleccion/actualizar", json=receta().model_dump())
        assert salida.status_code == 202 and salida.json() == {"id": 1, "total": 300}
        estado = cliente.get("/seleccion/actualizacion").json()
        assert estado["estado"] == "en_curso" and estado["hechas"] == 0
        assert estado["puede_repetir_el"].startswith("2026-10-20")
        assert cliente.post("/seleccion/actualizar", json=receta().model_dump()).status_code == 409


@pytest.mark.parametrize("reparto", ["igual", "nota"])
def test_reparto_gratis_y_con_creditos(entorno, reparto):
    ejecutar(entorno, receta().model_copy(update={"reparto": reparto}), "gratis")
    assert not entorno.cobros
    ejecutar(entorno, receta(pregunta="¿Crece?").model_copy(update={"reparto": reparto}), "pago")
    assert len(entorno.gathers) == 300
    assert [tipo for tipo, _ in entorno.cobros] == ["reserva", "cobro"]


def test_pregunta_de_la_estrategia_en_juego_es_gratis_sin_pro(entorno):
    e = entorno
    e.cuenta.gratis = True
    estrategia = uuid.uuid4()
    f = ejecutar(e, receta(pregunta="¿Crece?"), "uno", estrategia)
    assert (f["estado"], f["hechas"]) == ("hecha", 300)
    assert len(e.preguntas) == 300 and len(e.b.respuestas) == 300
    assert not e.cobros
    assert e.cuenta.consultas == [("uno", estrategia)]


def test_pregunta_con_pro_o_fuera_de_la_en_juego_cobra(entorno):
    e = entorno
    assert ejecutar(e, receta(pregunta="¿Crece?"), "pro", uuid.uuid4())["estado"] == "hecha"
    assert [tipo for tipo, _ in e.cobros] == ["reserva", "cobro"]


def test_pregunta_gratis_incompleta_falla_sin_cobrar(entorno, monkeypatch):
    e = entorno
    e.cuenta.gratis = True
    monkeypatch.setattr(pregunta, "responder_pendientes",
                        lambda **_: SimpleNamespace(respuestas={"T000": None}))
    assert ejecutar(e, receta(pregunta="¿Crece?"), "uno", uuid.uuid4())["estado"] == "fallida"
    assert not e.cobros


@pytest.mark.parametrize("pro, en_juego, esperado", [
    (False, True, True), (True, True, False), (False, False, False),
])
def test_pregunta_gratis_solo_sin_pro_y_en_juego(monkeypatch, pro, en_juego, esperado):
    class Sesion:
        def execute(self, sql, params=None):
            if "tiene_pro" in str(sql):
                return Resultado(valor=pro)
            assert params["u"] == "uno"
            return Resultado([SimpleNamespace()] if en_juego else [])

        def close(self):
            pass

    monkeypatch.setattr(servicio.estrategias, "fabrica_sistema", Sesion)
    assert servicio.estrategias.pregunta_gratis("uno", uuid.uuid4()) is esperado


def test_pregunta_gratis_sin_estrategia_no_consulta(monkeypatch):
    def sin_bd():
        raise AssertionError("sin estrategia no debe abrir sesión")
    monkeypatch.setattr(servicio.estrategias, "fabrica_sistema", sin_bd)
    assert servicio.estrategias.pregunta_gratis("uno", None) is False


def test_ruta_pasa_la_estrategia_y_la_pregunta_es_gratis(entorno, monkeypatch):
    e = entorno
    e.cuenta.gratis = True
    app = FastAPI()
    app.include_router(rutas_estrategias.router)
    ident = Identidad("uno", "aal1", {"sub": "uno", "role": "authenticated"})
    app.dependency_overrides[require_jugador] = lambda: ident
    app.dependency_overrides[db_usuario] = e.b.fabrica
    monkeypatch.setattr("app.liga.db.sesion_como", servicio.sesion_como)
    estrategia = uuid.uuid4()
    cuerpo = receta(pregunta="¿Crece?").model_dump() | {"estrategia_id": str(estrategia)}
    with TestClient(app) as cliente:
        assert cliente.post("/seleccion/actualizar", json=cuerpo).status_code == 202
    funcion, args = e.pendientes.pop(0)
    funcion(*args)
    assert e.cuenta.consultas == [("uno", estrategia)]
    assert not e.cobros and len(e.preguntas) == 300


def test_respuestas_y_notas_frescas_sustituyen_solo_hoy(entorno):
    e = entorno
    pregunta_texto = "¿Crece?"
    h, dia = hash_pregunta(pregunta_texto), servicio.hoy()
    e.b.respuestas[(h, "T000", dia)] = SimpleNamespace(ticker="T000", si=False, seguridad="alta")
    e.b.respuestas[(h, "T001", dia-timedelta(days=1))] = SimpleNamespace(
        ticker="T001", si=False, seguridad="alta")
    originales = {"T000": pregunta.Respuesta(True, "media"),
                  "T001": pregunta.Respuesta(True, "media")}
    notas, respuestas = servicio.frescas(e.ctx.notas, originales, pregunta_texto)
    assert respuestas["T000"] == pregunta.Respuesta(False, "alta")
    assert respuestas["T001"] == originales["T001"]
    assert originales["T000"].si and notas == e.ctx.notas


def test_cero_candidatas_no_inserta_ni_lanza(entorno):
    with pytest.raises(HTTPException) as exc:
        servicio.iniciar("uno", receta(reglas=[{"clave": "barata", "params": {"per": 8}}]))
    assert exc.value.status_code == 409
    assert not entorno.b.actualizaciones and not entorno.pendientes


def test_fallo_del_prescore_sin_dimensiones(entorno, monkeypatch, caplog):
    monkeypatch.setattr(servicio.scorer_mod, "prescore_one",
                        lambda *_args, **_kw: PrescoreResult("T000", 80))
    assert ejecutar(entorno)["estado"] == "fallida"
    assert "prescore_sin_dimensiones" in caplog.text
    assert not entorno.b.notas


def test_usuarios_concurrentes_comparten_cache(entorno, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    e = entorno
    dentro, continuar = Event(), Event()
    gather = servicio.fund_mod.gather

    def pausado(ticker, **kw):
        if ticker == "T000":
            dentro.set()
            assert continuar.wait(5)
        return gather(ticker, **kw)

    monkeypatch.setattr(servicio.fund_mod, "gather", pausado)
    servicio.iniciar("uno", receta(pregunta="¿Crece?"))
    servicio.iniciar("otro", receta(pregunta="¿Crece?"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        funcion, args = e.pendientes.pop(0)
        primero = pool.submit(funcion, *args)
        assert dentro.wait(5)
        funcion, args = e.pendientes.pop(0)
        segundo = pool.submit(funcion, *args)
        continuar.set()
        primero.result(timeout=10)
        segundo.result(timeout=10)
    assert len(e.gathers) == len(e.preguntas) == 300
    assert all(f["estado"] == "hecha" for f in e.b.actualizaciones.values())


def test_cobro_parcial_y_no_doble_devolucion(entorno, monkeypatch):
    def parcial(**_):
        return pregunta.ResultadoPregunta({"T000": pregunta.Respuesta(True, "alta")},
                                         300, 0, 1, .001)
    monkeypatch.setattr(pregunta, "responder_pendientes", parcial)
    assert ejecutar(entorno, receta(pregunta="¿Crece?"))["estado"] == "fallida"
    assert [tipo for tipo, _ in entorno.cobros] == ["reserva", "cobro"]
    assert entorno.cobros[-1][1][2] == Decimal(1)


def test_cero_respuestas_devuelve_reserva_sin_cobrar(entorno, monkeypatch):
    monkeypatch.setattr(pregunta, "responder_pendientes",
                        lambda **_: pregunta.ResultadoPregunta({}, 300, 0, 0, .001))
    assert ejecutar(entorno, receta(pregunta="¿Crece?"))["estado"] == "fallida"
    assert [tipo for tipo, _ in entorno.cobros] == ["reserva", "devolucion"]


def test_esquema_ci_refleja_062_y_copia_excluye_caches():
    from app.liga import copia

    raiz = Path(__file__).resolve().parents[2]
    esquema = (raiz / "tests/esquema_ci.sql").read_text(encoding="utf-8")
    assert esquema.splitlines()[0] == "-- migraciones-liga: 062"
    assert "(numero <= 60)" in esquema
    assert "CREATE TABLE liga.avisos (" in esquema
    assert "zona_horaria text" in esquema
    assert "CREATE VIEW liga.v_panel_usuarios" in esquema
    assert "CREATE FUNCTION liga.email_de_usuario" in esquema
    assert "CREATE VIEW liga.v_admin_cohortes" in esquema
    assert "CREATE FUNCTION liga.tiene_borrador" in esquema
    for tabla in ("actualizaciones", "notas_frescas", "respuestas_frescas", "omega_alertas"):
        assert f"CREATE TABLE liga.{tabla} (" in esquema
    assert "actualizaciones" in copia.TABLAS and copia.VERSION_ESQUEMA == 62
    assert "avisos" in copia.TABLAS
    assert "omega_alertas" in copia.TABLAS
    assert not {"notas_frescas", "respuestas_frescas"}.intersection(copia.TABLAS)



def test_pregunta_en_blanco_no_cobra(entorno):
    ejecutar(entorno, receta().model_copy(update={"pregunta": "   "}))
    assert not entorno.cobros and not entorno.preguntas
