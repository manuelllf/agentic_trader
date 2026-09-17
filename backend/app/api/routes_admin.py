"""Mantenimiento: estado de frescura de datos, sync de FX/analitica, volcado de BD,
fotos de fundamentales y universo global (HuggingFace). Todo detras de require_auth."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import foto_service
from app.db import get_db
from app.ledger import service as ledger
from app.models import utc_iso

router = APIRouter()          # exige require_auth (montado en app/api/routes.py)


@router.get("/admin/estado-datos")
def admin_estado_datos(db: Session = Depends(get_db)) -> dict:
    """Frescura de cada fuente que alimenta un escaneo (universo, fotos, tasas) — para que el
    centro de operaciones diga "puedes lanzar" o "te falta esto" ANTES de gastar, en vez de
    descubrirlo a mitad. Solo lecturas agregadas, nada de traerse las filas."""
    from sqlalchemy import func

    from app.models import FundamentalsSnapshot, FxRate
    from app.screener import universe as universe_mod

    def _foto(es_dataset: bool) -> dict:
        at, n = (db.query(func.max(FundamentalsSnapshot.captured_at),
                         func.count(func.distinct(FundamentalsSnapshot.ticker)))
                .filter(FundamentalsSnapshot.es_dataset.is_(es_dataset)).one())
        return {"at": utc_iso(at) if at else None, "n": n or 0}

    # "elegibles" = lo que pasa precio/cap/tipo de instrumento; "a_escanear" = tras liquidez y
    # tope. Solo lee la BD: sin snapshot no dispara ningún fetch en vivo a NASDAQ.
    uni_at = universe_mod._ultimo_snapshot_at(db)
    if uni_at is not None:
        filas = universe_mod._filas_de(db, uni_at)
        uni_elegibles = len(universe_mod._elegibles(filas))
        uni_a_escanear = len(universe_mod._liquidos(filas))
    else:
        uni_elegibles = uni_a_escanear = 0
    fx_at = db.query(func.max(FxRate.synced_at)).scalar()
    fx_n = (db.query(func.count(FxRate.currency_code))
           .filter(FxRate.synced_at == fx_at).scalar() if fx_at else 0)
    return {
        "universo": {"at": utc_iso(uni_at) if uni_at else None,
                    "elegibles": uni_elegibles, "a_escanear": uni_a_escanear},
        "foto_nasdaq": _foto(False),
        "foto_global": _foto(True),
        "fx": {"at": utc_iso(fx_at) if fx_at else None, "n": fx_n or 0},
    }


@router.post("/admin/fx-sync")
def admin_fx_sync(db: Session = Depends(get_db)) -> dict:
    """Lanza a mano la sincronización de tasas de cambio + recálculo de `market_cap_usd` (ver
    `app/screener/fx.py`). También corre sola a las 5:00 Europa/Madrid — esto es para no esperar
    a esa hora antes de un scan `global_topcap`."""
    from app.screener import fx as fx_mod

    try:
        return {"ok": True, **fx_mod.sincronizar(db)}
    except Exception as exc:  # noqa: BLE001 — scraper de Yahoo caído: mensaje legible, no 500
        return {"ok": False, "error": str(exc)}


@router.post("/admin/sync-analytics")
def admin_sync_analytics() -> dict:
    """Reconstruye el fichero DuckDB persistente de `/analytics/*` desde Postgres (ver
    `app/analytics_sync.sync`). También corre solo, una vez al día (ver `scheduler.py`) — esto
    es para no esperar hasta la próxima pasada tras un escaneo nuevo."""
    from app import analytics_sync

    try:
        counts = analytics_sync.sync()
    except ImportError:
        raise HTTPException(503, "DuckDB no está instalado (extra `analytics` del backend).")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — Postgres caído/ATTACH roto: mensaje legible, no 500
        raise HTTPException(503, f"No se pudo sincronizar: {exc}") from exc
    return {"ok": True, "counts": counts}


class SeedIn(BaseModel):
    version: int | None = None
    tables: dict[str, list[dict]]


@router.post("/admin/seed")
def admin_seed(body: SeedIn, db: Session = Depends(get_db)) -> dict:
    """DESTRUCTIVO: reemplaza TODA la base de datos por el snapshot subido (mismo esquema).

    Protegido por token (require_auth) y transaccional sobre la conexión de la sesión: si algo
    falla, rollback y la DB queda intacta. Migra de un tirón la imagen local a la nube.
    """
    from app import dbdump
    try:
        out = dbdump.import_all(db.connection(), body.model_dump())
        db.commit()
        return out
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
    except Exception:
        db.rollback()
        raise


@router.post("/admin/reset-shadow")
def admin_reset_shadow(db: Session = Depends(get_db)) -> dict:
    """DESTRUCTIVO — SOLO libro SOMBRA (escaparate). Vacía holdings/operaciones/curva del sombra
    conservando el capital (queda en caja); NO toca el libro real ni la cartera personal. Para
    descartar la salida de un escaneo defectuoso. Protegido por token."""
    return ledger.reset_shadow_book(db)


@router.post("/admin/universe-snapshot")
def admin_universe_snapshot(db: Session = Depends(get_db)) -> dict:
    """Relanza a mano la foto del universo (la misma toma de datos que corre el job de las
    16:30 ET): si una noche NASDAQ no respondió y el cron se quedó sin foto, el dueño la repite
    desde la web antes del escaneo del martes, sin esperar a los reintentos automáticos.

    La fuente externa (NASDAQ) falla de mil maneras (timeouts, 200 con cuerpo vacío...) y eso
    NO es un error del backend: se atrapa aquí y viaja como `{"ok": false, "error": ...}` con
    200, no como un 500.
    """
    from app.screener import universe as universe_mod

    try:
        info = universe_mod.refresh_snapshot_and_report(db)
        return {"ok": True, **info}
    except Exception as exc:  # noqa: BLE001 — el motivo legible es lo que necesita el panel
        return {"ok": False, "error": str(exc)}


@router.post("/admin/foto")
def admin_foto(alcance: str = Query("nasdaq", pattern="^(nasdaq|global)$"),
               limite: int | None = Query(None, ge=1),
               countries: list[str] | None = Query(None),
               exchanges: list[str] | None = Query(None)) -> dict:
    """Lanza la foto de fundamentales a demanda, en segundo plano.

    Separa recoger datos de puntuarlos: fotografiar a las 10:00 y escanear off-peak a las 13:00
    (mitad de tarifa) sale del mismo dato. El progreso vivo va por `/scan/progress`.
    `countries`/`exchanges` (multi-select, AND entre sí) solo aplican con `alcance=global` — el
    universo global no trae precio/cap/volumen (ver `universe_global.py`), así que país/mercado
    es el único filtro barato disponible antes de gastar peticiones reales a Yahoo.
    """
    if not foto_service.start(alcance=alcance, limite=limite,
                              countries=countries, exchanges=exchanges):
        raise HTTPException(409, "Ya hay una foto o un escaneo en marcha.")
    return {"started": True, **foto_service.get_status()}


@router.get("/admin/foto")
def admin_foto_status() -> dict:
    return foto_service.get_status()


@router.post("/admin/universo-global")
def admin_universo_global() -> dict:
    """Lanza a mano la sincronización del universo global de HuggingFace en segundo plano (el
    job lo hace mensualmente). En segundo plano porque ~63.000 filas descargadas + insertadas
    superan el timeout del proxy si se hace dentro del propio request (visto en vivo,
    25-ago-2026) — el progreso se consulta con `GET /admin/universo-global/estado`.
    """
    from app.screener import universe_global

    if not universe_global.start():
        raise HTTPException(409, "Ya hay una sincronización en marcha.")
    return {"started": True, **universe_global.get_status()}


@router.get("/admin/universo-global/estado")
def admin_universo_global_estado() -> dict:
    from app.screener import universe_global

    return universe_global.get_status()


@router.post("/admin/universo-global/subir-csv")
async def admin_universo_global_subir_csv(archivo: UploadFile = File(...)) -> dict:
    """Sincroniza el universo global desde un CSV ya descargado a mano (mismo formato que
    `universe_global.URL_CSV`), en vez de que el propio servidor descargue de HuggingFace --
    para cuando la red de ellos no coopera, o para revisar el fichero antes de subirlo.
    """
    from app.screener import universe_global

    contenido = await archivo.read()
    if not universe_global.start(contenido=contenido):
        raise HTTPException(409, "Ya hay una sincronización en marcha.")
    return {"started": True, **universe_global.get_status()}


@router.get("/admin/universo-global")
def admin_universo_global_opciones(db: Session = Depends(get_db)) -> dict:
    """Estado del universo global sincronizado: fecha, total, y países/mercados con su
    recuento real — para el picker de `POST /admin/foto?alcance=global`, que nunca debe ser
    "elige a ciegas"."""
    from app.screener import universe_global

    return universe_global.opciones(db)


@router.get("/admin/universo-global/contar")
def admin_universo_global_contar(
    countries: list[str] | None = Query(None), exchanges: list[str] | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    """Cuenta EXACTA de tickers para una combinación país/mercado, sin traerse la lista entera
    — el aviso "vas a capturar N tickers" antes de que se pueda confirmar."""
    from app.screener import universe_global

    return {"count": universe_global.contar(db, countries=countries, exchanges=exchanges)}


@router.get("/admin/memory-status")
def admin_memory_status() -> dict:
    """Diagnóstico read-only de la memoria vectorial: ruta, nº de recuerdos y si las deps están
    instaladas. NO carga el modelo de embeddings — solo abre el fichero y cuenta. Confirma que el
    volcado llegó al volumen sin esperar a ver un `recall` en los logs del próximo escaneo."""
    from app import memory

    return memory.status()

