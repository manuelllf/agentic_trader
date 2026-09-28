"""Procesos de la liga contra la copia local de producción (Docker `liga-pg`): un mes entero
simulado (foto → formar → cierres diarios → cerrar), dos veces para ver que nada se duplica.

Todo corre dentro de una transacción de la conexión del test que se deshace al final: los procesos
abren sus sesiones con savepoints sobre ella, así que no queda nada. Los datos de las salas que
usa (foto, escaneo, propuesta, Omega) son de prueba y solo viven en esa transacción. Los precios
no salen a la red: `precios.descargar` se sustituye. Sin `LIGA_TEST_DATABASE_URL`, se salta.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_DOWN, Decimal

import pytest

psycopg = pytest.importorskip("psycopg")

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app import precios  # noqa: E402
from app.liga.motor import calendario  # noqa: E402
from app.liga.motor.puntos import resultado_jornada  # noqa: E402
from app.liga.motor.rentabilidad import pesos_mantenidos  # noqa: E402
from app.liga.procesos import (  # noqa: E402
    cerrar,
    comun,
    datos,
    diario,
    estado,
    formar,
    foto,
    temporadas,
)
from app.models import (  # noqa: E402
    Approval,
    Foto,
    FundamentalsSnapshot,
    FundamentalsSnapshotMetric,
    ScanAudit,
    ScanRun,
    ScanRunConstructionItem,
    ScanRunJevItem,
)

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Sin BD de pruebas de la liga (LIGA_TEST_DATABASE_URL)")
HOY_ALTA = datetime(2026, 9, 27, 12, tzinfo=UTC)
ENERO = datetime(2027, 1, 1, 12, tzinfo=UTC)       # pasado el corte de la jornada de enero
FEBRERO = datetime(2027, 1, 30, 12, tzinfo=UTC)    # pasado el corte de la de febrero
FOTO_FIN = datetime(2026, 12, 31, 21, 30, tzinfo=UTC)

# Doce empresas de prueba: (ticker, sector, industria, notas de Jev ×100).
EMPRESAS = [
    ("ZQL", "Technology", "Semiconductors", (900, 880, 860, 840)),
    ("ZQA", "Technology", "Software - Application", (850, 800, 820, 700)),
    ("ZQB", "Technology", "Software - Infrastructure", (820, 790, 800, 690)),
    ("ZQC", "Technology", "Semiconductors", (800, 780, 790, 680)),
    ("ZQD", "Energy", "Oil & Gas E&P", (760, 770, 700, 650)),
    ("ZQE", "Energy", "Oil & Gas Midstream", (740, 760, 690, 640)),
    ("ZQF", "Healthcare", "Biotechnology", (720, 700, 680, 600)),
    ("ZQG", "Healthcare", "Medical Devices", (700, 690, 670, 590)),
    ("ZQH", "Industrials", "Airlines", (650, 640, 630, 500)),
    ("ZQI", "Utilities", "Utilities - Regulated Electric", (600, 620, 610, 480)),
    ("ZQJ", "Financial Services", "Banks - Regional", (550, 600, 560, 450)),
    ("ZQK", "Consumer Defensive", "Tobacco", (500, 580, 540, 400)),
]
SIN_PRECIO = {"ZQL"}          # la fuente no la devuelve: no se puede comprar
LAMBDA = ["ZQL", "ZQA", "ZQD", "ZQF", "ZQH"]
ALPHA = [("ZQB", "comprar", 30.0), ("ZQE", "comprar", 25.0), ("ZQG", "ampliar", 25.0),
         ("ZQI", "recortar", 10.0), ("ZQJ", "vender", 0.0)]
VETADA = "ZQE"


def _crece(ticker: str) -> float:
    return (sum(map(ord, ticker)) % 7 - 3) / 1000 if ticker != "SPY" else 0.001


class Mercado:
    """La fuente de precios simulada: cierres hasta `hasta`, y nada de `SIN_PRECIO`."""

    def __init__(self) -> None:
        self.hasta = date(2026, 12, 31)
        self.pedidos: list[tuple[str, ...]] = []

    def descargar(self, tickers: list[str], desde: date) -> dict[str, list[precios.Cierre]]:
        self.pedidos.append(tuple(tickers))
        dias = calendario.dias_de_bolsa(date(2026, 12, 21), self.hasta)
        out = {}
        for t in tickers:
            if t in SIN_PRECIO:
                continue
            base = 50.0 if t != "SPY" else 600.0
            out[t] = [precios.Cierre(d, round(base * (1 + _crece(t)) ** i, 4))
                      for i, d in enumerate(dias)]
        return out


@pytest.fixture
def fabrica():
    engine = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    conn = engine.connect()
    trans = conn.begin()

    def nueva() -> Session:
        return Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False,
                       expire_on_commit=False)

    try:
        yield nueva
    finally:
        trans.rollback()
        conn.close()
        engine.dispose()


@pytest.fixture
def mercado(monkeypatch) -> Mercado:  # noqa: ANN001
    m = Mercado()
    monkeypatch.setattr(precios, "descargar", m.descargar)
    return m


def _usuario(db: Session) -> uuid.UUID:
    uid = uuid.uuid4()
    db.execute(text("insert into auth.users (id, email) values (:i, :e)"),
               {"i": uid, "e": f"{uid.hex[:12]}@prueba.local"})
    return uid


def _estrategia(db: Session, uid: uuid.UUID, nombre: str, *, pregunta: str | None = None,
                n: int = 5, reparto: str = "igual", max_sector: int = 2,
                mantener: bool = False) -> uuid.UUID:
    eid = db.execute(text(
        "insert into liga.estrategias (dueno_id, nombre, forma, dibujo, color1, color2, "
        "cada_dia_1) values (:u, :n, 'escudo', 'liso', '#0B6E68', '#FFFFFF', :c) returning id"),
        {"u": uid, "n": nombre, "c": "mantener" if mantener else "revisar"}).scalar()
    rid = db.execute(text(
        "insert into liga.recetas (estrategia_id, reglas, catalogo_version, pregunta, "
        "peso_negocio, peso_precio, peso_deuda, peso_pronto, peso_pregunta, n_empresas, reparto, "
        "max_por_sector) values (:e, '[]', 1, :p, 30, 20, 20, 0, :pp, :n, :r, :m) returning id"),
        {"e": eid, "p": pregunta, "pp": 30 if pregunta else 0, "n": n, "r": reparto,
         "m": max_sector}).scalar()
    db.execute(text("update liga.estrategias set receta_id = :r, estado = 'apuntada' "
                    "where id = :e"), {"r": rid, "e": eid})
    return eid


@pytest.fixture
def mundo(fabrica, mercado) -> dict:  # noqa: ANN001
    """Temporadas, una foto con su escaneo de decisión, la propuesta de Alpha, la cartera de Jev,
    Omega con una posición y tres estrategias de usuario."""
    temporadas.ejecutar(fabrica, ahora=HOY_ALTA)
    db = fabrica()
    ids: dict = {}
    f = Foto(alcance="nasdaq", inicio=FOTO_FIN - timedelta(hours=1), fin=FOTO_FIN,
             estado="completa")
    db.add(f)
    db.flush()
    for i, (t, sector, industria, _) in enumerate(EMPRESAS):
        s = FundamentalsSnapshot(ticker=t, captured_at=FOTO_FIN, sector=sector, industry=industria,
                                 name=f"Empresa {t}", price=50.0, market_cap=1e9 * (20 - i),
                                 market_cap_usd=1e9 * (20 - i), pe_trailing=15.0,
                                 high_52w=60.0, foto_id=f.id)
        db.add(s)
        db.flush()
        for clave, valor in (("totalDebt", 1e8), ("totalCash", 2e8), ("ebitda", 5e8),
                             ("dividendYield", 1.5)):
            db.add(FundamentalsSnapshotMetric(fundamentals_snapshot_id=s.id, clave=clave,
                                              valor_num=valor))
    scan_at = FOTO_FIN + timedelta(minutes=15)
    run = ScanRun(scan_at=scan_at, cadence="decisión/full", decide=True, foto_id=f.id)
    db.add(run)
    db.flush()
    for t, _, _, n in EMPRESAS:
        db.add(ScanAudit(scan_at=scan_at, ticker=t, scan_run_id=run.id, decide=True,
                         jev_fundamentals=n[0], jev_valuation=n[1], jev_financing=n[2],
                         jev_catalyst=n[3]))
    for i, t in enumerate(LAMBDA):
        db.add(ScanRunJevItem(scan_run_id=run.id, posicion=i, ticker=t, industry="", score=8.0,
                              weight_pct=20.0))
    for i, (t, accion, w) in enumerate(ALPHA):
        db.add(ScanRunConstructionItem(scan_run_id=run.id, posicion=i, ticker=t, action=accion,
                                       target_weight_pct=w, target_value="0", target_shares=0.0,
                                       delta_shares=0.0))
    db.add(Approval(ticker=VETADA, action="comprar", status="rejected", target_weight_pct=25.0,
                    created_at=scan_at - timedelta(minutes=2),
                    decided_at=scan_at + timedelta(minutes=10)))
    # Omega: solo lo de esta prueba, con una posición abierta antes del corte.
    db.execute(text("delete from momentum_ejecuciones"))
    senal = db.execute(text(
        "insert into momentum_senales (ticker, sector, tipo, entry_date, entry_price, ref_label, "
        "ref_price, caida_pct, estado) values ('ZQH', 'Industrials', 'suelo', '2026-12-10', 50, "
        "'max', 70, 30, 'ejecutada') returning id")).scalar()
    db.execute(text(
        "insert into momentum_ejecuciones (senal_id, accion, acciones, precio, comision, "
        "ejecutada_at) values (:s, 'compra', 10, 50, 0, '2026-12-15 15:00+00')"), {"s": senal})
    uid = _usuario(db)
    ids["reglas"] = _estrategia(db, uid, "Solo notas")
    ids["pregunta"] = _estrategia(db, uid, "Con pregunta", pregunta="¿Tiene ventaja?", n=3,
                                  reparto="nota", max_sector=0)
    ids["mantener"] = _estrategia(db, uid, "La mantengo", n=3, mantener=True)
    h = datos.hash_pregunta("¿Tiene ventaja?")
    for t, si, seg in (("ZQA", True, "alta"), ("ZQF", True, "media"), ("ZQK", False, "alta"),
                       ("ZQB", False, "baja")):
        db.execute(text("insert into liga.respuestas_ia (pregunta_hash, ticker, foto_id, si, "
                        "seguridad) values (:h, :t, :f, :s, :g)"),
                   {"h": h, "t": t, "f": f.id, "s": si, "g": seg})
    db.commit()
    jornadas = dict(db.execute(text(
        "select j.numero, j.id from liga.jornadas j join liga.temporadas t "
        "on t.id = j.temporada_id where t.nombre = :n"), {"n": temporadas.TEMPORADA_1}).all())
    db.close()
    return {**ids, "foto": f.id, "scan": run.id, "enero": jornadas[1], "febrero": jornadas[2]}


def _cuenta(fabrica, sql: str, **p) -> int:  # noqa: ANN001, ANN003
    with comun.sesion(fabrica) as db:
        return db.execute(text(sql), p).scalar()


def _inscripciones(fabrica, jornada_id: int) -> dict:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        filas = db.execute(text(
            "select i.id, e.id as eid, e.casa_clave, i.estado, i.receta_id, i.n_pasan "
            "from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id "
            "where i.jornada_id = :j"), {"j": jornada_id}).all()
        pos = datos.posiciones(db, [f.id for f in filas])
        return {(f.casa_clave or f.eid): {"fila": f, "pos": dict(pos[f.id])} for f in filas}


def _formar_mes(fabrica, mercado: Mercado, jornada_id: int, ahora: datetime) -> dict:  # noqa: ANN001
    foto.ejecutar(jornada_id, fabrica=fabrica)
    return formar.ejecutar(jornada_id, fabrica=fabrica, ahora=ahora)


def _cerrar_mes(fabrica, mercado: Mercado, jornada_id: int) -> dict:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        dia_inicio, dia_fin = db.execute(text(
            "select dia_inicio, dia_fin from liga.jornadas where id = :j"), {"j": jornada_id}).one()
    for dia in (dia_inicio, dia_inicio + timedelta(days=7), dia_fin):
        mercado.hasta = dia
        diario.ejecutar(fabrica)
    return cerrar.ejecutar(jornada_id, fabrica=fabrica)


# ---- el mes entero ------------------------------------------------------------------------------


def test_temporadas_idempotentes(fabrica) -> None:  # noqa: ANN001
    primera = temporadas.ejecutar(fabrica, ahora=HOY_ALTA)
    assert set(primera["creadas"]) == {temporadas.PRETEMPORADA, temporadas.TEMPORADA_1}
    assert set(primera["casa"]["creadas"]) == {"alpha", "omega", "lambda"}
    segunda = temporadas.ejecutar(fabrica, ahora=datetime(2026, 11, 2, tzinfo=UTC))
    assert segunda["creadas"] == [] and segunda["casa"]["creadas"] == []
    assert _cuenta(fabrica, "select count(*) from liga.jornadas") == 3 + 12
    assert _cuenta(fabrica, "select count(*) from liga.estrategias where tipo = 'casa'") == 3
    ene = _cuenta(fabrica, "select dia_base from liga.jornadas j join liga.temporadas t on "
                           "t.id = j.temporada_id where t.cuenta and j.numero = 1")
    assert ene == date(2026, 12, 31)


def test_un_mes_entero_dos_veces_sin_duplicar(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    prev = formar.vista_previa(ene, fabrica=fabrica, ahora=ENERO)
    assert prev["listo"] is False and "foto" in prev["motivos"][0]

    designada = foto.ejecutar(ene, fabrica=fabrica)
    assert (designada["foto_id"], designada["scan_run_id"], designada["plan_b"]) == \
        (mundo["foto"], mundo["scan"], False)
    assert designada["con_notas"] == len(EMPRESAS)

    prev = formar.vista_previa(ene, fabrica=fabrica, ahora=ENERO)
    assert prev["listo"] is True and prev["n_estrategias"] == 3
    assert "SPY" in prev["sin_precio"]                      # la vista previa no pide precios
    assert _cuenta(fabrica, "select count(*) from liga.inscripciones") == 0
    antes = formar.vista_previa(ene, fabrica=fabrica, ahora=ENERO - timedelta(days=1))
    assert antes["listo"] is False and "corte" in antes["motivos"][0]

    hecho = formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    assert hecho["estado"] == "formada" and hecho["sin_precio"] == ["ZQL"]
    ins = _inscripciones(fabrica, ene)
    assert set(ins) == {mundo["reglas"], mundo["pregunta"], mundo["mantener"],
                        "alpha", "omega", "lambda"}
    # Sin precio de compra, ZQL no entra en ninguna; en Lambda su peso se queda en caja.
    assert all("ZQL" not in i["pos"] for i in ins.values())
    assert ins["lambda"]["pos"] == dict.fromkeys(["ZQA", "ZQD", "ZQF", "ZQH"], Decimal("20"))
    assert ins["lambda"]["fila"].receta_id is None
    # Alpha: la compra vetada antes del corte, a caja; la venta (peso 0) no entra.
    assert ins["alpha"]["pos"] == {"ZQB": Decimal(30), "ZQG": Decimal(25), "ZQI": Decimal(10)}
    # Omega: 10 acciones de ZQH al cierre del día base sobre su capital (posición + libre).
    valor = 10 * _cuenta(fabrica, "select cierre from precio_cierre where ticker = 'ZQH' "
                                  "and dia = '2026-12-31'")
    libre = Decimal(3000) - Decimal(500)                     # tope menos lo invertido a coste
    esperado = (valor / (valor + libre) * 100).quantize(Decimal("1e-4"), rounding=ROUND_DOWN)
    assert ins["omega"]["pos"] == {"ZQH": esperado}
    reglas = ins[mundo["reglas"]]
    assert list(reglas["pos"]) == ["ZQA", "ZQB", "ZQD", "ZQE", "ZQF"]   # 2 por sector como mucho
    assert reglas["fila"].n_pasan == len(EMPRESAS) - 1 and reglas["fila"].estado == "formada"
    # Con pregunta, solo pasan las que tienen respuesta en la caché; ZQK contestó que no con
    # seguridad alta y queda la cuarta de cuatro.
    assert set(ins[mundo["pregunta"]]["pos"]) == {"ZQA", "ZQF", "ZQB"}
    for i in ins.values():
        assert sum(i["pos"].values()) <= 100
    assert _cuenta(fabrica, "select count(*) from liga.estrategias where tipo = 'usuario' "
                            "and estado = 'jugando'") == 3

    # Repetir no duplica: la jornada ya está formada.
    n_ins = _cuenta(fabrica, "select count(*) from liga.inscripciones")
    n_pos = _cuenta(fabrica, "select count(*) from liga.posiciones")
    with pytest.raises(comun.ErrorProceso, match="formada"):
        formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    with pytest.raises(comun.ErrorProceso, match="formada"):
        foto.ejecutar(ene, fabrica=fabrica)
    assert _cuenta(fabrica, "select count(*) from liga.inscripciones") == n_ins
    assert _cuenta(fabrica, "select count(*) from liga.posiciones") == n_pos

    # Cierres diarios y tabla provisional, calculada.
    with pytest.raises(comun.ErrorProceso):
        cerrar.ejecutar(ene, fabrica=fabrica)                # aún no hay cierre del último día
    mercado.hasta = date(2027, 1, 12)
    assert diario.ejecutar(fabrica)["filas"] > 0
    tabla = diario.tabla_provisional(ene, fabrica=fabrica)
    assert tabla["dia"] == "2027-01-12" and len(tabla["filas"]) == 6
    assert cerrar.vista_previa(ene, fabrica=fabrica)["listo"] is False

    mercado.hasta = date(2027, 1, 29)
    diario.ejecutar(fabrica)
    prev = cerrar.vista_previa(ene, fabrica=fabrica)
    assert prev["listo"] is True and prev["dia"] == "2027-01-29"
    cerrado = cerrar.ejecutar(ene, fabrica=fabrica)
    assert cerrado["estado"] == "cerrada"
    assert cerrado["sp_rentabilidad"] == prev["sp_rentabilidad"]
    sp = Decimal(cerrado["sp_rentabilidad"])
    assert sp > 0                                             # el SPY simulado sube cada día
    with comun.sesion(fabrica) as db:
        res = db.execute(text(
            "select r.rentabilidad, r.puntos from liga.resultados r join liga.inscripciones i "
            "on i.id = r.inscripcion_id where i.jornada_id = :j"), {"j": ene}).all()
        j_sp = db.execute(text("select sp_rentabilidad from liga.jornadas where id = :j"),
                          {"j": ene}).scalar()
    assert len(res) == 6 and j_sp == sp
    assert all(p == resultado_jornada(r, sp).puntos for r, p in res)

    # Y otra vez: nada nuevo.
    with pytest.raises(comun.ErrorProceso, match="cerrada"):
        cerrar.ejecutar(ene, fabrica=fabrica)
    diario.ejecutar(fabrica)                                  # sin jornadas formadas, no hace nada
    assert _cuenta(fabrica, "select count(*) from liga.resultados") == 6
    general = estado.general(fabrica)
    ultimo = general["ultimo_intento"]
    assert ultimo["cerrar"]["ok"] and ultimo["formar"]["ok"]


def test_mantener_conserva_sus_valores_con_los_pesos_de_fin_de_mes(fabrica, mercado,
                                                                  mundo) -> None:  # noqa: ANN001
    _formar_mes(fabrica, mercado, mundo["enero"], ENERO)
    _cerrar_mes(fabrica, mercado, mundo["enero"])
    enero = _inscripciones(fabrica, mundo["enero"])
    with comun.sesion(fabrica) as db:
        pos = list(enero[mundo["mantener"]]["pos"].items())
        esperado = pesos_mantenidos(pos, precios.series(db, [t for t, _ in pos]),
                                    date(2026, 12, 31), date(2027, 1, 29))
    hecho = _formar_mes(fabrica, mercado, mundo["febrero"], FEBRERO)
    origen = {e["estrategia_id"]: e["origen"] for e in hecho["estrategias"]}
    assert origen[str(mundo["mantener"])] == "mantener"
    assert origen[str(mundo["reglas"])] == "seleccion"
    febrero = _inscripciones(fabrica, mundo["febrero"])
    assert febrero[mundo["mantener"]]["pos"] == dict(esperado)
    assert febrero[mundo["mantener"]]["fila"].n_pasan is None


def test_plan_b_sin_escaneo_propio(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        nueva = Foto(alcance="nasdaq", inicio=FOTO_FIN + timedelta(hours=2),
                     fin=FOTO_FIN + timedelta(hours=3), estado="completa")
        db.add(nueva)
        db.flush()
        db.add(FundamentalsSnapshot(ticker="ZQA", captured_at=FOTO_FIN, sector="Technology",
                                    foto_id=nueva.id))
        db.commit()
        nueva_id = nueva.id
    d = foto.ejecutar(mundo["enero"], nueva_id, fabrica=fabrica)
    assert (d["foto_id"], d["scan_run_id"], d["plan_b"]) == (nueva_id, mundo["scan"], True)
    assert foto.estado(mundo["enero"], fabrica=fabrica)["plan_b"] is True
    prev = formar.vista_previa(mundo["enero"], fabrica=fabrica, ahora=ENERO)
    assert prev["casa"]["lambda"]["juega"] is False and prev["casa"]["alpha"]["juega"] is False
    assert "plan B" in prev["casa"]["lambda"]["motivo"]


def test_otra_instancia_con_el_candado_no_deja_formar(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    foto.ejecutar(mundo["enero"], fabrica=fabrica)
    with psycopg.connect(URL) as otra:
        otra.execute("select pg_advisory_xact_lock(hashtextextended('liga.proceso:formar', 0))")
        with pytest.raises(comun.ProcesoOcupado):
            formar.ejecutar(mundo["enero"], fabrica=fabrica, ahora=ENERO)
        otra.rollback()
    assert _cuenta(fabrica, "select count(*) from liga.inscripciones") == 0


def test_una_estrategia_de_usuario_no_se_inscribe_sin_receta(fabrica, mundo) -> None:  # noqa: ANN001
    db = fabrica()
    with pytest.raises(Exception, match="casa se inscriben sin receta"):
        db.execute(text("insert into liga.inscripciones (jornada_id, estrategia_id) "
                        "values (:j, :e)"), {"j": mundo["enero"], "e": mundo["reglas"]})
    db.rollback()
    db.close()


def test_omega_no_juega_si_opero_despues_del_corte(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        db.execute(text(
            "insert into momentum_ejecuciones (senal_id, accion, acciones, precio, comision, "
            "ejecutada_at) select senal_id, 'venta', 10, 55, 0, '2027-01-04 15:00+00' "
            "from momentum_ejecuciones limit 1"))
        db.commit()
    foto.ejecutar(mundo["enero"], fabrica=fabrica)
    hecho = formar.ejecutar(mundo["enero"], fabrica=fabrica, ahora=ENERO)
    assert hecho["casa"]["omega"]["juega"] is False
    assert "omega" not in _inscripciones(fabrica, mundo["enero"])


def _saltar_pretemporada(fabrica, mundo: dict) -> None:  # noqa: ANN001
    """La pretemporada (oct-dic 2026, no cuenta) también nace `programada` sin foto -- para que
    "la jornada siguiente" del auto sea de verdad la de enero, se marca ya resuelta (como si ya
    se hubiera jugado), igual que en producción el tiempo la habría dejado atrás."""
    with comun.sesion(fabrica) as db:
        db.execute(text(
            "update liga.jornadas set foto_id = :f, scan_run_id = :s "
            "where temporada_id = (select id from liga.temporadas where nombre = :p)"),
            {"f": mundo["foto"], "s": mundo["scan"], "p": temporadas.PRETEMPORADA})
        db.commit()


def test_foto_auto_designa_la_jornada_siguiente_sin_foto(fabrica, mundo) -> None:  # noqa: ANN001
    _saltar_pretemporada(fabrica, mundo)
    d = foto.auto_desde_escaneo(mundo["scan"], fabrica=fabrica)
    assert (d["foto_id"], d["scan_run_id"], d["plan_b"]) == (mundo["foto"], mundo["scan"], False)
    assert d["cambiada"] is True
    assert foto.estado(mundo["enero"], fabrica=fabrica)["foto_id"] == mundo["foto"]
    with comun.sesion(fabrica) as db:
        fila = db.execute(text(
            "select detalle from liga.auditoria where accion = 'proceso.foto' "
            "and objeto = :o order by id desc limit 1"),
            {"o": f"jornada:{mundo['enero']}"}).one()
    assert fila.detalle["auto"] is True


def test_foto_auto_apagada_no_toca_nada(fabrica, mundo) -> None:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        db.execute(text(
            "insert into liga.ajustes (clave, valor) values ('procesos.foto.auto', 'false')"))
        db.commit()
    assert foto.auto_desde_escaneo(mundo["scan"], fabrica=fabrica) is None
    assert foto.estado(mundo["enero"], fabrica=fabrica)["foto_id"] is None
    assert _cuenta(fabrica, "select count(*) from liga.auditoria "
                           "where accion like 'proceso.foto.auto%'") == 0


def test_foto_auto_sin_jornada_programada_audita_omitido(fabrica, mundo) -> None:  # noqa: ANN001
    _saltar_pretemporada(fabrica, mundo)
    foto.ejecutar(mundo["enero"], fabrica=fabrica)
    foto.ejecutar(mundo["febrero"], mundo["foto"], mundo["scan"], fabrica=fabrica)
    with comun.sesion(fabrica) as db:
        # El resto de Temporada 1 (marzo-diciembre) también nace `programada` sin foto -- se
        # marca resuelta igual que la pretemporada para dejar de verdad cero candidatos.
        db.execute(text(
            "update liga.jornadas set foto_id = :f, scan_run_id = :s where numero > 2 "
            "and temporada_id = (select id from liga.temporadas where nombre = :t)"),
            {"f": mundo["foto"], "s": mundo["scan"], "t": temporadas.TEMPORADA_1})
        db.commit()
    assert foto.auto_desde_escaneo(mundo["scan"], fabrica=fabrica) is None
    with comun.sesion(fabrica) as db:
        fila = db.execute(text(
            "select objeto, detalle from liga.auditoria "
            "where accion = 'proceso.foto.auto.omitido' order by id desc limit 1")).one()
    assert fila.objeto == f"escaneo:{mundo['scan']}"
    assert "sin foto" in fila.detalle["razon"]


def test_foto_auto_no_lanza_con_escaneo_invalido(fabrica, mundo) -> None:  # noqa: ANN001
    """Escaneo que no es de decisión: `_designar` lo rechaza (`ErrorProceso`) y se audita como
    omitido en vez de propagar -- el escaneo que llama a esto nunca debe reventar por esto."""
    with comun.sesion(fabrica) as db:
        otro = ScanRun(scan_at=FOTO_FIN, cadence="observatorio/full", decide=False,
                      foto_id=mundo["foto"])
        db.add(otro)
        db.commit()
        otro_id = otro.id
    assert foto.auto_desde_escaneo(otro_id, fabrica=fabrica) is None
    assert foto.estado(mundo["enero"], fabrica=fabrica)["foto_id"] is None
    with comun.sesion(fabrica) as db:
        fila = db.execute(text(
            "select detalle from liga.auditoria where accion = 'proceso.foto.auto.omitido' "
            "order by id desc limit 1")).one()
    assert "decisión" in fila.detalle["razon"]


def test_el_interruptor_enciende_el_diario(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    _formar_mes(fabrica, mercado, mundo["enero"], ENERO)
    martes = datetime(2027, 1, 5, 22, 15, tzinfo=UTC)
    assert diario.job(fabrica, martes) is None                 # apagado si no hay ajuste
    diario.interruptor(True, fabrica)
    mercado.hasta = date(2027, 1, 5)
    assert diario.job(fabrica, martes)["filas"] > 0
    assert diario.estado(fabrica)["activo"] is True
    diario.interruptor(False, fabrica)
    assert diario.job(fabrica, martes) is None
