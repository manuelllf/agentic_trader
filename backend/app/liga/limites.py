"""Límites de frecuencia persistentes (plan §14): se cuentan en BD, no en memoria, para que un
despliegue en Railway no los resetee — a diferencia de `acceso.LimiteFrecuencia`, que sigue
sirviendo de tope de ráfaga (por si alguien intenta muchas peticiones en pocos segundos).

Cada consulta abre su propia sesión de sistema, como `ia.comun.veces_hoy`: `liga.auditoria` le
está vetada a `authenticated` por RLS (plan §7.3), y contar desde aquí no depende de qué política
tenga la tabla del dominio."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import text

from app.i18n import translate
from app.liga.ia import comun as ia_comun
from app.liga.procesos.comun import auditar, fabrica_sistema

TZ_MADRID = ZoneInfo("Europe/Madrid")
_SIEMPRE = datetime(2000, 1, 1, tzinfo=TZ_MADRID)

TOPE_ALIAS_30_DIAS = 3
TOPE_PRUEBAS_DIA = 30
TOPE_LECTURAS_DIA = 30
# Conversor de la idea a reglas: (por estrategia, al mes) según el plan.
TOPES_CONVERSOR = {"gratis": (5, 30), "pro": (20, 150)}


def _inicio_dia_madrid() -> datetime:
    hoy = datetime.now(TZ_MADRID).date()
    return datetime(hoy.year, hoy.month, hoy.day, tzinfo=TZ_MADRID)


# ---- Cambiar el alias: 3 cada 30 días (ventana corrediza, no día de calendario) -----------------


def cambios_alias_recientes(usuario_id: str) -> int:
    db = fabrica_sistema()
    try:
        return db.execute(text("""
            select count(*) from liga.auditoria
            where accion = 'cuenta.alias' and actor_id = cast(:u as uuid)
              and creada >= now() - interval '30 days'
        """), {"u": usuario_id}).scalar_one()
    finally:
        db.close()


def exigir_cambio_alias_disponible(usuario_id: str) -> None:
    if cambios_alias_recientes(usuario_id) >= TOPE_ALIAS_30_DIAS:
        raise HTTPException(
            429, translate('liga_alias_daily_limit', count=TOPE_ALIAS_30_DIAS))


def auditar_cambio_alias(usuario_id: str, alias: str) -> None:
    """Aparte de la transacción que cambia el alias (que corre como el usuario): `liga.auditoria`
    no tiene INSERT para `authenticated`, así que se apunta como sistema, igual que
    `ligas.auditar_expulsion`."""
    db = fabrica_sistema()
    try:
        auditar(db, "cuenta.alias", f"usuario:{usuario_id}", {"alias": alias}, usuario_id)
        db.commit()
    finally:
        db.close()


# ---- Pruebas: 30 al día (día de Madrid) ---------------------------------------------------------


def pruebas_hoy(usuario_id: str) -> int:
    db = fabrica_sistema()
    try:
        return db.execute(text("""
            select count(*) from liga.pruebas
            where usuario_id = cast(:u as uuid) and creada >= :inicio
        """), {"u": usuario_id, "inicio": _inicio_dia_madrid()}).scalar_one()
    finally:
        db.close()


def exigir_prueba_disponible(usuario_id: str) -> None:
    if pruebas_hoy(usuario_id) >= TOPE_PRUEBAS_DIA:
        raise HTTPException(429, translate('liga_preview_daily_limit', count=TOPE_PRUEBAS_DIA))


# ---- Lecturas: 50 al día (día de Madrid), contadas por lo que de verdad se ha comprado -----------


def lecturas_hoy(usuario_id: str) -> int:
    db = fabrica_sistema()
    try:
        return db.execute(text("""
            select count(*) from liga.creditos_movimientos
            where usuario_id = cast(:u as uuid) and motivo = 'lectura' and creado >= :inicio
        """), {"u": usuario_id, "inicio": _inicio_dia_madrid()}).scalar_one()
    finally:
        db.close()


def exigir_lectura_disponible(usuario_id: str) -> None:
    if lecturas_hoy(usuario_id) >= TOPE_LECTURAS_DIA:
        raise HTTPException(
            429, translate('liga_reading_daily_limit', count=TOPE_LECTURAS_DIA))


# ---- Conversor: por estrategia y al mes, según el plan ------------------------------------------


@dataclass(frozen=True)
class UsosConversor:
    """Lo gastado y lo que se puede gastar. `estrategia` es `None` mientras la estrategia aún no
    existe: entonces solo cuenta el tope del mes."""

    pro: bool
    estrategia: int | None
    tope_estrategia: int
    mes: int
    tope_mes: int

    @property
    def quedan(self) -> int:
        en_mes = self.tope_mes - self.mes
        return en_mes if self.estrategia is None else min(en_mes,
                                                          self.tope_estrategia - self.estrategia)

    def con_uno_mas(self) -> UsosConversor:
        return replace(self, mes=self.mes + 1,
                       estrategia=None if self.estrategia is None else self.estrategia + 1)


def _datos_conversor(usuario_id: str, estrategia_id: str | None) -> tuple[bool, str | None]:
    """Si la cuenta es Pro y la estrategia, solo si es suya (no se cuenta una ajena)."""
    db = fabrica_sistema()
    try:
        pro = db.execute(text("select liga.tiene_pro(cast(:u as uuid))"),
                         {"u": usuario_id}).scalar_one()
        propia = estrategia_id and db.execute(text(
            "select 1 from liga.estrategias where id = cast(:e as uuid) "
            "and dueno_id = cast(:u as uuid)"), {"e": estrategia_id, "u": usuario_id}).first()
        return bool(pro), (estrategia_id if propia else None)
    finally:
        db.close()


def exigir_conversor_disponible(usuario_id: str, estrategia_id: str | None = None
                                ) -> tuple[UsosConversor, str | None]:
    """Lo usado en esta estrategia y este mes (huso de Madrid), o 429 si el plan no da para más.
    Devuelve también la estrategia que cuenta: `None` si no existe o no es suya."""
    pro, propia = _datos_conversor(usuario_id, estrategia_id)
    tope_estrategia, tope_mes = TOPES_CONVERSOR["pro" if pro else "gratis"]
    hoy = datetime.now(TZ_MADRID)
    mes = ia_comun.veces_desde("conversor", usuario_id,
                               datetime(hoy.year, hoy.month, 1, tzinfo=TZ_MADRID))
    en_estrategia = (ia_comun.veces_desde("conversor", usuario_id, _SIEMPRE, propia)
                     if propia else None)
    usos = UsosConversor(pro, en_estrategia, tope_estrategia, mes, tope_mes)
    if mes >= tope_mes:
        raise HTTPException(429, translate("liga_converter_month_limit", count=tope_mes))
    if en_estrategia is not None and en_estrategia >= tope_estrategia:
        raise HTTPException(429, translate("liga_converter_strategy_limit", count=tope_estrategia))
    return usos, propia
