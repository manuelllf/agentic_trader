"""Scheduler de escaneo (cron mensual, anclado a la hora del mercado US).

APScheduler `BackgroundScheduler` (síncrono), coherente con el resto del backend.
Se arranca/para desde el lifespan de FastAPI (ver `main.py`). Solo tickea mientras el proceso
del backend esté VIVO → en producción requiere un servidor always-on (Railway), no serverless.
Se puede desactivar con ENABLE_SCHEDULER=false (tests, o escaneos solo bajo demanda vía API).
"""

from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app import scan_config
from app.config import settings
from app.db import SessionLocal
from app.scan_service import run_scan_and_store, write_scan_failure

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler(timezone="UTC")


def _scan_job() -> None:
    """Único escaneo programado: mensual, universo entero, decide. El semanal (muestra
    rotatoria, sin capa media, sin decisión) se retiró — no aportaba conocimiento nuevo: el
    mercado no cambia lo bastante en una semana para justificar 750 llamadas de pago sin capa
    media y sin tocar cartera (ver docs/plan-datos-observability.md)."""
    db = SessionLocal()
    try:
        # Config por etapa guardada para el escaneo con decisión (misma que usa el botón
        # "Analizar y decidir"); `None` = defaults de `settings`, comportamiento de siempre.
        overrides = scan_config.get_decide_overrides(db)
        result = run_scan_and_store(db, sample_size=None, decide=True, llm_overrides=overrides)
        logger.info("Escaneo completado: %s", result)
    except Exception as exc:
        logger.exception("Fallo en el job de escaneo")
        try:
            write_scan_failure(db, exc)   # sin esto, un cron caído es invisible en la web
        except Exception:
            logger.exception("Tampoco se pudo persistir el informe del fallo.")
    finally:
        db.close()


def _snapshot_job() -> None:
    """Cierre diario: la curva histórica (equity por libro + SPY) y la FOTO DEL UNIVERSO.

    Corre tras el cierre US (16:00 ET) con margen para el retraso de ~15 min de yfinance.
    Si un día no corrió (deploy, caída), el siguiente rellena los huecos solo.

    La foto del universo va aquí y no en el escaneo porque el volumen que publica NASDAQ es el
    de la sesión EN CURSO: pedido a las 10:15 ET deja fuera casi todo el mercado. Con la bolsa
    cerrada, el dato del día está completo y cualquier escaneo posterior parte del mercado entero.
    """
    from app import history

    db = SessionLocal()
    try:
        n = history.record_snapshots(db)
        if n:
            logger.info("Curva histórica: %s cierre(s) apuntado(s).", n)
    except Exception:
        logger.exception("Fallo en el job de snapshot de la curva")
    finally:
        db.close()


def _universe_job() -> None:
    """Fotografía el universo tras el cierre US, y REINTENTA cada 2h esa misma noche.

    Va aparte de la curva porque depende de una fuente ajena y frágil: NASDAQ responde 200 con
    el cuerpo vacío cuando le da la gana. Si a las 16:30 ET no hay suerte, a las 18:30, 20:30 y
    22:30 se vuelve a intentar; en cuanto una funciona, las siguientes no hacen nada. Sin foto
    del día, el escaneo de la mañana siguiente vería el mercado a medio negociar."""
    from app.screener import universe as universe_mod

    db = SessionLocal()
    try:
        hoy = datetime.now(ZoneInfo(settings.scan_timezone)).date()
        if universe_mod.snapshot_date(db) == hoy:
            return                                  # ya hay foto de esta sesión: nada que hacer
        total = universe_mod.refresh_snapshot(db)
        logger.info("Foto del universo actualizada: %s nombres elegibles.", total)
    except Exception:
        logger.exception("No se pudo fotografiar el universo (se reintenta en 2h)")
    finally:
        db.close()


def _universo_global_job() -> None:
    """Sincroniza el universo global de HuggingFace, mensual. El catálogo de tickers no se
    mueve rápido; esto solo ensancha lo que se puede FOTOGRAFIAR, el escaneo sigue en NASDAQ."""
    from app.screener import universe_global

    db = SessionLocal()
    try:
        info = universe_global.sincronizar(db)
        logger.info("Universo global sincronizado: %s tickers.", info["tickers"])
    except Exception:
        logger.exception("No se pudo sincronizar el universo global")
    finally:
        db.close()


def _fx_job() -> None:
    """Tasas de cambio a USD + recálculo de `market_cap_usd` (ver `app/screener/fx.py`) --
    5:00 Europa/Madrid, antes de la analítica, para que el scan "top market cap global" del día
    ya tenga la tasa fresca."""
    from app.screener import fx as fx_mod

    db = SessionLocal()
    try:
        info = fx_mod.sincronizar(db)
        logger.info("FX sincronizado: %s", info)
    except Exception:
        logger.exception("No se pudo sincronizar las tasas de cambio")
    finally:
        db.close()


def _analytics_sync_job() -> None:
    """Reconstruye el fichero DuckDB persistente de `/analytics/*` desde Postgres. Fuera de
    horas de mercado, a propósito no atado a ningún escaneo — la analítica acepta estar hasta
    24h desatualizada (ver `app/analytics_sync.py`), así que basta con una pasada diaria."""
    from app import analytics_sync

    try:
        counts = analytics_sync.sync()
        logger.info("Analítica DuckDB sincronizada: %s", counts)
    except Exception:
        logger.exception("No se pudo sincronizar la analítica DuckDB")


def _reconcile_job() -> None:
    """Reconcilia fills de órdenes límite 'working' SIN depender de que la web esté abierta.

    Clave en producción: si una orden llena a los 15 min y nadie tiene la Sala Real abierta,
    este job cuadra el libro igualmente. Barato: si no hay órdenes working, es solo una query
    a la BD (ni toca IBKR)."""
    from app import approvals as approvals_mod

    db = SessionLocal()
    try:
        n = approvals_mod.reconcile_working(db)
        if n:
            logger.info("Reconcile: %s orden(es) actualizada(s) con su fill real.", n)
    except Exception:
        logger.exception("Fallo en el job de reconciliación")
    finally:
        db.close()


def procesar_señales(db, todas: list[dict], universo: list[str] | None = None) -> dict:  # noqa: ANN001 — Session, evitar el circular
    """Inserta las señales nuevas de `todas` y actualiza a resuelta las que ya estaban abiertas
    y desde entonces cruzaron objetivo o 90 días. Extraído de `run_momentum_scan` el 8-sep-2026
    para reutilizarlo también al incorporar un candidato: así "Incorporar" hace exactamente el
    mismo trabajo que ya hace cualquiera de los 34 fijos (historial + alerta activa si la tiene)
    en el momento, en vez de esperar al cron de mañana (ver `candidatos.backfill_señales`).

    `universo`: para calcular UNA vez el termómetro de régimen (`app.momentum.regimen`) y
    congelarlo en cada señal NUEVA -- informativo, nunca bloquea nada (ver `regimen.py`). Si no
    se pasa, las columnas `cesta_60d`/`gate_regimen` quedan NULL (p.ej. en los tests)."""
    import pandas as pd
    from sqlalchemy import text

    from app import push
    from app.momentum import regimen

    # Tickers apagados: se escanean y sus señales se guardan igual, pero no avisan ni cuentan
    # como "nuevas" (ver `momentum_universo_estado.mantener`).
    apagados = {r[0] for r in db.execute(text(
        "select ticker from momentum_universo_estado where mantener = false")).all()}
    cesta = regimen.cesta_60d(universo) if universo else None
    # None = no medido (sin universo, o falló la descarga) -- distinto de False (medido y sano).
    gate_regimen = None if cesta is None else (cesta < regimen.UMBRAL)
    nuevas, tickers_nuevos = 0, []
    reactivadas = []            # descartadas de suelo que vuelven a zona de entrada (misma señal)
    resueltas_ejecutadas = []   # posiciones REALES (estado='ejecutada') que acaban de resolverse
    for s in todas:
        entry_date = s["entry_date"].date()
        # `compute_signals()` pasa por un DataFrame internamente (para resolver 'ambos') --
        # eso puede colar NaT/NaN en vez de None en exit_date/motivo. SIEMPRE pd.notna(),
        # nunca `is not None` (bug real, ya nos mordió con esto antes).
        exit_val = s.get("exit_date")
        motivo_val = s.get("motivo")
        motivo_final = motivo_val if pd.notna(motivo_val) else None
        exit_final = exit_val.date() if pd.notna(exit_val) else None
        # `ret` y `dias` son NaN (float) en TODA señal aún sin resolver. SQLite lo traga; Postgres
        # NO (`dias` es integer) y revienta el escaneo con un error de SQL. Se normaliza a None
        # igual que ya se hacía con exit_date/motivo.
        ret_final = float(s["ret"]) if pd.notna(s.get("ret")) else None
        dias_final = int(s["dias"]) if pd.notna(s.get("dias")) else None
        fila = db.execute(text("""
            select id, resuelta, estado, gate_resultado from momentum_senales
            where ticker=:t and tipo=:tp and entry_date=:d
        """), {"t": s["ticker"], "tp": s["tipo"], "d": entry_date}).mappings().first()
        if fila:
            if (not fila["resuelta"]) and s["resuelta"]:
                db.execute(text("""
                    update momentum_senales
                    set resuelta = true, exit_date = :exit_date, ret = :ret,
                        motivo = :motivo, dias = :dias
                    where id = :id
                """), {
                    "exit_date": exit_final, "ret": ret_final, "motivo": motivo_final,
                    "dias": dias_final, "id": fila["id"],
                })
                if fila["estado"] == "ejecutada":
                    resueltas_ejecutadas.append(
                        {"ticker": s["ticker"], "ret": ret_final, "motivo": motivo_final})
            # Suelo VETADO POR EL GATE que sigue abierto y el precio ha vuelto a la banda tras
            # salir de ella: es la MISMA señal, vuelve a 'nueva' y se limpia el veredicto (la
            # noticia que la vetó pudo quedar vieja). Un descarte A MANO NO se reactiva: es una
            # decisión explícita, se respeta hasta que la señal se resuelva.
            elif (not fila["resuelta"] and fila["estado"] == "descartada"
                  and fila["gate_resultado"] == "falla" and s.get("reactivar")):
                db.execute(text("""
                    update momentum_senales
                    set estado = 'nueva', gate_resultado = null, gate_detalle = ''
                    where id = :id
                """), {"id": fila["id"]})
                if s["ticker"] not in apagados:
                    reactivadas.append(s["ticker"])
            continue
        db.execute(text("""
            insert into momentum_senales
              (ticker, sector, tipo, entry_date, entry_price, ref_label, ref_price,
               caida_pct, resuelta, exit_date, ret, motivo, dias, estado, ath, desde_noticias,
               cesta_60d, gate_regimen)
            values (:ticker, :sector, :tipo, :entry_date, :entry_price, :ref_label,
                    :ref_price, :caida_pct, :resuelta, :exit_date, :ret, :motivo, :dias,
                    'nueva', :ath, :desde_noticias, :cesta_60d, :gate_regimen)
            on conflict (ticker, tipo, entry_date) do nothing
        """), {
            "ticker": s["ticker"], "sector": s["sector"], "tipo": s["tipo"],
            "entry_date": entry_date, "entry_price": s["entry_price"],
            "ref_label": s["ref_label"], "ref_price": s["ref_price"],
            "caida_pct": s["caida_pct"], "resuelta": s["resuelta"],
            "exit_date": exit_final, "ret": ret_final, "motivo": motivo_final,
            "dias": dias_final, "ath": s["ath"], "desde_noticias": s["desde_noticias"].date(),
            "cesta_60d": cesta, "gate_regimen": gate_regimen,
        })
        if s["ticker"] not in apagados:
            nuevas += 1
            tickers_nuevos.append(s["ticker"])
    db.commit()
    if nuevas:
        logger.info("Momentum: %s señal(es) nueva(s) detectada(s), gate pendiente.", nuevas)
        plural = "es" if nuevas != 1 else ""
        push.send_to_all(
            db, title=f"Sala Real X: {nuevas} señal{plural} nueva{plural and 's'}",
            body=", ".join(tickers_nuevos), url="/momentum", tag="agentic-momentum",
        )
    if reactivadas:
        logger.info("Momentum: %s señal(es) de suelo reactivada(s) (vuelven a zona).",
                    len(reactivadas))
        plural = "es" if len(reactivadas) != 1 else ""
        push.send_to_all(
            db, title=f"Sala Real X: {len(reactivadas)} señal{plural} vuelve{'n' if plural else ''} a zona",
            body=", ".join(dict.fromkeys(reactivadas)), url="/momentum", tag="agentic-momentum",
        )
    for r in resueltas_ejecutadas:
        motivo_txt = "objetivo alcanzado" if r["motivo"] == "objetivo" else "90 días cumplidos"
        push.send_to_all(
            db, title=f"Sala Real X: {r['ticker']} -- {motivo_txt}",
            body=f"Resultado {r['ret']:+.1f}%. Revisa si toca vender.",
            url="/momentum", tag="agentic-momentum",
        )
    return {"nuevas": nuevas, "reactivadas": len(reactivadas),
            "resueltas": len(resueltas_ejecutadas)}


def run_momentum_scan(db) -> dict:  # noqa: ANN001 — Session, evitar el import circular con db.py
    """Escaneo del universo fijo de momentum (34 tickers): detecta señales nuevas y actualiza
    las que ya estaban abiertas y desde entonces se resolvieron de verdad (objetivo o 90 días).
    Reutilizable: la llama el cron y también `POST /admin/scan` (rescate manual). Deja subir la
    excepción -- cada llamador decide cómo reportarla.

    El gate se evalúa aparte, con un clic explícito de Manuel (ver `POST
    /momentum/gate/evaluar-pendientes` en momentum/routes.py) -- separar las dos cosas es la
    decisión de diseño del 7-sep-2026: el dinero lo controla él, nunca un cron silencioso."""
    from app.momentum import candidatos as momentum_candidatos
    from app.momentum import signals as momentum_signals

    # Los tickers que ya incorporaste desde el pipeline de descubrimiento entran aquí también,
    # sin tocar código (ver candidatos.sincronizar_universo -- decidido 8-sep-2026).
    momentum_candidatos.sincronizar_universo(db)
    todas = momentum_signals.compute_signals()
    resultado = procesar_señales(db, todas, universo=list(momentum_signals.UNIVERSO))
    return {**resultado, "total_universo": len(todas)}


def _momentum_scan_job() -> None:
    """Wrapper del cron: abre su propia sesión y se traga el error (logueado) -- un cron caído
    no puede tirar el proceso. El rescate manual (`run_momentum_scan` desde el endpoint) SÍ deja
    subir la excepción, para que el panel la enseñe."""
    db = SessionLocal()
    try:
        run_momentum_scan(db)
    except Exception:
        logger.exception("Fallo en el job de escaneo de momentum")
    finally:
        db.close()


def _apewisdom_job() -> None:
    """Wrapper del cron: captura (fase 1) + detección de rupturas de menciones (fase 2, gratis,
    sin LLM -- ver `momentum/candidatos.py`). Si ApeWisdom cae o cambia de forma, se loguea y no
    toca nada más."""
    db = SessionLocal()
    try:
        from app.momentum import apewisdom, candidatos
        n = apewisdom.capturar(db)
        nuevos = candidatos.detectar_rupturas(db)
        logger.info("ApeWisdom: %s tickers capturados, %s candidato(s) nuevo(s).", n, nuevos)
    except Exception:
        logger.exception("Fallo en la captura diaria de ApeWisdom")
    finally:
        db.close()


def start_scheduler() -> None:
    if not settings.enable_scheduler:
        logger.info("Scheduler desactivado (ENABLE_SCHEDULER=false)")
        return
    # Día 1 del mes: puede caer en fin de semana, y no pasa nada — `universe_for_scan` usa la
    # foto del último cierre (el job diario la mantiene fresca), no depende de que el mercado
    # esté abierto ese día exacto.
    trigger = CronTrigger(
        day=1,
        hour=settings.scan_cron_hour,
        minute=settings.scan_cron_minute,
        timezone=settings.scan_timezone,
    )
    # Gracia de misfire: con el default (~1 s), un proceso ocupado/reiniciándose justo a la hora
    # del cron SALTARÍA el escaneo en silencio hasta el mes siguiente (snapshot y reconcile
    # se auto-curan huecos; el escaneo no). Un día de margen lo cubre; coalesce=True evita
    # ejecutarlo dos veces si se acumularan varios misfires.
    scheduler.add_job(_scan_job, trigger=trigger, id="monthly_scan", replace_existing=True,
                      misfire_grace_time=86400, coalesce=True)
    # Cierre diario de la curva histórica: lun-vie 16:30 ET (cierre + retraso de yfinance).
    scheduler.add_job(
        _snapshot_job,
        CronTrigger(day_of_week="mon-fri", hour=16, minute=30, timezone=settings.scan_timezone),
        id="equity_snapshot", replace_existing=True,
    )
    # Foto del universo: 16:30 ET (recién cerrado) y reintentos hasta las 22:30 si NASDAQ falla.
    scheduler.add_job(
        _universe_job,
        CronTrigger(day_of_week="mon-fri", hour="16,18,20,22", minute=30,
                    timezone=settings.scan_timezone),
        id="universe_snapshot", replace_existing=True, misfire_grace_time=3600, coalesce=True,
    )
    # Universo global (HuggingFace): día 1 de cada mes, de madrugada y fuera de horas de mercado.
    scheduler.add_job(
        _universo_global_job,
        CronTrigger(day=1, hour=3, minute=0, timezone=settings.scan_timezone),
        id="universo_global", replace_existing=True, misfire_grace_time=86400, coalesce=True,
    )
    # Reconciliación de órdenes working cada 2 min (no-op sin órdenes vivas; ver _reconcile_job).
    scheduler.add_job(_reconcile_job, "interval", minutes=2, id="reconcile_working",
                      replace_existing=True)
    # Tasas de cambio a USD: 5:00 Europa/Madrid, antes de la analítica -- ver _fx_job.
    scheduler.add_job(
        _fx_job,
        CronTrigger(hour=5, minute=0, timezone="Europe/Madrid"),
        id="fx_sync", replace_existing=True, misfire_grace_time=3600, coalesce=True,
    )
    # Fichero DuckDB de /analytics/*: 6:00 hora española (no la del mercado US, esta la mira
    # Manuel, no el escaneo) — una vez al día basta (ver _analytics_sync_job).
    # POST /admin/sync-analytics existe para no esperar a esta hora.
    scheduler.add_job(
        _analytics_sync_job,
        CronTrigger(hour=6, minute=0, timezone="Europe/Madrid"),
        id="analytics_sync", replace_existing=True, misfire_grace_time=3600, coalesce=True,
    )
    # Momentum: detección diaria de señales nuevas (sin gate, coste cero) -- 16:05 ET, justo tras
    # el cierre (16:00 ET). Antes eran las 16:45, que en España son las 22:45 -- con el mercado
    # cerrado, sin ventana real para actuar. Manuel opera en after-market con el cierre real
    # (decidido 8-sep-2026), así que no hace falta esperar más que el margen de yfinance.
    scheduler.add_job(
        _momentum_scan_job,
        CronTrigger(day_of_week="mon-fri", hour=16, minute=5, timezone=settings.scan_timezone),
        id="momentum_scan", replace_existing=True, misfire_grace_time=3600, coalesce=True,
    )
    # ApeWisdom: captura diaria de menciones sociales (fase 1, solo guardar -- ver
    # momentum/apewisdom.py). Mismo horario que el escaneo por simplicidad, sin cron propio.
    scheduler.add_job(
        _apewisdom_job,
        CronTrigger(day_of_week="mon-fri", hour=16, minute=10, timezone=settings.scan_timezone),
        id="apewisdom_capture", replace_existing=True, misfire_grace_time=3600, coalesce=True,
    )
    scheduler.start()
    logger.info(
        "Scheduler arrancado: escaneo mensual día 1 %02d:%02d %s",
        settings.scan_cron_hour, settings.scan_cron_minute, settings.scan_timezone,
    )


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
