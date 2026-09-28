"""Ayuda única para toda llamada de IA de la liga (plan §10 y F6): switches por finalidad, tope
mensual, la fila de `llm_call` (sin texto — el resultado vive en su tabla de dominio), la
auditoría, el log estructurado y el libro de créditos (reserva/liquidación/devolución).

Ninguna finalidad llama al proveedor a mano: pasa por `llamar_ia` (la llamada, con su propia
traza) y `registrar_llamada` (lo que se persiste). Todo abre y cierra su propia sesión de sistema
— nunca `db_sistema` en una ruta (lo vigila `test_liga_puertas`)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.liga.procesos.comun import Fabrica, auditar, fabrica_sistema

logger = logging.getLogger("app.liga.ia")

TZ_MADRID = ZoneInfo("Europe/Madrid")

# Las cuatro finalidades del plan §10; `stage` es lo que se guarda en `llm_call.stage`
# (`String(16)`: todas caben) y en el nombre de la acción de auditoría (`ia.<finalidad>`).
FINALIDADES = ("conversor", "pregunta", "lectura", "moderacion")
_STAGE = {
    "conversor": "liga_conversor", "pregunta": "liga_pregunta",
    "lectura": "liga_lectura", "moderacion": "liga_moderacion",
}

_CLAVE_TOPE = "ia.tope_mensual_usd"


@dataclass(frozen=True)
class LlamadaIA:
    """Lo que dejó el proveedor, listo para la fila de `llm_call` — nunca lleva texto."""

    modelo: str
    tokens_entrada: int
    tokens_salida: int
    coste_usd: float
    latencia_ms: int
    ok: bool
    error: str | None = None


def _clave_interruptor(finalidad: str) -> str:
    return f"ia.{finalidad}.activo"


def verificar_disponible(finalidad: str, fabrica: Fabrica | None = None) -> None:
    """503 si el LLM no está activo en este despliegue, si el interruptor de la finalidad está
    apagado (ausente = apagado) o si el tope mensual ya se ha gastado. Se consulta como sistema:
    `liga.ajustes` solo lo lee el admin por RLS, y esta finalidad la piden usuarios normales.

    `fabrica`: por defecto la del sistema (`app.db.SessionLocal`, igual en producción a la que
    usan los procesos); un proceso con su PROPIA fábrica (tests, savepoints) la pasa para leer
    de la misma conexión -- ver `procesos.formar.rellenar_preguntas`."""
    from app.config import settings

    if not settings.enable_llm:
        raise HTTPException(503, "Esta función de IA está apagada ahora mismo.")
    db = (fabrica or fabrica_sistema)()
    try:
        activo = db.execute(text("select valor from liga.ajustes where clave = :c"),
                            {"c": _clave_interruptor(finalidad)}).scalar()
        if not activo:
            raise HTTPException(503, "Esta función de IA está apagada ahora mismo.")
        tope = db.execute(text("select valor from liga.ajustes where clave = :c"),
                          {"c": _CLAVE_TOPE}).scalar()
        if tope is None:
            return
        gastado = db.execute(text("""
            select coalesce(sum(cost_usd), 0) from llm_call
            where stage = any(:etapas) and at >= date_trunc('month', now())
        """), {"etapas": list(_STAGE.values())}).scalar_one()
        if float(gastado) >= float(tope):
            raise HTTPException(503, "Esta función de IA está apagada ahora mismo.")
    finally:
        db.close()


def llamar_ia(*, finalidad: str, usuario_id: str | None, modelo: str, system: str, user: str,
             temperature: float = 0.0, timeout: float = 20) -> tuple[str | None, LlamadaIA]:
    """Una llamada real y barata al proveedor configurado, con su propia traza (nunca la de un
    escaneo). Nunca lanza por un fallo del proveedor: `contenido` sale `None` y `llamada.ok` en
    falso, para que el llamador registre el intento igualmente y decida el mensaje al usuario."""
    verificar_disponible(finalidad)
    from app.llm import get_llm
    from app.llm.trace import CallRecord

    class _Recorder:
        def __init__(self) -> None:
            self.ultima: CallRecord | None = None

        def record(self, call: CallRecord) -> None:
            self.ultima = call

    recorder = _Recorder()
    # Corto por defecto: la moderación corre dentro de la petición, con su transacción abierta.
    llm = get_llm(model=modelo, reasoning_effort="none", stage=_STAGE[finalidad],
                 recorder=recorder, timeout=timeout)
    contenido: str | None = None
    fallo: str | None = None
    try:
        contenido = llm.chat(system, user, temperature=temperature)
    except Exception as e:
        fallo = f"{type(e).__name__}: {e}"
        logger.warning("ia.%s: el proveedor no respondió", finalidad, exc_info=True)
    # `ok`/`error` salen de si `chat()` lanzó, no de si el proveedor rellenó `recorder` (los
    # proveedores de verdad siempre lo hacen, pero un `FakeLLMProvider` de test puede no hacerlo).
    c = recorder.ultima
    llamada = LlamadaIA(
        modelo=modelo,
        tokens_entrada=(c.prompt_cache_hit_tokens + c.prompt_cache_miss_tokens) if c else 0,
        tokens_salida=c.completion_tokens if c else 0,
        coste_usd=c.cost_usd if c else 0.0,
        latencia_ms=c.latency_ms if c else 0,
        ok=fallo is None,
        error=fallo)
    return contenido, llamada


def llamar_ia_jev(*, finalidad: str, modelo: str, state: str, pregunta: str,
                  fabrica: Fabrica | None = None
                  ) -> tuple[tuple[float, float | None] | None, LlamadaIA]:
    """Como `llamar_ia`, pero para la pregunta propia con Jev (primitiva noul, F6-B): Jev no es
    un modelo de chat (`app/llm/jev.py`), así que no encaja en `get_llm().chat()`. Devuelve
    `(p, confianza) | None` y su `LlamadaIA` para registrar igual que cualquier otra llamada."""
    verificar_disponible(finalidad, fabrica)
    from app.config import settings
    from app.llm.jev import preguntar_noul

    if not settings.typesafe_api_key:
        raise HTTPException(503, "Esta función de IA está apagada ahora mismo.")

    class _Recorder:
        def __init__(self) -> None:
            self.ultima = None

        def record(self, call) -> None:  # noqa: ANN001
            self.ultima = call

    recorder = _Recorder()
    resultado, info = preguntar_noul(
        api_key=settings.typesafe_api_key, model=modelo, stage=_STAGE[finalidad], state=state,
        pregunta=pregunta, recorder=recorder)
    llamada = LlamadaIA(
        modelo=modelo, tokens_entrada=info["tokens_entrada"], tokens_salida=info["tokens_salida"],
        coste_usd=info["coste_usd"], latencia_ms=info["latencia_ms"], ok=info["ok"],
        error=info["error"])
    return resultado, llamada


def registrar_llamada(*, finalidad: str, usuario_id: str | None, llamada: LlamadaIA,
                      creditos: Decimal | None = None, cache: bool = False,
                      fabrica: Fabrica | None = None) -> int | None:
    """Fila de `llm_call` (sin texto; se salta si es acierto de caché) + auditoría + un log
    limpio. `creditos` es el movimiento neto de este uso (negativo cobrado, positivo devuelto);
    `None` si es gratis. `fabrica`: ver `verificar_disponible`."""
    from app.models import LLMCall

    db = (fabrica or fabrica_sistema)()
    llm_call_id: int | None = None
    try:
        if not cache:
            fila = LLMCall(
                scan_run_id=None, at=datetime.now(UTC), stage=_STAGE[finalidad], ticker=None,
                model=llamada.modelo, reasoning_effort=None, content=None, reasoning=None,
                confidence=None, prompt_cache_hit_tokens=0,
                prompt_cache_miss_tokens=llamada.tokens_entrada,
                completion_tokens=llamada.tokens_salida, cost_usd=llamada.coste_usd,
                latency_ms=llamada.latencia_ms, ok=llamada.ok, error=llamada.error)
            db.add(fila)
            db.flush()
            llm_call_id = fila.id
        auditar(db, f"ia.{finalidad}", f"llm_call:{llm_call_id}" if llm_call_id else None, {
            "coste_usd": llamada.coste_usd if not cache else 0.0,
            "tokens": llamada.tokens_salida, "cache": cache,
            "creditos": str(creditos) if creditos is not None else None,
        }, usuario_id)
        db.commit()
    finally:
        db.close()
    logger.info(
        "ia.%s usuario=%s llm_call=%s modelo=%s tokens=%s coste_usd=%.4f cache=%s creditos=%s",
        finalidad, usuario_id, llm_call_id, llamada.modelo, llamada.tokens_salida,
        llamada.coste_usd, cache, creditos)
    return llm_call_id


def veces_hoy(finalidad: str, usuario_id: str) -> int:
    """Cuántas veces se ha usado ya esta finalidad hoy (huso de Madrid), contadas de
    `liga.auditoria` — a diferencia de `acceso.LimiteFrecuencia` sobrevive a un reinicio."""
    hoy = datetime.now(TZ_MADRID).date()
    inicio = datetime(hoy.year, hoy.month, hoy.day, tzinfo=TZ_MADRID)
    db = fabrica_sistema()
    try:
        return db.execute(text("""
            select count(*) from liga.auditoria
            where accion = :a and actor_id = cast(:u as uuid) and creada >= :inicio
        """), {"a": f"ia.{finalidad}", "u": usuario_id, "inicio": inicio}).scalar_one()
    finally:
        db.close()


# ---- Créditos: reserva, liquidación y devolución -------------------------------------------------


def reservar_creditos(usuario_id: str, importe: Decimal, idempotencia: str) -> None:
    """Reserva (movimiento negativo) el importe estimado antes de lanzar el gasto; 402 si no
    alcanza el saldo. Idempotente: repetir la misma clave no reserva dos veces."""
    db = fabrica_sistema()
    try:
        try:
            db.execute(text(
                "select liga.cargar_creditos(cast(:u as uuid), cast(:i as numeric), "
                "'reserva', :k)"), {"u": usuario_id, "i": str(-importe), "k": idempotencia})
        except DBAPIError as e:
            db.rollback()
            if getattr(e.orig, "sqlstate", None) == "23514":
                raise HTTPException(402, "No te quedan créditos suficientes.") from e
            raise
        db.commit()
    finally:
        db.close()


def liquidar_creditos(usuario_id: str, importe_reservado: Decimal, importe_real: Decimal,
                      motivo_cobro: str, clave: str, prueba_id=None, lectura_id=None) -> None:  # noqa: ANN001
    """Cobra el precio real y devuelve entera la reserva, en la misma transacción: el neto es
    `-importe_real` exacto aunque el precio estimado y el real difieran. Repetir `clave` no cobra
    dos veces (cada movimiento lleva su propia idempotencia derivada de ella)."""
    db = fabrica_sistema()
    try:
        db.execute(text(
            "select liga.cargar_creditos(cast(:u as uuid), cast(:i as numeric), :m, :k, "
            "cast(:p as uuid), :l)"),
            {"u": usuario_id, "i": str(-importe_real), "m": motivo_cobro,
             "k": f"{motivo_cobro}:{clave}", "p": str(prueba_id) if prueba_id else None,
             "l": lectura_id})
        db.execute(text(
            "select liga.cargar_creditos(cast(:u as uuid), cast(:i as numeric), "
            "'devolucion', :k)"),
            {"u": usuario_id, "i": str(importe_reservado), "k": f"devolucion:{clave}"})
        db.commit()
    finally:
        db.close()


def devolver_reserva(usuario_id: str, importe_reservado: Decimal, clave: str) -> None:
    """Falló el gasto tras reservar: se devuelve entera la reserva. Idempotente como todo lo
    demás — un reintento con la misma `clave` no duplica la devolución."""
    db = fabrica_sistema()
    try:
        db.execute(text(
            "select liga.cargar_creditos(cast(:u as uuid), cast(:i as numeric), "
            "'devolucion', :k)"),
            {"u": usuario_id, "i": str(importe_reservado), "k": f"devolucion:{clave}"})
        db.commit()
    finally:
        db.close()


def saldo(usuario_id: str) -> Decimal:
    """Saldo en créditos (suma del libro), leído como sistema."""
    db = fabrica_sistema()
    try:
        valor = db.execute(text(
            "select saldo from liga.v_saldo where usuario_id = cast(:u as uuid)"),
            {"u": usuario_id}).scalar()
        return Decimal(valor or 0)
    finally:
        db.close()


def exigir_saldo(usuario_id: str, importe: Decimal) -> None:
    """Antes de pagar una generación: sin saldo para cobrarla, 402 y no se llama a nadie."""
    if saldo(usuario_id) < importe:
        raise HTTPException(402, "No te quedan créditos suficientes.")
