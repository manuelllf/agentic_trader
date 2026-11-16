"""Libro de papel del agente: caja, posiciones, órdenes y ejecución a la apertura.

Las funciones no hacen commit: lo hace quien llama."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_FLOOR, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.agente import limites
from app.agente.models import (
    Ejecutada,
    MovimientoCaja,
    Orden,
    Precio,
    Split,
    ValorDiario,
)
from app.commissions import afford_quantity, commission
from app.ledger.money import D, to_cents

NY = ZoneInfo("America/New_York")
CAPITAL_INICIAL = D("5000")
_CERO = D("0")
_UNO = D("1")


@dataclass(frozen=True)
class PrecioApertura:
    ticker: str
    cierre_previo: Decimal
    apertura: Decimal


@dataclass(frozen=True)
class Accion:
    ticker: str
    dia: date
    dividendo: Decimal
    split: Decimal


def abrir_libro(s: Session, fecha: date) -> bool:
    """Mete los 5.000 $ iniciales una sola vez."""
    s.flush()
    hay = s.execute(
        text("select 1 from agente.movimientos_caja where tipo = 'inicial' limit 1")
    ).first()
    if hay is not None:
        return False
    s.add(MovimientoCaja(fecha=fecha, tipo="inicial", importe=CAPITAL_INICIAL,
                         motivo="Capital inicial del libro de papel"))
    s.flush()
    return True


def estado_posiciones(s: Session, hasta: date | None = None) -> dict[str, tuple[Decimal, Decimal]]:
    """ticker -> (acciones, coste medio con comisión de compra), con los splits aplicados.

    `hasta` corta por fecha de Nueva York, para saber qué había en un día pasado."""
    s.flush()
    fills = s.execute(text(
        "select o.ticker, o.lado, e.acciones, e.precio, e.comision, e.ejecutada_en "
        "from agente.ejecutadas e join agente.ordenes o on o.id = e.orden_id "
        "order by e.ejecutada_en, e.id")).all()
    splits = s.execute(text("select ticker, fecha, ratio from agente.splits")).all()

    # Un split en la fecha F afecta a lo comprado antes de F: va antes que los fills de ese día.
    eventos: list[tuple[date, int, int, str, tuple]] = []
    for i, r in enumerate(splits):
        if hasta is None or r.fecha <= hasta:
            eventos.append((r.fecha, 0, i, "split", (r.ticker, r.ratio)))
    for i, r in enumerate(fills):
        dia = r.ejecutada_en.astimezone(NY).date()
        if hasta is None or dia <= hasta:
            datos = (r.ticker, r.lado, r.acciones, r.precio, r.comision)
            eventos.append((dia, 1, i, "fill", datos))
    eventos.sort(key=lambda e: e[:3])

    estado: dict[str, tuple[Decimal, Decimal]] = {}
    for _, _, _, tipo, d in eventos:
        if tipo == "split":
            ticker, ratio = d
            if ticker in estado:
                acc, cm = estado[ticker]
                estado[ticker] = (acc * ratio, cm / ratio)
            continue
        ticker, lado, acc_f, precio, comision = d
        acc, cm = estado.get(ticker, (_CERO, _CERO))
        if lado == "compra":
            nuevas = acc + acc_f
            estado[ticker] = (nuevas, (acc * cm + acc_f * precio + comision) / nuevas)
        else:
            resto = acc - acc_f
            if resto <= _CERO:
                estado.pop(ticker, None)
            else:
                estado[ticker] = (resto, cm)
    return estado


def caja(s: Session) -> Decimal:
    s.flush()
    return D(s.execute(text("select caja from agente.v_caja")).scalar_one())


def _ultimo_cierre(s: Session, ticker: str, dia: date) -> Decimal | None:
    v = s.execute(
        text("select cierre from agente.precios where ticker = :t and fecha <= :d "
             "order by fecha desc limit 1"), {"t": ticker, "d": dia}).scalar()
    return None if v is None else D(v)


def _armar_cartera(s: Session, dia: date, estado: dict[str, tuple[Decimal, Decimal]],
                   apertura: dict[str, Decimal] | None = None) -> limites.Cartera:
    posiciones: list[limites.Posicion] = []
    for ticker, (acc, cm) in sorted(estado.items()):
        precio = (apertura or {}).get(ticker)
        if precio is None:
            precio = _ultimo_cierre(s, ticker, dia)
        if precio is None:
            raise ValueError(f"Falta el precio de {ticker} a {dia.isoformat()}")
        posiciones.append(limites.Posicion(ticker, acc, cm, precio))
    c = caja(s)
    total = c + sum((p.valor for p in posiciones), _CERO)
    previo = s.execute(
        text("select max(valor_total) from agente.v_valor_diario where fecha <= :d"),
        {"d": dia}).scalar()
    maximo = total if previo is None else max(D(previo), total)
    return limites.Cartera(caja=c, posiciones=tuple(posiciones), valor_maximo=maximo)


def cartera(s: Session, dia: date) -> limites.Cartera:
    """Cartera valorada al último cierre guardado hasta `dia`; sin precio no se inventa nada."""
    return _armar_cartera(s, dia, estado_posiciones(s, dia))


def guardar_precios(
    s: Session, ticker: str,
    barras: list[tuple[date, Decimal | None, Decimal | None, Decimal | None, Decimal, int | None]],
) -> None:
    """Upsert de (fecha, apertura, máximo, mínimo, cierre, volumen)."""
    if not barras:
        return
    filas = [{"ticker": ticker, "fecha": f, "apertura": a, "maximo": mx, "minimo": mn,
              "cierre": c, "volumen": v} for f, a, mx, mn, c, v in barras]
    ins = insert(Precio).values(filas)
    s.execute(ins.on_conflict_do_update(
        index_elements=["ticker", "fecha"],
        set_={k: ins.excluded[k] for k in ("apertura", "maximo", "minimo", "cierre", "volumen")}))


def _tuvo_posicion(s: Session, ticker: str) -> bool:
    return s.execute(text(
        "select 1 from agente.ejecutadas e join agente.ordenes o on o.id = e.orden_id "
        "where o.ticker = :t limit 1"), {"t": ticker}).first() is not None


def registrar_acciones(s: Session, acciones: list[Accion]) -> int:
    """Splits y dividendos de lo que se tiene o se tuvo; devuelve las filas nuevas."""
    s.flush()
    nuevas = 0
    for a in acciones:
        if a.split > _CERO and a.split != _UNO and _tuvo_posicion(s, a.ticker):
            r = s.execute(insert(Split).values(ticker=a.ticker, fecha=a.dia, ratio=a.split)
                          .on_conflict_do_nothing(index_elements=["ticker", "fecha"])
                          .returning(Split.id))
            nuevas += len(r.all())
        if a.dividendo > _CERO:
            antes = estado_posiciones(s, a.dia - timedelta(days=1)).get(a.ticker)
            if antes is None:
                continue
            importe = to_cents(antes[0] * a.dividendo)
            if importe == _CERO:
                continue
            r = s.execute(
                insert(MovimientoCaja).values(
                    fecha=a.dia, tipo="dividendo", importe=importe, ticker=a.ticker,
                    motivo=f"Dividendo de {a.ticker}: {a.dividendo} por acción")
                .on_conflict_do_nothing(index_elements=["ticker", "fecha"],
                                        index_where=text("tipo = 'dividendo'"))
                .returning(MovimientoCaja.id))
            nuevas += len(r.all())
    return nuevas


def crear_orden(s: Session, decision_id: int, ticker: str, lado: str, fecha_objetivo: date, *,
                acciones: Decimal | None = None, importe: Decimal | None = None) -> Orden:
    """Idempotente por clave: repetir la misma orden devuelve la que ya existe."""
    clave = f"{decision_id}:{ticker}:{lado}:{fecha_objetivo.isoformat()}"
    s.flush()
    previa = s.execute(select(Orden).where(Orden.clave == clave)).scalar_one_or_none()
    if previa is not None:
        return previa
    o = Orden(decision_id=decision_id, ticker=ticker, lado=lado, acciones=acciones,
              importe_objetivo=importe, fecha_objetivo=fecha_objetivo, clave=clave)
    s.add(o)
    s.flush()
    return o


def _rechazar(o: Orden, estado: str, motivo: str) -> None:
    o.estado = estado
    o.motivo = motivo


def _ejecutar_venta(s: Session, o: Orden, dia: date, p: PrecioApertura, ahora: datetime,
                    parada: bool, aperturas: dict[str, Decimal]) -> None:
    estado = estado_posiciones(s)
    tengo = estado.get(o.ticker, (_CERO, _CERO))[0]
    if o.acciones is not None:
        pedidas = D(o.acciones)
    else:
        pedidas = (D(o.importe_objetivo) / p.apertura).to_integral_value(rounding=ROUND_FLOOR)
    acciones = min(pedidas, tengo)
    cart = _armar_cartera(s, dia, estado, aperturas)
    v = limites.comprobar_venta(limites.PropuestaVenta(o.ticker, acciones), cart, parada)
    if v:
        _rechazar(o, "rechazada_limites", ",".join(x.codigo for x in v))
        return
    _fill(s, o, ahora, acciones, p.apertura)


def _ejecutar_compra(s: Session, o: Orden, dia: date, p: PrecioApertura, ahora: datetime,
                     parada: bool, aperturas: dict[str, Decimal]) -> None:
    if not limites.apertura_permite_compra(p.cierre_previo, p.apertura):
        _rechazar(o, "rechazada_apertura",
                  f"Apertura {p.apertura} sobre cierre previo {p.cierre_previo}: hueco excesivo")
        return
    if o.acciones is not None:
        acciones = D(o.acciones)
    else:
        gastable = min(D(o.importe_objetivo), caja(s))
        acciones = afford_quantity(gastable, p.apertura, _UNO)
    if acciones <= _CERO:
        _rechazar(o, "rechazada_limites", "importe_menor_que_una_accion")
        return
    cart = _armar_cartera(s, dia, estado_posiciones(s), aperturas)
    propuesta = limites.PropuestaCompra(o.ticker, acciones * p.apertura, p.apertura,
                                        salidas="orden", ruptura="orden", proximo_evento=None)
    v = limites.comprobar_compra(propuesta, cart, dia, parada)
    if v:
        _rechazar(o, "rechazada_limites", ",".join(x.codigo for x in v))
        return
    _fill(s, o, ahora, acciones, p.apertura)


def _fill(s: Session, o: Orden, ahora: datetime, acciones: Decimal, precio: Decimal) -> None:
    s.add(Ejecutada(orden_id=o.id, ejecutada_en=ahora, acciones=acciones, precio=precio,
                    comision=commission(acciones, precio)))
    o.estado = "ejecutada"


def ejecutar_pendientes(s: Session, dia: date, precios: dict[str, PrecioApertura],
                        ahora: datetime, parada: bool) -> list[tuple[int, str]]:
    """Ejecuta a la apertura las órdenes de `dia`; las ventas van primero para liberar caja."""
    if ahora.tzinfo is None:
        ahora = ahora.replace(tzinfo=NY)
    s.flush()
    pendientes = s.execute(
        select(Orden).where(Orden.estado == "pendiente", Orden.fecha_objetivo == dia)
        .order_by(Orden.id)).scalars().all()
    ordenadas = ([o for o in pendientes if o.lado == "venta"]
                 + [o for o in pendientes if o.lado == "compra"])
    aperturas = {t: p.apertura for t, p in precios.items()}
    salida: list[tuple[int, str]] = []
    for o in ordenadas:
        p = precios.get(o.ticker)
        if p is None:
            continue
        if o.lado == "venta":
            _ejecutar_venta(s, o, dia, p, ahora, parada, aperturas)
        else:
            _ejecutar_compra(s, o, dia, p, ahora, parada, aperturas)
        s.flush()
        salida.append((o.id, o.estado))
    return salida


def guardar_valor_diario(s: Session, dia: date) -> None:
    c = cartera(s, dia)
    valor = sum((p.valor for p in c.posiciones), _CERO)
    ins = insert(ValorDiario).values(fecha=dia, caja=c.caja, valor_posiciones=valor)
    s.execute(ins.on_conflict_do_update(
        index_elements=["fecha"],
        set_={"caja": ins.excluded.caja, "valor_posiciones": ins.excluded.valor_posiciones}))
