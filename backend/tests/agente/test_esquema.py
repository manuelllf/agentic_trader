"""Modelos frente al esquema real y reglas de la base (solo añadir, únicos, foto de cartera)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import (
    ARRAY,
    Boolean,
    Date,
    DateTime,
    Integer,
    Numeric,
    String,
    Text,
    inspect,
    text,
)
from sqlalchemy.dialects.postgresql import JSON, JSONB
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.agente.base import Base, con_actor
from app.agente.models import (
    Decision,
    Ejecucion,
    Ejecutada,
    Estado,
    Evento,
    Gasto,
    MovimientoCaja,
    Orden,
    PlaybookVersion,
    Precio,
    Seguimiento,
    Split,
)

NY = ZoneInfo("America/New_York")


def _familia(tipo: object) -> str:
    if isinstance(tipo, Boolean):
        return "bool"
    if isinstance(tipo, Integer):  # incluye SmallInteger y BigInteger
        return "entero"
    if isinstance(tipo, Numeric):
        return "numerico"
    if isinstance(tipo, DateTime):
        return "fechahora"
    if isinstance(tipo, Date):
        return "fecha"
    if isinstance(tipo, (JSON, JSONB)):
        return "json"
    if isinstance(tipo, ARRAY):
        return "array"
    if isinstance(tipo, (Text, String)):
        return "texto"
    return "otro"


@pytest.mark.filterwarnings("ignore:Did not recognize type 'vector'")
def test_modelos_y_base_coinciden(sesion_agente: Session) -> None:
    insp = inspect(sesion_agente.connection())
    en_base = set(insp.get_table_names(schema="agente"))
    modelos = {t.name: t for t in Base.metadata.sorted_tables}
    assert en_base == set(modelos)
    for nombre, tabla in modelos.items():
        reales = {c["name"]: c for c in insp.get_columns(nombre, schema="agente")}
        assert set(reales) == {c.name for c in tabla.columns}, nombre
        for col in tabla.columns:
            real = reales[col.name]
            assert real["nullable"] == col.nullable, f"{nombre}.{col.name}"
            if col.name == "embedding":  # vector: el reflejo no lo conoce sin pgvector
                continue
            assert _familia(real["type"]) == _familia(col.type), f"{nombre}.{col.name}"
        pk_real = insp.get_pk_constraint(nombre, schema="agente")["constrained_columns"]
        assert set(pk_real) == {c.name for c in tabla.primary_key.columns}, nombre


def test_estado_parada_deja_el_actor(sesion_agente: Session) -> None:
    with con_actor("admin:prueba"):
        est = sesion_agente.get(Estado, 1)
        assert est is not None and est.actualizado_en is None
        est.parada = True
        est.parada_motivo = "prueba"
        sesion_agente.flush()
        sesion_agente.refresh(est)
    assert est.parada is True
    assert est.actualizado_por == "admin:prueba"
    assert est.actualizado_en is not None


def test_actor_por_defecto_es_agente(sesion_agente: Session) -> None:
    ej = Ejecucion(tarea="ejecucion", fecha_ny=date(2026, 11, 16))
    sesion_agente.add(ej)
    sesion_agente.flush()
    sesion_agente.refresh(ej)
    assert ej.creado_por == "agente"
    ej.estado = "hecha"
    sesion_agente.flush()
    sesion_agente.refresh(ej)
    assert ej.actualizado_por == "agente"


def _decision(s: Session) -> Decision:
    d = Decision(fecha_ny=date(2026, 11, 17), tipo="operar", propuesta={}, razonamiento="r",
                 modelo="m")
    s.add(d)
    s.flush()
    return d


def _orden(s: Session, d: Decision, ticker: str, lado: str, acciones: str, clave: str) -> Orden:
    o = Orden(decision_id=d.id, ticker=ticker, lado=lado, acciones=Decimal(acciones),
              fecha_objetivo=date(2026, 11, 17), clave=clave)
    s.add(o)
    s.flush()
    return o


def _fill(s: Session, o: Orden, dia: date, acciones: str, precio: str, comision: str = "1") -> None:
    s.add(Ejecutada(orden_id=o.id, ejecutada_en=datetime(dia.year, dia.month, dia.day, 10, 0,
                                                        tzinfo=NY),
                    acciones=Decimal(acciones), precio=Decimal(precio), comision=Decimal(comision)))
    s.flush()


def _solo_anadir(s: Session, tabla: str, fila: object) -> None:
    s.add(fila)
    s.flush()
    for sentencia in (f"update agente.{tabla} set creado_por = 'x'", f"delete from agente.{tabla}"):
        with pytest.raises(DBAPIError, match="solo se añaden"):
            with s.begin_nested():
                s.execute(text(sentencia))


def test_decisiones_solo_anadir(sesion_agente: Session) -> None:
    _solo_anadir(sesion_agente, "decisiones",
                 Decision(fecha_ny=date(2026, 11, 17), tipo="nada", propuesta={},
                          razonamiento="r", modelo="m"))


def test_eventos_solo_anadir(sesion_agente: Session) -> None:
    _solo_anadir(sesion_agente, "eventos", Evento(origen="sistema", tipo="prueba"))


def test_movimientos_caja_solo_anadir(sesion_agente: Session) -> None:
    _solo_anadir(sesion_agente, "movimientos_caja",
                 MovimientoCaja(fecha=date(2026, 11, 16), tipo="inicial",
                                importe=Decimal("5000"), motivo="capital"))


def test_gasto_solo_anadir(sesion_agente: Session) -> None:
    _solo_anadir(sesion_agente, "gasto",
                 Gasto(fecha_ny=date(2026, 11, 16), tipo="ia", proveedor="p",
                       coste_usd=Decimal("0.01")))


def test_ejecutadas_solo_anadir(sesion_agente: Session) -> None:
    d = _decision(sesion_agente)
    o = _orden(sesion_agente, d, "AAA", "compra", "1", "k1")
    _solo_anadir(sesion_agente, "ejecutadas",
                 Ejecutada(orden_id=o.id, ejecutada_en=datetime(2026, 11, 17, 10, tzinfo=NY),
                           acciones=Decimal("1"), precio=Decimal("10")))


def _version(n: int, estado: str) -> PlaybookVersion:
    return PlaybookVersion(version=n, contenido="c", motivo="m", estado=estado)


def test_dos_playbooks_vigentes_fallan(sesion_agente: Session) -> None:
    sesion_agente.add(_version(1, "vigente"))
    sesion_agente.flush()
    sesion_agente.add(_version(2, "vigente"))
    with pytest.raises(IntegrityError):
        sesion_agente.flush()


def test_playbook_vigente_y_retirada_conviven(sesion_agente: Session) -> None:
    sesion_agente.add_all([_version(1, "retirada"), _version(2, "vigente")])
    sesion_agente.flush()


def test_seguimiento_dos_activas_fallan(sesion_agente: Session) -> None:
    sesion_agente.add(Seguimiento(ticker="AAA", motivo="a"))
    sesion_agente.flush()
    sesion_agente.add(Seguimiento(ticker="AAA", motivo="b"))
    with pytest.raises(IntegrityError):
        sesion_agente.flush()


def test_seguimiento_cerrada_y_nueva_conviven(sesion_agente: Session) -> None:
    sesion_agente.add(Seguimiento(ticker="AAA", motivo="a", desde=date(2026, 11, 1),
                                  hasta=date(2026, 11, 5)))
    sesion_agente.add(Seguimiento(ticker="AAA", motivo="b"))
    sesion_agente.flush()


def test_foto_cartera_con_split_y_caja(sesion_agente: Session) -> None:
    s = sesion_agente
    s.add(MovimientoCaja(fecha=date(2026, 11, 16), tipo="inicial", importe=Decimal("5000"),
                         motivo="capital"))
    d = _decision(s)
    _fill(s, _orden(s, d, "AAA", "compra", "10", "k1"), date(2026, 11, 17), "10", "100")
    _fill(s, _orden(s, d, "BBB", "compra", "5", "k2"), date(2026, 11, 17), "5", "200")
    s.add(Split(ticker="BBB", fecha=date(2026, 11, 19), ratio=Decimal("2")))
    for t, f, c in (("AAA", 18, "105"), ("BBB", 18, "210"), ("AAA", 20, "112"), ("BBB", 20, "102")):
        s.add(Precio(ticker=t, fecha=date(2026, 11, f), cierre=Decimal(c)))
    _fill(s, _orden(s, d, "AAA", "venta", "4", "k3"), date(2026, 11, 20), "4", "110")

    def foto(dia: int) -> dict[str, tuple[Decimal, Decimal]]:
        filas = s.execute(text("select ticker, acciones, peso from agente.foto_cartera(:f)"),
                          {"f": date(2026, 11, dia)}).all()
        return {r.ticker: (r.acciones, r.peso) for r in filas}

    f18 = foto(18)
    assert {k: v[0] for k, v in f18.items()} == {"AAA": 10, "BBB": 5}
    assert f18["AAA"][1] == Decimal("0.5") and f18["BBB"][1] == Decimal("0.5")
    f20 = foto(20)
    assert {k: round(v[0], 6) for k, v in f20.items()} == {"AAA": 6, "BBB": 10}
    assert round(sum(v[1] for v in f20.values()), 9) == 1

    caja = s.execute(text("select caja from agente.v_caja")).scalar_one()
    assert caja == Decimal("3437")
