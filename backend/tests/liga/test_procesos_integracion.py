"""Procesos de la liga contra la copia local de producción (Docker `liga-pg`): un mes entero
simulado (foto → formar → cierres diarios → cerrar), dos veces para ver que nada se duplica.

Todo corre dentro de una transacción de la conexión del test que se deshace al final: los procesos
abren sus sesiones con savepoints sobre ella, así que no queda nada. Los datos de las salas que
usa (foto, escaneo, propuesta, Omega) son de prueba y solo viven en esa transacción. Los precios
no salen a la red: `precios.descargar` se sustituye. Sin `LIGA_TEST_DATABASE_URL`, se salta.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import pytest

psycopg = pytest.importorskip("psycopg")

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app import precios  # noqa: E402
from app.liga import cambios  # noqa: E402
from app.liga.ia import comun as ia_comun  # noqa: E402
from app.liga.models import Jornada  # noqa: E402
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
    omega,
    temporadas,
)
from app.models import (  # noqa: E402
    Foto,
    FundamentalsSnapshot,
    ScanAudit,
    ScanRun,
    ScanRunConstructionItem,
    ScanRunJevItem,
)

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Sin BD de pruebas de la liga (LIGA_TEST_DATABASE_URL)")
HOY_ALTA = datetime(2026, 9, 27, 12, tzinfo=UTC)
ENERO = datetime(2027, 1, 4, 15, tzinfo=UTC)       # pasado el corte de la de enero
FEBRERO = datetime(2027, 2, 1, 15, tzinfo=UTC)     # pasado el corte de la de febrero
CORTE_ENERO = datetime(2026, 12, 31, 23, 0, tzinfo=UTC)    # 18:00 ET del día base
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
# Alertas de Omega de enero: (ticker, instante UTC, caída). ZQA y ZQB llegan a la vez: gana la
# caída más fuerte. La quinta espera a que un hueco quede libre.
ALERTAS = [("ZQA", "2027-01-05 15:00+00", 30), ("ZQB", "2027-01-05 15:00+00", 40),
           ("ZQC", "2027-01-06 15:00+00", 25), ("ZQD", "2027-01-07 15:00+00", 25),
           ("ZQF", "2027-01-08 15:00+00", 25)]


def _crece(ticker: str) -> float:
    return (sum(map(ord, ticker)) % 7 - 3) / 1000 if ticker != "SPY" else 0.001


class Mercado:
    """La fuente de precios simulada: cierres hasta `hasta`, y nada de `SIN_PRECIO`."""

    def __init__(self) -> None:
        self.hasta = date(2026, 12, 31)
        self.pedidos: list[tuple[str, ...]] = []
        self.saltos: dict[str, tuple[date, float]] = {}   # ticker: (desde qué día, multiplicador)

    def descargar(self, tickers: list[str], desde: date) -> dict[str, list[precios.Cierre]]:
        self.pedidos.append(tuple(tickers))
        dias = calendario.dias_de_bolsa(date(2026, 12, 21), self.hasta)
        out = {}
        for t in tickers:
            if t in SIN_PRECIO:
                continue
            base = 50.0 if t != "SPY" else 600.0
            dia_salto, mult = self.saltos.get(t, (date.max, 1.0))
            out[t] = [precios.Cierre(d, round(base * (1 + _crece(t)) ** i
                                              * (mult if d >= dia_salto else 1.0), 4))
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
    db.execute(text("insert into auth.users (id, email, email_confirmed_at) "
                    "values (:i, :e, now())"),
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


def _foto_y_escaneo(db: Session, fin: datetime) -> tuple[Foto, ScanRun]:
    """Una foto completa terminada en `fin` y el escaneo de decisión que la puntuó."""
    f = Foto(alcance="nasdaq", inicio=fin - timedelta(hours=1), fin=fin, estado="completa")
    db.add(f)
    db.flush()
    for i, (t, sector, industria, _) in enumerate(EMPRESAS):
        s = FundamentalsSnapshot(ticker=t, captured_at=fin, sector=sector, industry=industria,
                                 name=f"Empresa {t}", price=50.0, market_cap=1e9 * (20 - i),
                                 market_cap_usd=1e9 * (20 - i), pe_trailing=15.0,
                                 high_52w=60.0, foto_id=f.id,
                                 metricas={"totalDebt": 1e8, "totalCash": 2e8, "ebitda": 5e8,
                                           "dividendYield": 1.5})
        db.add(s)
        db.flush()
    scan_at = fin + timedelta(minutes=15)
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
    return f, run


def _asegurar_foto_del_dia_base(fabrica, jornada_id: int) -> None:  # noqa: ANN001
    """La foto y el escaneo del día base de la jornada, como los dejaría el escaneo de ese día:
    una foto por mes, con las mismas respuestas de Jev a la pregunta que la del primero."""
    with comun.sesion(fabrica) as db:
        dia_base = db.execute(text("select dia_base from liga.jornadas where id = :j"),
                              {"j": jornada_id}).scalar()
        hay = db.execute(text(
            "select count(*) from public.foto where estado = 'completa' and "
            "(fin at time zone 'America/New_York')::date = :d"), {"d": dia_base}).scalar()
        if hay:
            return
        primera = db.execute(text("select min(id) from public.foto")).scalar()
        nueva, _ = _foto_y_escaneo(db, datetime.combine(dia_base, time(21, 30), tzinfo=UTC))
        db.execute(text(
            "insert into liga.respuestas_ia (pregunta_hash, ticker, foto_id, si, seguridad) "
            "select pregunta_hash, ticker, :n, si, seguridad from liga.respuestas_ia "
            "where foto_id = :v"), {"n": nueva.id, "v": primera})
        db.commit()


@pytest.fixture
def mundo(fabrica, mercado) -> dict:  # noqa: ANN001
    """Temporadas, una foto con su escaneo de decisión, la propuesta de Alpha, la cartera de Jev,
    Omega con una posición y tres estrategias de usuario."""
    temporadas.ejecutar(fabrica, ahora=HOY_ALTA)
    db = fabrica()
    ids: dict = {}
    f, run = _foto_y_escaneo(db, FOTO_FIN)
    # Omega: solo alertas de esta prueba (se deshacen con la transacción).
    for t, momento, caida in ALERTAS:
        db.execute(text(
            "insert into momentum_senales (ticker, sector, tipo, entry_date, entry_price, "
            "ref_label, ref_price, caida_pct, estado, created_at) values (:t, 'Industrials', "
            "'suelo', :d, 50, 'max', 70, :c, 'nueva', :m)"),
            {"t": t, "d": momento[:10], "c": caida, "m": momento})
    uid = _usuario(db)
    db.execute(text("insert into liga.planes_usuario (usuario_id, plan, origen) "
                    "values (:u, 'pro', 'admin')"), {"u": uid})
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
            "select i.id, e.id as eid, e.casa_clave, i.estado, i.receta_id, i.n_pasan, "
            "i.optaba_premio "
            "from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id "
            "where i.jornada_id = :j"), {"j": jornada_id}).all()
        pos = datos.posiciones(db, [f.id for f in filas])
        return {(f.casa_clave or f.eid): {"fila": f, "pos": dict(pos[f.id])} for f in filas}


def _formar_mes(fabrica, mercado: Mercado, jornada_id: int, ahora: datetime) -> dict:  # noqa: ANN001
    _asegurar_foto_del_dia_base(fabrica, jornada_id)
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
    antes = formar.vista_previa(ene, fabrica=fabrica, ahora=CORTE_ENERO - timedelta(minutes=5))
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
    # Alpha: la propuesta tal cual, sin vetos; la venta (peso 0) no entra.
    assert ins["alpha"]["pos"] == {"ZQB": Decimal(30), "ZQE": Decimal(25), "ZQG": Decimal(25),
                                   "ZQI": Decimal(10)}
    # Omega nace en caja: sus huecos se llenan con las alertas durante el mes.
    assert ins["omega"]["pos"] == {}
    reglas = ins[mundo["reglas"]]
    assert list(reglas["pos"]) == ["ZQA", "ZQB", "ZQD", "ZQE", "ZQF"]   # 2 por sector como mucho
    assert reglas["fila"].n_pasan == len(EMPRESAS) - 1 and reglas["fila"].estado == "formada"
    # Con pregunta pero con respuestas solo de 4 de las candidatas: todo o nada, así que juega sin
    # ella (las tres mejores por las notas, sin tope por sector) y queda apuntado por qué.
    assert set(ins[mundo["pregunta"]]["pos"]) == {"ZQA", "ZQB", "ZQC"}
    with comun.sesion(fabrica) as db:
        degradadas = dict(db.execute(text(
            "select e.nombre, d.motivo from liga.formaciones_degradadas d "
            "join liga.inscripciones i on i.id = d.inscripcion_id "
            "join liga.estrategias e on e.id = i.estrategia_id")).all())
    assert degradadas == {"Con pregunta": "sin_ia"}      # en pruebas la IA está apagada
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


def test_con_todas_las_respuestas_la_pregunta_cuenta_y_nada_se_apunta(  # noqa: ANN001
        fabrica, mercado, mundo) -> None:
    ene = mundo["enero"]
    h = datos.hash_pregunta("¿Tiene ventaja?")
    with comun.sesion(fabrica) as db:
        for t, _, _, _ in EMPRESAS:
            if t in ("ZQA", "ZQF", "ZQB", "ZQK"):
                continue                                     # ya contestadas por el fixture
            db.execute(text("insert into liga.respuestas_ia (pregunta_hash, ticker, foto_id, si, "
                            "seguridad) values (:h, :t, :f, false, 'alta')"),
                       {"h": h, "t": t, "f": mundo["foto"]})
        db.commit()
    foto.ejecutar(ene, fabrica=fabrica)
    formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    ins = _inscripciones(fabrica, ene)
    # ZQA y ZQB contestaron que sí con seguridad alta, ZQF que sí con media: los que más suben.
    assert set(ins[mundo["pregunta"]]["pos"]) == {"ZQA", "ZQF", "ZQB"}
    assert _cuenta(fabrica, "select count(*) from liga.formaciones_degradadas") == 0


def _contestar_todas(fabrica, mundo) -> None:  # noqa: ANN001
    """Todas las respuestas de «¿Tiene ventaja?» ya en la caché de la foto."""
    h = datos.hash_pregunta("¿Tiene ventaja?")
    with comun.sesion(fabrica) as db:
        for t, _, _, _ in EMPRESAS:
            db.execute(text("insert into liga.respuestas_ia (pregunta_hash, ticker, foto_id, si, "
                            "seguridad) values (:h, :t, :f, false, 'alta') "
                            "on conflict do nothing"), {"h": h, "t": t, "f": mundo["foto"]})
        db.commit()


def _cuenta_con_pregunta(fabrica, creditos: int) -> uuid.UUID:  # noqa: ANN001
    """Una cuenta sin Pro con una estrategia de pregunta propia y esos créditos de saldo."""
    with comun.sesion(fabrica) as db:
        uid = _usuario(db)
        eid = _estrategia(db, uid, "De pago", pregunta="¿Tiene ventaja?", n=3, reparto="nota",
                          max_sector=0)
        if creditos:
            db.execute(text("select liga.cargar_creditos(:u, :c, 'regalo', 'regalo-de-prueba')"),
                       {"u": uid, "c": creditos})
        db.commit()
    return eid


def _saldo_de(fabrica, estrategia_id) -> Decimal:  # noqa: ANN001
    return ia_comun.saldo(_dueno(fabrica, estrategia_id), fabrica)


def test_sin_pro_la_pregunta_se_paga_con_creditos_y_con_pro_va_incluida(  # noqa: ANN001
        fabrica, mercado, mundo) -> None:
    ene = mundo["enero"]
    _contestar_todas(fabrica, mundo)
    de_pago = _cuenta_con_pregunta(fabrica, 10)
    foto.ejecutar(ene, fabrica=fabrica)
    formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    ins = _inscripciones(fabrica, ene)
    assert _saldo_de(fabrica, de_pago) == Decimal(9)               # un crédito por 1.000 empresas
    assert _saldo_de(fabrica, mundo["pregunta"]) == Decimal(0)     # con Pro no paga nada
    assert set(ins[de_pago]["pos"]) == set(ins[mundo["pregunta"]]["pos"]) == {"ZQA", "ZQF", "ZQB"}
    assert _cuenta(fabrica, "select count(*) from liga.formaciones_degradadas") == 0


def test_sin_saldo_juega_sin_su_pregunta_aunque_otra_cuenta_la_tenga_en_cache(  # noqa: ANN001
        fabrica, mercado, mundo) -> None:
    ene = mundo["enero"]
    _contestar_todas(fabrica, mundo)
    sin_saldo = _cuenta_con_pregunta(fabrica, 0)
    foto.ejecutar(ene, fabrica=fabrica)
    formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    ins = _inscripciones(fabrica, ene)
    assert set(ins[sin_saldo]["pos"]) != set(ins[mundo["pregunta"]]["pos"])
    assert _saldo_de(fabrica, sin_saldo) == Decimal(0)
    assert _cuenta(fabrica, "select count(*) from liga.formaciones_degradadas d "
                            "join liga.inscripciones i on i.id = d.inscripcion_id "
                            "where i.estrategia_id = :e and d.motivo = 'sin_saldo'",
                   e=sin_saldo) == 1


def test_si_faltan_respuestas_no_se_cobra_la_pregunta(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    de_pago = _cuenta_con_pregunta(fabrica, 10)       # la caché solo tiene cuatro respuestas
    foto.ejecutar(ene, fabrica=fabrica)
    formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    assert _saldo_de(fabrica, de_pago) == Decimal(10)
    assert _cuenta(fabrica, "select count(*) from liga.formaciones_degradadas d "
                            "join liga.inscripciones i on i.id = d.inscripcion_id "
                            "where i.estrategia_id = :e", e=de_pago) == 1


FIN_ENERO = datetime(2027, 1, 29, 22, 35, tzinfo=UTC)       # 17:35 NY del último día de enero


def _estado_jornada(fabrica, jornada_id: int) -> str:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        return db.execute(text("select estado from liga.jornadas where id = :j"),
                          {"j": jornada_id}).scalar()


def test_cerrar_solo_cierra_la_jornada_que_acaba_hoy_desde_las_1730(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    mercado.hasta = date(2027, 1, 29)
    assert cerrar.job(fabrica, ahora=FIN_ENERO - timedelta(minutes=10)) is None    # 17:25
    assert cerrar.job(fabrica, ahora=FIN_ENERO - timedelta(days=1)) is None        # otro día
    assert _estado_jornada(fabrica, ene) == "formada"
    hecho = cerrar.job(fabrica, ahora=FIN_ENERO)
    assert hecho is not None and hecho["estado"] == "cerrada"
    assert _estado_jornada(fabrica, ene) == "cerrada"
    assert cerrar.job(fabrica, ahora=FIN_ENERO + timedelta(minutes=5)) is None


def test_cerrar_solo_apagado_a_proposito_no_cierra(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    mercado.hasta = date(2027, 1, 29)
    with comun.sesion(fabrica) as db:
        db.execute(text("insert into liga.ajustes (clave, valor) "
                        "values ('procesos.cerrar.auto', 'false')"))
        db.commit()
    assert cerrar.job(fabrica, ahora=FIN_ENERO) is None
    assert _estado_jornada(fabrica, ene) == "formada"


def test_cerrar_solo_con_un_cierre_que_falta_no_escribe_y_avisa_pasado_el_corte(
        fabrica, mercado, mundo, monkeypatch) -> None:  # noqa: ANN001
    from app import push

    avisos: list[str] = []
    monkeypatch.setattr(push, "send_to_all", lambda db, **kw: avisos.append(kw["title"]))
    cerrar._ultimo_aviso.clear()
    ene = mundo["enero"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    avisos.clear()                                     # el de la formación no es de este test
    mercado.hasta = date(2027, 1, 29)
    entregar = mercado.descargar

    def sin_el_ultimo_de_zqb(tickers, desde):  # noqa: ANN001, ANN202
        salida = entregar(tickers, desde)
        if "ZQB" in salida:
            salida["ZQB"] = [c for c in salida["ZQB"] if c.dia < date(2027, 1, 29)]
        return salida

    monkeypatch.setattr(precios, "descargar", sin_el_ultimo_de_zqb)
    reloj = [1000.0]
    assert cerrar.job(fabrica, ahora=FIN_ENERO, reloj=lambda: reloj[0]) is None
    assert avisos == []                       # 17:35: aún no estorba, solo queda en el registro
    tarde = FIN_ENERO + timedelta(minutes=30)                                       # 18:05
    assert cerrar.job(fabrica, ahora=tarde, reloj=lambda: reloj[0]) is None
    assert avisos == ["Vennett: no se pudo cerrar la jornada"]
    reloj[0] += 300                                                # cinco minutos después
    assert cerrar.job(fabrica, ahora=tarde, reloj=lambda: reloj[0]) is None
    assert len(avisos) == 1
    assert _estado_jornada(fabrica, ene) == "formada"
    cerrar._ultimo_aviso.clear()


def test_no_se_cierra_con_un_cierre_que_falta_salvo_que_se_acepte(fabrica, mercado, mundo,  # noqa: ANN001
                                                                   monkeypatch) -> None:
    """Los resultados no se corrigen: si a un valor en cartera le falta el cierre del último día,
    cerrar con su cierre anterior fijaría un precio viejo para siempre."""
    ene = mundo["enero"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    with comun.sesion(fabrica) as db:
        dia_fin = db.execute(text("select dia_fin from liga.jornadas where id = :j"),
                             {"j": ene}).scalar()
    entregar = mercado.descargar

    def sin_el_ultimo_de_zqb(tickers, desde):  # noqa: ANN001, ANN202
        salida = entregar(tickers, desde)
        if "ZQB" in salida:                       # ZQB está en la cartera de Alpha
            salida["ZQB"] = [c for c in salida["ZQB"] if c.dia < dia_fin]
        return salida

    monkeypatch.setattr(precios, "descargar", sin_el_ultimo_de_zqb)
    mercado.hasta = dia_fin
    diario.ejecutar(fabrica)

    prev = cerrar.vista_previa(ene, fabrica=fabrica)
    assert prev["listo"] is True and prev["faltan_cierres"] == ["ZQB"]
    with pytest.raises(comun.ErrorProceso, match=r"Faltan los cierres.*ZQB"):
        cerrar.ejecutar(ene, fabrica=fabrica)
    assert _cuenta(fabrica, "select count(*) from liga.resultados") == 0

    hecho = cerrar.ejecutar(ene, fabrica=fabrica, aceptar_sin_cierre=True)
    assert hecho["estado"] == "cerrada"
    assert _cuenta(fabrica, "select count(*) from liga.auditoria where accion = 'proceso.cerrar' "
                            "and detalle->'sin_cierre_aceptado' = cast('[\"ZQB\"]' as jsonb)") == 1


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


def _foto_con_escaneo_propio(fabrica, fin: datetime) -> tuple[int, int]:  # noqa: ANN001
    """Una foto completa terminada en `fin` y un escaneo de decisión con notas que la puntuó."""
    with comun.sesion(fabrica) as db:
        nueva = Foto(alcance="nasdaq", inicio=fin - timedelta(hours=1), fin=fin, estado="completa")
        db.add(nueva)
        db.flush()
        db.add(FundamentalsSnapshot(ticker="ZQA", captured_at=fin, sector="Technology",
                                    foto_id=nueva.id))
        run = ScanRun(scan_at=fin + timedelta(minutes=15), cadence="decisión/full", decide=True,
                      foto_id=nueva.id)
        db.add(run)
        db.flush()
        db.add(ScanAudit(scan_at=run.scan_at, ticker="ZQA", scan_run_id=run.id, decide=True,
                         jev_fundamentals=900, jev_valuation=880, jev_financing=860,
                         jev_catalyst=840))
        db.commit()
        return nueva.id, run.id


def test_la_jornada_no_vale_con_una_foto_que_el_escaneo_no_uso(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        nueva = Foto(alcance="nasdaq", inicio=FOTO_FIN + timedelta(hours=2),
                     fin=FOTO_FIN + timedelta(hours=3), estado="completa")
        db.add(nueva)
        db.flush()
        db.add(FundamentalsSnapshot(ticker="ZQA", captured_at=FOTO_FIN, sector="Technology",
                                    foto_id=nueva.id))
        db.commit()
        nueva_id = nueva.id
    with pytest.raises(comun.ErrorProceso, match="la misma foto"):
        foto.ejecutar(mundo["enero"], nueva_id, fabrica=fabrica)
    with pytest.raises(comun.ErrorProceso, match="la misma foto"):
        foto.ejecutar(mundo["enero"], nueva_id, mundo["scan"], fabrica=fabrica)
    assert foto.estado(mundo["enero"], fabrica=fabrica)["foto_id"] is None


def test_la_foto_tiene_que_ser_del_dia_base_de_la_jornada(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    foto_vieja, escaneo_viejo = _foto_con_escaneo_propio(fabrica, FOTO_FIN - timedelta(days=3))
    with pytest.raises(comun.ErrorProceso, match="día base"):
        foto.ejecutar(mundo["enero"], foto_vieja, escaneo_viejo, fabrica=fabrica)
    assert foto.estado(mundo["enero"], fabrica=fabrica)["foto_id"] is None


def test_no_se_forma_si_la_foto_dejo_de_ser_la_del_escaneo(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    foto.ejecutar(ene, fabrica=fabrica)
    assert formar.vista_previa(ene, fabrica=fabrica, ahora=ENERO)["listo"] is True
    with comun.sesion(fabrica) as db:
        db.execute(text("update scan_runs set foto_id = null where id = :s"), {"s": mundo["scan"]})
        db.commit()
    prev = formar.vista_previa(ene, fabrica=fabrica, ahora=ENERO)
    assert prev["listo"] is False and "escaneo" in prev["motivos"][0]
    with pytest.raises(comun.ErrorProceso, match="escaneo"):
        formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)


def test_la_base_no_deja_fijar_una_foto_y_un_escaneo_que_no_son_pareja(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    otra_foto, _ = _foto_con_escaneo_propio(fabrica, FOTO_FIN - timedelta(days=3))
    with pytest.raises(Exception, match="los mismos"), comun.sesion(fabrica) as db:
        db.execute(text("update liga.jornadas set foto_id = :f, scan_run_id = :s where id = :j"),
                   {"f": otra_foto, "s": mundo["scan"], "j": mundo["enero"]})
        db.commit()


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


def _huecos(fabrica, jornada_id: int) -> list[tuple]:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        return [tuple(f) for f in db.execute(text(
            "select numero, ticker, entrada_dia, salida_dia, motivo from liga.omega_operaciones "
            "where jornada_id = :j order by numero, entrada_dia"), {"j": jornada_id}).all()]


def _omega_fila(fabrica, jornada_id: int) -> dict:  # noqa: ANN001
    filas = diario.tabla_provisional(jornada_id, fabrica=fabrica)["filas"]
    return next(f for f in filas if f["casa_clave"] == "omega")


def test_omega_llena_sus_huecos_con_las_alertas_y_repetir_no_duplica(fabrica, mercado,
                                                                    mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    mercado.hasta = date(2027, 1, 12)
    hecho = diario.ejecutar(fabrica)
    assert hecho["omega"][0]["nuevas"] == 4
    huecos = _huecos(fabrica, ene)
    # Mismo instante: primero la caída más fuerte (ZQB antes que ZQA); la quinta espera.
    assert [(h[0], h[1], h[2]) for h in huecos] == [
        (1, "ZQB", date(2027, 1, 5)), (2, "ZQA", date(2027, 1, 5)),
        (3, "ZQC", date(2027, 1, 6)), (4, "ZQD", date(2027, 1, 7))]
    assert all(h[3] is None for h in huecos)
    sql_aud = "select count(*) from liga.auditoria where accion = 'proceso.diario.omega'"
    n_aud = _cuenta(fabrica, sql_aud)
    diario.ejecutar(fabrica)                                  # el mismo día otra vez
    assert _huecos(fabrica, ene) == huecos
    assert _cuenta(fabrica, sql_aud) == n_aud
    assert Decimal(_omega_fila(fabrica, ene)["rentabilidad"]) != 0


def test_omega_libera_el_hueco_al_salir_y_lo_rellena_compuesto(fabrica, mercado,
                                                              mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    mercado.saltos = {"ZQA": (date(2027, 1, 14), 1.5)}         # +50 %: pasa el objetivo
    mercado.hasta = date(2027, 1, 12)
    diario.ejecutar(fabrica)
    assert len(_huecos(fabrica, ene)) == 4
    mercado.hasta = date(2027, 1, 20)
    diario.ejecutar(fabrica)
    huecos = _huecos(fabrica, ene)
    assert (2, "ZQA", date(2027, 1, 5), date(2027, 1, 14), "objetivo") in huecos
    assert (2, "ZQF", date(2027, 1, 14), None, None) in huecos   # el hueco libre, con la quinta
    diario.ejecutar(fabrica)                                  # repetir no cambia lo escrito
    assert _huecos(fabrica, ene) == huecos
    # El hueco 2 compuso el +50 % sobre 500 $ de un total de 2.000 $: más de un 10 % en total.
    assert Decimal(_omega_fila(fabrica, ene)["rentabilidad"]) > Decimal("10")


def test_omega_pasa_lo_abierto_a_la_jornada_siguiente(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    _cerrar_mes(fabrica, mercado, ene)
    assert len(_huecos(fabrica, ene)) == 4
    _formar_mes(fabrica, mercado, mundo["febrero"], FEBRERO)
    with comun.sesion(fabrica) as db:
        ops = omega.operaciones(db, db.get(Jornada, mundo["febrero"]))
    assert sorted(o.ticker for o in ops) == ["ZQA", "ZQB", "ZQC", "ZQD"]   # siguen abiertas
    assert _huecos(fabrica, mundo["febrero"]) == []


def test_la_liga_nunca_escribe_en_las_tablas_de_omega(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    tablas = ("momentum_senales", "momentum_ejecuciones", "momentum_candidatos",
              "momentum_universo", "momentum_universo_estado")
    sql_marcas = "select count(*) from momentum_senales where updated_at is not null"
    antes = {t: _cuenta(fabrica, f"select count(*) from {t}") for t in tablas}
    marcas = _cuenta(fabrica, sql_marcas)
    _formar_mes(fabrica, mercado, mundo["enero"], ENERO)
    _cerrar_mes(fabrica, mercado, mundo["enero"])
    assert {t: _cuenta(fabrica, f"select count(*) from {t}") for t in tablas} == antes
    assert _cuenta(fabrica, sql_marcas) == marcas


def test_lambda_sin_detalle_usa_los_fondeados_de_scan_audit(fabrica, mercado,
                                                            mundo) -> None:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        db.execute(text("delete from scan_run_jev_item where scan_run_id = :s"),
                   {"s": mundo["scan"]})
        db.execute(text("update scan_audit set jev_funded = true where scan_run_id = :s "
                        "and ticker in ('ZQA', 'ZQD', 'ZQF')"), {"s": mundo["scan"]})
        db.commit()
    foto.ejecutar(mundo["enero"], fabrica=fabrica)
    hecho = formar.ejecutar(mundo["enero"], fabrica=fabrica, ahora=ENERO)
    assert hecho["casa"]["lambda"]["juega"] is True
    pesos = _inscripciones(fabrica, mundo["enero"])["lambda"]["pos"]
    assert set(pesos) == {"ZQA", "ZQD", "ZQF"} and len(set(pesos.values())) == 1


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


def test_si_no_puede_designar_el_dia_base_avisa_al_admin_y_otro_dia_no(
        fabrica, mundo, monkeypatch) -> None:  # noqa: ANN001
    from app import push

    avisos: list[str] = []
    monkeypatch.setattr(push, "send_to_all", lambda db, **kw: avisos.append(kw["title"]))
    _saltar_pretemporada(fabrica, mundo)
    vieja, escaneo_viejo = _foto_con_escaneo_propio(fabrica, FOTO_FIN - timedelta(days=3))
    monkeypatch.setattr(foto, "hoy_bolsa", lambda: date(2026, 12, 15))
    assert foto.auto_desde_escaneo(escaneo_viejo, fabrica=fabrica) is None
    assert avisos == []                                    # un escaneo suelto a mitad de mes
    monkeypatch.setattr(foto, "hoy_bolsa", lambda: date(2026, 12, 31))   # día base de enero
    assert foto.auto_desde_escaneo(escaneo_viejo, fabrica=fabrica) is None
    assert avisos == ["Vennett: no se designó la foto de la jornada"]
    assert foto.estado(mundo["enero"], fabrica=fabrica)["foto_id"] is None


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
    _asegurar_foto_del_dia_base(fabrica, mundo["febrero"])
    foto.ejecutar(mundo["febrero"], fabrica=fabrica)
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


def test_un_fallo_puntual_de_la_fuente_no_deja_un_valor_sin_precio(fabrica, mercado, mundo,
                                                                   monkeypatch) -> None:  # noqa: ANN001
    """Un valor cuya primera descarga falla se reintenta antes de darlo por sin precio: la
    jornada, una vez formada, ya no se corrige."""
    ene = mundo["enero"]
    entregar = mercado.descargar
    fallos = {"ZQA": 1}                        # ZQA no llega a la primera

    def con_un_fallo(tickers, desde):  # noqa: ANN001, ANN202
        salida = entregar(tickers, desde)
        if fallos.get("ZQA") and "ZQA" in salida:
            fallos["ZQA"] -= 1
            del salida["ZQA"]
        return salida

    monkeypatch.setattr(precios, "descargar", con_un_fallo)
    foto.ejecutar(ene, fabrica=fabrica)
    hecho = formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    assert hecho["sin_precio"] == ["ZQL"]                     # solo la que de verdad no tiene
    assert "ZQA" in _inscripciones(fabrica, ene)["lambda"]["pos"]


def test_si_la_fuente_esta_caida_no_se_forma_la_jornada(fabrica, mercado, mundo,
                                                        monkeypatch) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    entregar = mercado.descargar

    def caida(tickers, desde):  # noqa: ANN001, ANN202
        salida = entregar(tickers, desde)
        return {t: v for t, v in salida.items() if t == "SPY"}    # solo el SPY llega

    monkeypatch.setattr(precios, "descargar", caida)
    foto.ejecutar(ene, fabrica=fabrica)
    with pytest.raises(comun.ErrorProceso, match="fuente de precios no responde"):
        formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    assert _cuenta(fabrica, "select count(*) from liga.inscripciones") == 0


def test_una_cuenta_suspendida_no_se_inscribe_en_la_jornada(fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    with comun.sesion(fabrica) as db:
        db.execute(text(
            "delete from liga.roles_usuario where rol = 'usuario' and usuario_id = "
            "(select dueno_id from liga.estrategias where id = :e)"), {"e": mundo["reglas"]})
        db.commit()
    foto.ejecutar(ene, fabrica=fabrica)
    formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    assert set(_inscripciones(fabrica, ene)) == {"alpha", "omega", "lambda"}


def test_al_formar_se_guarda_cual_optaba_al_premio_y_se_completa_la_que_faltaba(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    with comun.sesion(fabrica) as db:
        sola = _estrategia(db, _usuario(db), "Sola")
        db.execute(text("update liga.estrategias set opta_premio = true where id = :e"),
                   {"e": mundo["pregunta"]})
        db.commit()
    foto.ejecutar(ene, fabrica=fabrica)
    formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    optaban = {k for k, v in _inscripciones(fabrica, ene).items() if v["fila"].optaba_premio}
    assert optaban == {mundo["pregunta"], sola}


def test_para_probar_vale_un_escaneo_con_notas_aunque_no_sea_de_decision(fabrica, mundo) -> None:  # noqa: ANN001
    """Antes de que llegue el escaneo de decisión del mes, el editor prueba con el último escaneo
    que tenga notas de Jev; la jornada oficial sigue exigiendo uno de decisión."""
    from app.liga import estrategias
    from app.liga.procesos import foto as foto_proceso
    from app.liga.procesos.comun import ErrorProceso

    db = fabrica()
    db.execute(text("update scan_runs set decide = false"))
    db.execute(text("update scan_audit set decide = false"))
    db.commit()
    # Oficial: ya no hay escaneo de decisión con notas.
    with pytest.raises(ErrorProceso):
        foto_proceso._escaneo(db, foto_proceso._foto(db, None), None)
    # Para probar: sí, y avisa de qué escaneo son las notas.
    ctx = estrategias._contexto_desde(db, None)
    assert ctx.notas and ctx.empresas
    assert ctx.plan_b is True
    db.close()


def test_sin_ningun_escaneo_con_notas_sigue_sin_poder_probar(fabrica, mundo) -> None:  # noqa: ANN001
    from fastapi import HTTPException

    from app.liga import estrategias

    db = fabrica()
    db.execute(text("update scan_audit set jev_fundamentals = null"))
    db.commit()
    with pytest.raises(HTTPException) as e:
        estrategias._contexto_desde(db, None)
    assert "Todavía no hay datos de este mes" in e.value.detail
    db.close()


def test_contador_de_apuntadas_solo_cuenta_las_de_usuario(  # noqa: ANN001
        fabrica, mundo, monkeypatch) -> None:
    """La portada enseña cuántas estrategias hay apuntadas a la próxima jornada: solo el número."""
    from app.liga import estrategias

    monkeypatch.setattr(estrategias, "fabrica_sistema", fabrica)
    estrategias.olvidar_apuntadas()
    db = fabrica()
    esperadas = db.execute(text(
        "select count(*) from liga.estrategias where tipo = 'usuario' and estado = 'apuntada'"
    )).scalar_one()
    db.close()
    assert esperadas >= 1
    assert estrategias.contar_apuntadas() == esperadas
    estrategias.olvidar_apuntadas()


def _interruptor_formar(fabrica, encendido: bool | None) -> None:  # noqa: ANN001
    """None borra la fila (queda el valor por defecto: encendido)."""
    with comun.sesion(fabrica) as db:
        if encendido is None:
            db.execute(text("delete from liga.ajustes where clave = 'procesos.formar.auto'"))
        else:
            db.execute(text("""
                insert into liga.ajustes (clave, valor)
                values ('procesos.formar.auto', cast(:v as jsonb))
                on conflict (clave) do update set valor = excluded.valor
            """), {"v": "true" if encendido else "false"})
        db.commit()


def _dar_por_jugadas_las_anteriores(fabrica, jornada_id: int) -> None:  # noqa: ANN001
    """Como en producción: al tocar la siguiente, las previas ya se formaron y cerraron."""
    with comun.sesion(fabrica) as db:
        db.execute(text(
            "update liga.jornadas set estado = 'cerrada', sp_rentabilidad = 0 where dia_fin <= "
            "(select dia_base from liga.jornadas where id = :j) and estado <> 'cerrada'"),
            {"j": jornada_id})
        db.commit()


def test_formar_solo_esta_encendido_por_defecto_y_se_apaga_a_proposito(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    foto.ejecutar(ene, fabrica=fabrica)
    tras_el_corte = CORTE_ENERO + timedelta(minutes=5)
    _interruptor_formar(fabrica, False)
    assert formar.job(fabrica, ahora=tras_el_corte) is None       # apagado a propósito
    assert _cuenta(fabrica, "select count(*) from liga.inscripciones") == 0
    _interruptor_formar(fabrica, None)                            # sin fila: encendido
    hecho = formar.job(fabrica, ahora=tras_el_corte)
    assert hecho is not None and hecho["estado"] == "formada"


def test_formar_solo_no_hace_nada_antes_del_corte_ni_pasada_la_jornada(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    foto.ejecutar(ene, fabrica=fabrica)
    # Antes del corte (17:55 ET): no es un fallo, simplemente todavía no toca.
    assert formar.job(fabrica, ahora=CORTE_ENERO - timedelta(minutes=5)) is None
    # Una jornada ya terminada no se forma sola aunque siga programada.
    assert formar.job(fabrica, ahora=datetime(2027, 2, 1, 15, tzinfo=UTC)) is None
    assert _cuenta(fabrica, "select count(*) from liga.inscripciones") == 0
    assert _cuenta(fabrica, "select count(*) from liga.auditoria where accion like '%fallo%'") == 0


def test_no_se_forma_con_la_jornada_anterior_sin_cerrar(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    foto.ejecutar(ene, fabrica=fabrica)
    with comun.sesion(fabrica) as db:
        db.execute(text(
            "update liga.jornadas set estado = 'formada' where dia_fin = "
            "(select dia_base from liga.jornadas where id = :j)"), {"j": ene})
        db.commit()
    prev = formar.vista_previa(ene, fabrica=fabrica, ahora=ENERO)
    assert prev["listo"] is False and "anterior" in prev["motivos"][0]
    with pytest.raises(comun.ErrorProceso, match="anterior"):
        formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    with comun.sesion(fabrica) as db:
        db.execute(text("update liga.jornadas set estado = 'cerrada', sp_rentabilidad = 0 "
                        "where estado = 'formada'"))
        db.commit()
    assert formar.vista_previa(ene, fabrica=fabrica, ahora=ENERO)["listo"] is True


def test_formar_solo_forma_cualquier_jornada_lista_aunque_pase_el_tiempo_y_no_duplica(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene = mundo["enero"]
    foto.ejecutar(ene, fabrica=fabrica)
    # Una comprobación 20 minutos después del corte (p. ej. tras un reinicio) la forma igual.
    hecho = formar.job(fabrica, ahora=CORTE_ENERO + timedelta(minutes=20))
    assert hecho is not None and hecho["estado"] == "formada"
    assert _cuenta(fabrica, "select count(*) from liga.inscripciones") > 0
    # Repetirlo no duplica: la jornada ya no está programada.
    assert formar.job(fabrica, ahora=CORTE_ENERO + timedelta(minutes=25)) is None


def test_si_falta_la_foto_avisa_una_vez_por_media_hora_y_no_cada_cinco_minutos(
        fabrica, mercado, mundo, monkeypatch) -> None:  # noqa: ANN001
    from app import push

    avisos: list[str] = []
    monkeypatch.setattr(push, "send_to_all", lambda db, **kw: avisos.append(kw["title"]))
    formar._ultimo_aviso.clear()
    _dar_por_jugadas_las_anteriores(fabrica, mundo["enero"])
    despues = CORTE_ENERO + timedelta(minutes=5)                 # corte pasado, pero sin foto
    reloj = [1000.0]
    assert formar.job(fabrica, ahora=despues, reloj=lambda: reloj[0]) is None
    reloj[0] += 300                                              # cinco minutos después
    assert formar.job(fabrica, ahora=despues, reloj=lambda: reloj[0]) is None
    assert len(avisos) == 1
    reloj[0] += 1800                                             # y pasada la media hora
    assert formar.job(fabrica, ahora=despues, reloj=lambda: reloj[0]) is None
    assert len(avisos) == 2
    formar._ultimo_aviso.clear()


def test_no_hay_reintentos_infinitos_pasada_media_hora_avisa_una_vez_y_deja_de_intentar(
        fabrica, mercado, mundo, monkeypatch) -> None:  # noqa: ANN001
    from app import push

    avisos: list[str] = []
    monkeypatch.setattr(push, "send_to_all", lambda db, **kw: avisos.append(kw["title"]))
    formar._ultimo_aviso.clear()
    formar._abandonadas_avisadas.clear()
    foto.ejecutar(mundo["enero"], fabrica=fabrica)
    _dar_por_jugadas_las_anteriores(fabrica, mundo["enero"])
    tarde = CORTE_ENERO + timedelta(minutes=40)                  # más de media hora después
    assert formar.job(fabrica, ahora=tarde) is None
    assert formar.job(fabrica, ahora=tarde + timedelta(minutes=5)) is None
    assert avisos == ["Vennett: la jornada no se formó sola"]          # una sola vez
    assert _cuenta(fabrica, "select count(*) from liga.inscripciones") == 0   # y no la formó
    formar._abandonadas_avisadas.clear()


# ---- los avisos a las cuentas -----------------------------------------------------------------


@pytest.fixture
def empujes(monkeypatch) -> list:  # noqa: ANN001
    """Los push que saldrían: (endpoint, contenido). Sin salir a ninguna red."""
    from app import push

    enviados: list = []

    def falso(endpoint, p256dh, auth, payload):  # noqa: ANN001, ANN202
        enviados.append((endpoint, json.loads(payload)))
        return "ok"

    monkeypatch.setattr(push, "enviar", falso)
    return enviados


def _suscribir(fabrica, uid: str) -> str:  # noqa: ANN001
    from app.liga import avisos

    endpoint = f"https://fcm.googleapis.com/fcm/send/{uuid.uuid4().hex}"
    avisos.suscribir(uid, {"endpoint": endpoint, "keys": {"p256dh": "p", "auth": "a"}},
                     fabrica=fabrica)
    return endpoint


def test_suscribir_valida_limita_y_pasa_el_dispositivo_a_quien_lo_activa(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    from app.liga import avisos

    uid = _dueno(fabrica, mundo["reglas"])
    with pytest.raises(ValueError):
        avisos.suscribir(uid, {"endpoint": "https://169.254.169.254/x",
                               "keys": {"p256dh": "p", "auth": "a"}}, fabrica=fabrica)
    with pytest.raises(ValueError):
        avisos.suscribir(uid, {"endpoint": "https://fcm.googleapis.com/fcm/send/z", "keys": {}},
                         fabrica=fabrica)
    puestos = [_suscribir(fabrica, uid) for _ in range(avisos.MAX_DISPOSITIVOS)]
    assert avisos.dispositivos(uid, fabrica) == puestos
    with pytest.raises(avisos.DemasiadosDispositivos):
        _suscribir(fabrica, uid)

    otro = str(uuid.uuid4())
    with comun.sesion(fabrica) as db:
        db.execute(text("insert into auth.users (id, email, email_confirmed_at) "
                        "values (:i, :e, now())"), {"i": otro, "e": f"{otro[:12]}@prueba.local"})
        db.commit()
    avisos.suscribir(otro, {"endpoint": puestos[0], "keys": {"p256dh": "q", "auth": "b"}},
                     fabrica=fabrica)
    assert avisos.dispositivos(otro, fabrica) == [puestos[0]]
    assert puestos[0] not in avisos.dispositivos(uid, fabrica)
    avisos.dar_de_baja(otro, puestos[0], fabrica)
    assert avisos.dispositivos(otro, fabrica) == []


def test_el_aviso_sale_en_el_idioma_de_la_cuenta_y_poda_lo_que_el_navegador_dio_de_baja(
        fabrica, mercado, mundo, monkeypatch, empujes) -> None:  # noqa: ANN001
    from app import push
    from app.liga import avisos

    uid = _dueno(fabrica, mundo["reglas"])
    viva, muerta = _suscribir(fabrica, uid), _suscribir(fabrica, uid)
    cierra = datetime(2027, 1, 4, 14, 0, tzinfo=UTC)               # 15:00 en Madrid
    with comun.sesion(fabrica) as db:
        assert avisos.avisar(db, uid, "cartera_lista", cierra=cierra) == 2
    assert {e for e, _ in empujes} == {viva, muerta}
    c = empujes[0][1]
    assert c["title"] == "Tu cartera está lista"
    assert c["body"] == "Puedes cambiar empresas hasta el 4 de enero a las 15:00."
    assert c["url"] == "/mias" and c["tag"] == "vennett-cartera_lista"

    empujes.clear()
    with comun.sesion(fabrica) as db:
        db.execute(text("insert into liga.perfiles_privados (id, idioma) values (:u, 'en') "
                        "on conflict (id) do update set idioma = 'en'"), {"u": uid})
        db.commit()
        avisos.avisar(db, uid, "cartera_lista", cierra=cierra)
    assert empujes[0][1]["body"] == "You can swap companies until January 4 at 15:00."

    monkeypatch.setattr(push, "enviar", lambda e, p, a, c: "baja" if e == muerta else "ok")
    with comun.sesion(fabrica) as db:
        assert avisos.avisar(db, uid, "empieza") == 1
    assert avisos.dispositivos(uid, fabrica) == [viva]


def test_al_formar_se_avisa_de_la_cartera_y_de_lo_que_jugo_sin_su_pregunta(
        fabrica, mercado, mundo, empujes) -> None:  # noqa: ANN001
    uid = _dueno(fabrica, mundo["reglas"])
    suya = _suscribir(fabrica, uid)
    _formar_mes(fabrica, mercado, mundo["enero"], ENERO)

    titulos = [c["title"] for e, c in empujes if e == suya]
    assert titulos.count("Tu cartera está lista") == 1         # una por cuenta, no por estrategia
    assert "Jugó sin su pregunta" in titulos
    sin = next(c for _, c in empujes if c["title"] == "Jugó sin su pregunta")
    assert "Con pregunta" in sin["body"]


def test_los_recordatorios_salen_una_vez_por_jornada_y_en_su_hora(
        fabrica, mercado, mundo, empujes) -> None:  # noqa: ANN001
    from app.liga import avisos

    ene, uid = mundo["enero"], _dueno(fabrica, mundo["reglas"])
    _suscribir(fabrica, uid)
    _formar_mes(fabrica, mercado, ene, ENERO)
    empujes.clear()
    cierra = datetime(2027, 1, 4, 14, 0, tzinfo=UTC)              # 09:00 NY del día 4
    assert avisos.job(fabrica, ahora=cierra - timedelta(hours=2)) == {
        "sin_creditos": 0, "cambios_cierran": 0, "empieza": 0}
    assert avisos.job(fabrica, ahora=cierra - timedelta(minutes=30))["cambios_cierran"] == 1
    assert [c["title"] for _, c in empujes] == ["Los cambios se cierran en una hora"]
    assert avisos.job(fabrica, ahora=cierra - timedelta(minutes=25))["cambios_cierran"] == 0

    empujes.clear()
    abre = datetime(2027, 1, 4, 14, 35, tzinfo=UTC)               # 09:35 NY
    assert avisos.job(fabrica, ahora=abre)["empieza"] == 1
    assert [c["title"] for _, c in empujes] == ["Empieza la jornada"]
    assert avisos.job(fabrica, ahora=abre + timedelta(minutes=5))["empieza"] == 0
    assert avisos.job(fabrica, ahora=abre + timedelta(hours=3))["empieza"] == 0


def test_tres_dias_antes_del_corte_se_avisa_a_quien_no_le_alcanzan_los_creditos(
        fabrica, mercado, mundo, empujes, monkeypatch) -> None:  # noqa: ANN001
    from app.liga import avisos, estrategias

    monkeypatch.setattr(estrategias, "fabrica_sistema", fabrica)
    sin_saldo, con_saldo = _cuenta_con_pregunta(fabrica, 0), _cuenta_con_pregunta(fabrica, 10)
    for e in (sin_saldo, con_saldo, mundo["pregunta"]):
        _suscribir(fabrica, _dueno(fabrica, e))
    corte = _cuenta(fabrica, "select cierre_inscripcion from liga.jornadas where id = :j",
                    j=mundo["enero"])
    assert avisos.job(fabrica, ahora=corte - timedelta(days=4))["sin_creditos"] == 0
    assert avisos.job(fabrica, ahora=corte - timedelta(days=2))["sin_creditos"] == 1
    assert [c["title"] for _, c in empujes] == ["Tu pregunta no tiene créditos"]
    assert avisos.job(fabrica, ahora=corte - timedelta(days=1))["sin_creditos"] == 0
    assert avisos.job(fabrica, ahora=corte + timedelta(hours=1))["sin_creditos"] == 0


# ---- la ventana de cambios: Cambiar y Recuperar hasta las 09:00 NY del día 1 -------------------

VENTANA_ENERO = datetime(2027, 1, 3, 12, tzinfo=UTC)          # tras el corte, antes del día 4 09:00
JORNADA_ABIERTA = datetime(2027, 1, 4, 14, 5, tzinfo=UTC)     # 09:05 NY del día 4
VENTANA_FEBRERO = datetime(2027, 1, 31, 12, tzinfo=UTC)


def _dueno(fabrica, estrategia_id) -> str:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        return db.execute(text("select dueno_id::text from liga.estrategias where id = :e"),
                          {"e": estrategia_id}).scalar()


def _cartera_de(fabrica, jornada_id: int, estrategia_id) -> dict:  # noqa: ANN001
    return _inscripciones(fabrica, jornada_id)[estrategia_id]["pos"]


def _receta_de_la_inscripcion(fabrica, jornada_id: int, estrategia_id) -> int:  # noqa: ANN001
    return _inscripciones(fabrica, jornada_id)[estrategia_id]["fila"].receta_id


def test_cambiar_en_la_ventana_sustituye_la_empresa_y_recuperar_la_devuelve(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene, eid = mundo["enero"], mundo["reglas"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    uid, formada = _dueno(fabrica, eid), _cartera_de(fabrica, ene, eid)
    original = _receta_de_la_inscripcion(fabrica, ene, eid)
    sale = sorted(formada)[0]

    receta = cambios.aplicar(uid, eid, sale, True, fabrica=fabrica, ahora=VENTANA_ENERO)

    cambiada = _cartera_de(fabrica, ene, eid)
    assert sale in receta["excluidas"] and sale not in cambiada
    assert len(cambiada) == len(formada) and set(formada) - {sale} <= set(cambiada)
    assert _receta_de_la_inscripcion(fabrica, ene, eid) == receta["id"] != original
    assert _cuenta(fabrica, "select count(*) from liga.estrategias "
                            "where id = :e and receta_id = :r", e=eid, r=receta["id"]) == 1
    cambios.aplicar(uid, eid, sale, False, fabrica=fabrica, ahora=VENTANA_ENERO)
    assert _cartera_de(fabrica, ene, eid) == formada


def test_volver_a_la_formacion_deshace_lo_cambiado_en_la_ventana(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene, eid = mundo["enero"], mundo["reglas"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    uid, formada = _dueno(fabrica, eid), _cartera_de(fabrica, ene, eid)
    original = _receta_de_la_inscripcion(fabrica, ene, eid)
    for ticker in sorted(formada)[:2]:
        cambios.aplicar(uid, eid, ticker, True, fabrica=fabrica, ahora=VENTANA_ENERO)
    assert _cartera_de(fabrica, ene, eid) != formada

    receta = cambios.volver_a_la_formacion(uid, eid, fabrica=fabrica, ahora=VENTANA_ENERO)

    assert receta["id"] == original and _receta_de_la_inscripcion(fabrica, ene, eid) == original
    assert _cartera_de(fabrica, ene, eid) == formada
    with comun.sesion(fabrica) as db:
        v = cambios.ventana_de(db, eid, VENTANA_ENERO)
    assert cambios.detalle(v, fabrica)["quitadas_formacion"] == []


def test_la_ventana_solo_existe_entre_el_corte_y_la_apertura_y_solo_para_su_dueno(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    from fastapi import HTTPException

    ene, eid = mundo["enero"], mundo["reglas"]
    foto.ejecutar(ene, fabrica=fabrica)
    uid = _dueno(fabrica, eid)
    with comun.sesion(fabrica) as db:
        assert cambios.ventana_de(db, eid, CORTE_ENERO - timedelta(hours=1)) is None
        assert cambios.ventana_de(db, eid, CORTE_ENERO + timedelta(minutes=5)).fase == "formando"
    with pytest.raises(HTTPException) as e:
        cambios.aplicar(uid, eid, "ZQA", True, fabrica=fabrica,
                        ahora=CORTE_ENERO + timedelta(minutes=5))
    assert e.value.status_code == 409                      # aún se está formando

    formar.ejecutar(ene, fabrica=fabrica, ahora=ENERO)
    with comun.sesion(fabrica) as db:
        v = cambios.ventana_de(db, eid, VENTANA_ENERO)
        assert v.fase == "cambios" and v.cierra == datetime(2027, 1, 4, 14, 0, tzinfo=UTC)
        with pytest.raises(HTTPException) as bloqueo:
            cambios.exigir_fuera_de_la_ventana(db, eid, VENTANA_ENERO)
        assert bloqueo.value.status_code == 409
    with comun.sesion(fabrica) as db:
        assert cambios.ventana_de(db, eid, JORNADA_ABIERTA) is None
    with pytest.raises(HTTPException) as e:
        cambios.aplicar(uid, eid, "ZQA", True, fabrica=fabrica, ahora=JORNADA_ABIERTA)
    assert e.value.status_code == 409                      # ya empezó
    with pytest.raises(HTTPException) as e:
        cambios.aplicar(str(uuid.uuid4()), eid, "ZQA", True, fabrica=fabrica, ahora=VENTANA_ENERO)
    assert e.value.status_code == 404                      # no es suya


def test_cambiar_en_una_que_se_mantiene_pone_la_siguiente_con_el_mismo_peso(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene, feb, eid = mundo["enero"], mundo["febrero"], mundo["mantener"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    _cerrar_mes(fabrica, mercado, ene)
    _formar_mes(fabrica, mercado, feb, FEBRERO)
    uid, formada = _dueno(fabrica, eid), _cartera_de(fabrica, feb, eid)
    sale = sorted(formada)[0]

    cambios.aplicar(uid, eid, sale, True, fabrica=fabrica, ahora=VENTANA_FEBRERO)

    cambiada = _cartera_de(fabrica, feb, eid)
    entra = set(cambiada) - set(formada)
    assert sale not in cambiada and len(entra) == 1
    assert cambiada[entra.pop()] == formada[sale]
    cambios.aplicar(uid, eid, sale, False, fabrica=fabrica, ahora=VENTANA_FEBRERO)
    assert _cartera_de(fabrica, feb, eid) == formada


def _receta_con(fabrica, estrategia_id, *, quitadas: list[str], n_empresas: int) -> int:  # noqa: ANN001
    """Una versión nueva de la receta vigente con otras quitadas y otro tamaño de cartera."""
    with comun.sesion(fabrica) as db:
        nueva = db.execute(text("""
            insert into liga.recetas (estrategia_id, idea, reglas, excluidas, catalogo_version,
              pregunta, peso_negocio, peso_precio, peso_deuda, peso_pronto, peso_pregunta,
              n_empresas, reparto, max_por_sector)
            select estrategia_id, idea, reglas, :q, catalogo_version, pregunta, peso_negocio,
                   peso_precio, peso_deuda, peso_pronto, peso_pregunta, :n, reparto, max_por_sector
            from liga.recetas where id = (select receta_id from liga.estrategias where id = :e)
            returning id"""), {"q": quitadas, "n": n_empresas, "e": estrategia_id}).scalar()
        db.execute(text("update liga.estrategias set receta_id = :r where id = :e"),
                   {"r": nueva, "e": estrategia_id})
        db.commit()
    return nueva


def test_si_cambia_la_configuracion_la_formacion_vacia_las_quitadas_y_lo_apunta(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene, feb, eid = mundo["enero"], mundo["febrero"], mundo["reglas"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    cambiada = _receta_con(fabrica, eid, quitadas=["ZQB"], n_empresas=3)   # antes eran 5
    _cerrar_mes(fabrica, mercado, ene)
    _formar_mes(fabrica, mercado, feb, FEBRERO)

    usada = _receta_de_la_inscripcion(fabrica, feb, eid)
    assert usada != cambiada
    with comun.sesion(fabrica) as db:
        fila = db.execute(text("select excluidas, n_empresas from liga.recetas where id = :r"),
                          {"r": usada}).one()
        vigente = db.execute(text("select receta_id from liga.estrategias where id = :e"),
                             {"e": eid}).scalar()
    assert list(fila.excluidas) == [] and fila.n_empresas == 3
    assert vigente == usada
    assert _cuenta(fabrica, "select count(*) from liga.formaciones_degradadas d join "
                            "liga.inscripciones i on i.id = d.inscripcion_id where "
                            "i.jornada_id = :j and d.motivo = 'quitadas_vaciadas'", j=feb) == 1


def test_si_la_configuracion_sigue_igual_las_quitadas_se_aplican(
        fabrica, mercado, mundo) -> None:  # noqa: ANN001
    ene, feb, eid = mundo["enero"], mundo["febrero"], mundo["reglas"]
    _formar_mes(fabrica, mercado, ene, ENERO)
    misma = _receta_con(fabrica, eid, quitadas=["ZQA"], n_empresas=5)       # como las 5 de antes
    _cerrar_mes(fabrica, mercado, ene)
    _formar_mes(fabrica, mercado, feb, FEBRERO)

    assert _receta_de_la_inscripcion(fabrica, feb, eid) == misma
    assert "ZQA" not in _cartera_de(fabrica, feb, eid)
    assert _cuenta(fabrica, "select count(*) from liga.formaciones_degradadas d join "
                            "liga.inscripciones i on i.id = d.inscripcion_id where "
                            "i.jornada_id = :j and d.motivo = 'quitadas_vaciadas'", j=feb) == 0


# ---- el premio anual -----------------------------------------------------------------------------


def _cerrar_la_temporada_con(fabrica, resultados: dict[str, list[str | None]]) -> int:  # noqa: ANN001
    """Cierra a mano la temporada que cuenta: cada cuenta con la rentabilidad (en %) de sus 12
    jornadas, `None` donde no jugó. Todas optan al premio con su única estrategia."""
    with comun.sesion(fabrica) as db:
        tid = db.execute(text("select id from liga.temporadas where cuenta order by id "
                              "limit 1")).scalar()
        jornadas = dict(db.execute(text("select numero, id from liga.jornadas "
                                        "where temporada_id = :t"), {"t": tid}).all())
        for nombre, mensuales in resultados.items():
            eid = _estrategia(db, _usuario(db), nombre)
            receta = db.execute(text("select receta_id from liga.estrategias where id = :e"),
                                {"e": eid}).scalar()
            for numero, rentabilidad in enumerate(mensuales, start=1):
                if rentabilidad is None:
                    continue
                iid = db.execute(text(
                    "insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, "
                    "estado, optaba_premio) values (:j, :e, :r, 'cerrada', true) returning id"),
                    {"j": jornadas[numero], "e": eid, "r": receta}).scalar()
                db.execute(text("insert into liga.resultados (inscripcion_id, rentabilidad, "
                                "puntos) values (:i, :r, 1)"),
                           {"i": iid, "r": Decimal(rentabilidad)})
        db.execute(text("update liga.jornadas set estado = 'cerrada', sp_rentabilidad = 1 "
                        "where temporada_id = :t"), {"t": tid})
        db.execute(text("update liga.temporadas set estado = 'cerrada' where id = :t"), {"t": tid})
        db.commit()
    return tid


def _ajustar_umbrales(fabrica, basico: int, completo: int) -> None:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        for clave, valor in (("premio.umbral_basico", basico),
                             ("premio.umbral_completo", completo)):
            db.execute(text("insert into liga.ajustes (clave, valor) "
                            "values (:c, cast(:v as jsonb))"), {"c": clave, "v": str(valor)})
        db.commit()


def _filas_del_premio(fabrica, tid: int) -> dict:  # noqa: ANN001
    with comun.sesion(fabrica) as db:
        return {f.nombre: f for f in db.execute(text(
            "select e.nombre, p.jornadas_jugadas, p.rentabilidad, p.puesto, p.importe "
            "from liga.premios p join liga.estrategias e on e.dueno_id = p.usuario_id "
            "where p.temporada_id = :t"), {"t": tid}).all()}


def test_el_premio_se_calcula_al_cerrar_la_temporada_con_empates_y_sin_los_no_elegibles(
        fabrica, mundo) -> None:  # noqa: ANN001
    from app.liga.procesos import premio

    _ajustar_umbrales(fabrica, 2, 4)
    tid = _cerrar_la_temporada_con(fabrica, {
        "A": ["5"] * 12, "B": ["5"] * 12,                 # empatadas en el 1.º
        "C": ["3"] * 10 + [None, None],                   # diez jornadas: elegible
        "D": ["50"] * 9 + [None] * 3,                     # nueve: no es elegible
        "E": ["-1"] * 12})
    hecho = premio.calcular(tid, fabrica)
    assert (hecho["elegibles"], hecho["escalon"], hecho["con_premio"]) == (4, 2, 3)
    filas = _filas_del_premio(fabrica, tid)
    assert set(filas) == {"A", "B", "C", "E"}
    assert [(filas[n].puesto, filas[n].importe) for n in ("A", "B")] == [(1, Decimal("225.00"))] * 2
    assert (filas["C"].puesto, filas["C"].importe, filas["C"].jornadas_jugadas) == (
        3, Decimal("50.00"), 10)
    assert float(filas["C"].rentabilidad) == pytest.approx((1.03 ** 10 - 1) * 100, abs=1e-3)
    assert (filas["E"].puesto, filas["E"].importe) == (None, None)
    assert _cuenta(fabrica, "select escalon from liga.premios_temporada where temporada_id = :t",
                   t=tid) == 2


def test_sin_cuentas_suficientes_no_se_activa_pero_queda_el_resultado(
        fabrica, mundo) -> None:  # noqa: ANN001
    from app.liga.procesos import premio

    tid = _cerrar_la_temporada_con(fabrica, {"A": ["5"] * 12, "B": ["2"] * 11 + [None]})
    assert premio.calcular(tid, fabrica)["escalon"] == 0
    filas = _filas_del_premio(fabrica, tid)
    assert len(filas) == 2 and all(f.puesto is None for f in filas.values())


def test_el_premio_no_se_calcula_con_la_temporada_abierta_y_repetirlo_no_cambia_nada(
        fabrica, mundo) -> None:  # noqa: ANN001
    from app.liga.procesos import premio

    tid = _cerrar_la_temporada_con(fabrica, {"A": ["5"] * 12})
    with comun.sesion(fabrica) as db:
        db.execute(text("update liga.temporadas set estado = 'en_juego' where id = :t"),
                   {"t": tid})
        db.commit()
    with pytest.raises(comun.ErrorProceso):
        premio.calcular(tid, fabrica)
    assert premio.job(fabrica) == []
    with comun.sesion(fabrica) as db:
        db.execute(text("update liga.temporadas set estado = 'cerrada' where id = :t"),
                   {"t": tid})
        db.commit()
    assert premio.job(fabrica) == [tid]
    assert premio.calcular(tid, fabrica) == {"temporada_id": tid, "ya_calculado": True}
    assert premio.job(fabrica) == []
    assert _cuenta(fabrica, "select count(*) from liga.premios where temporada_id = :t",
                   t=tid) == 1


def test_la_pretemporada_no_cuenta_para_el_premio(fabrica, mundo) -> None:  # noqa: ANN001
    from app.liga.procesos import premio

    with comun.sesion(fabrica) as db:
        db.execute(text("update liga.temporadas set estado = 'cerrada' where not cuenta"))
        db.commit()
    assert premio.job(fabrica) == []


def test_el_estado_publico_del_premio_va_oculto_y_luego_abierto_y_calculado(
        fabrica, mundo) -> None:  # noqa: ANN001
    from app.liga.procesos import premio

    assert premio.estado_publico(fabrica) == {"visible": False}
    with comun.sesion(fabrica) as db:
        db.execute(text("insert into liga.ajustes (clave, valor) "
                        "values ('premio.visible', 'true')"))
        db.execute(text("select liga.completar_premio()"))
        db.commit()
    abierto = premio.estado_publico(fabrica)
    assert (abierto["visible"], abierto["calculado"], abierto["escalon"]) == (True, False, 0)
    assert abierto["cuentas"] == 1                       # la cuenta de `mundo`, con su estrategia

    _ajustar_umbrales(fabrica, 1, 2)
    tid = _cerrar_la_temporada_con(fabrica, {"A": ["5"] * 12, "B": ["4"] * 11 + [None]})
    premio.calcular(tid, fabrica)
    cerrado = premio.estado_publico(fabrica)
    assert (cerrado["calculado"], cerrado["cuentas"], cerrado["escalon"]) == (True, 2, 2)
    assert (cerrado["umbral_basico"], cerrado["umbral_completo"]) == (1, 2)


def test_el_admin_ve_el_reparto_con_el_correo_solo_de_quien_cobra(fabrica, mundo) -> None:  # noqa: ANN001
    from app.liga.procesos import premio

    _ajustar_umbrales(fabrica, 1, 3)
    tid = _cerrar_la_temporada_con(fabrica, {"A": ["6"] * 12, "B": ["3"] * 12, "C": ["1"] * 12,
                                             "D": ["-2"] * 12})
    antes = premio.estado_admin(fabrica=fabrica)
    assert antes["temporada_id"] is None and antes["filas"] == []
    premio.calcular(tid, fabrica)
    estado = premio.estado_admin(fabrica=fabrica)
    assert estado["temporada_id"] == tid
    assert [t["calculado"] for t in estado["temporadas"] if t["id"] == tid] == [True]
    assert [(f["puesto"], f["importe"] is not None, f["email"] is not None)
            for f in estado["filas"]] == [(1, True, True), (2, True, True), (3, True, True),
                                          (None, False, False)]
    assert estado["filas"][0]["rentabilidad"] > estado["filas"][-1]["rentabilidad"]
