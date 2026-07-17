"""Configuración de la aplicación (pydantic-settings).

Todas las variables se leen de `backend/.env` (ver `.env.example`). Centralizarlas
aquí permite tener un único punto de verdad y validación de tipos al arrancar.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Base de datos: SQLite en local, Postgres (Supabase) en prod.
    database_url: str = "sqlite:///./agentic_trader.db"

    # Memoria vectorial (sqlite-vec): RUTA de fichero pelada (NO una URL SQLAlchemy — la abre
    # sqlite3 crudo). Local: junto al backend; en Railway: en el volumen → /data/agent_memory.db.
    memory_db_path: str = "agent_memory.db"

    # Scheduler de escaneo. Cron semanal anclado a la hora del MERCADO (no UTC ni España) para
    # que sobreviva a los cambios de horario de verano: martes 10:15 ET = ~30 min tras la apertura,
    # ajustado al retraso de 15 min de yfinance → la foto cae sobre el mercado ya asentado (~10:00 ET).
    enable_scheduler: bool = True
    scan_cron_day: str = "tue"                 # día(s) de la semana (APScheduler: mon,tue,...)
    scan_cron_hour: int = 10
    scan_cron_minute: int = 15
    scan_timezone: str = "America/New_York"    # ancla a la bolsa US (sobrevive al horario de verano)
    # Cadencia doble: la SOMBRA se recalibra en cada escaneo del cron (semanal, gratis, más datos),
    # pero la sala REAL solo recibe propuestas en el PRIMER escaneo programado del mes — la señal
    # del scorer es mensual y así se evita churn de ruido con dinero real. Los escaneos MANUALES
    # (botón «Analizar mercado») siempre proponen. False = proponer en todos los escaneos.
    real_proposals_monthly: bool = True

    # CORS: orígenes permitidos del frontend, separados por coma.
    cors_origins: str = "http://localhost:3000"

    # Login de acceso. Contraseña única (env APP_PASSWORD en Railway). VACÍA = auth DESACTIVADA
    # (dev local sin candado). Con valor → toda la API (menos /health y /auth/login) exige un
    # token firmado que se obtiene en /auth/login con esta contraseña.
    app_password: str = ""
    auth_token_days: int = 0     # validez del token de sesión en días; 0 = NO caduca nunca
                                 # (sesión permanente en el navegador; revocable cambiando la contraseña)

    # LLM. Método = ranker fundamental (whitepaper DeepSeek): V4-Pro razonador en TODO
    # (scorer por nombre + outlook macro + construcción). enable_llm=False → escaneo no falla.
    enable_llm: bool = False
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Embudo en 2 pasos: pre-score RÁPIDO (Flash) de todo el universo → informe PROFUNDO
    # (V4-Pro razonador) + price target + construcción solo sobre los finalistas.
    llm_model: str = "deepseek/deepseek-v4-pro"          # profundo: informe + target + construcción
    prescore_model: str = "deepseek/deepseek-v4-flash"   # rápido: ranking 1-100 de todo el universo
    # Corte de finalistas al profundo (fiel al paper, sin colapsar en un solo sector):
    #   top-`deep_per_sector` por sector (amplitud) ∪ top-`deep_finalists` global (los mejores)
    #   + posiciones + top-`deep_watchlist` watchlist, truncado a `deep_finalists_cap`.
    deep_per_sector: int = 2                             # top-N por sector (recall de amplitud)
    deep_finalists: int = 25                             # top-N global por pre-score
    deep_watchlist: int = 5                              # + mejores de la watchlist (continuidad)
    deep_top_caps: int = 10                              # las N mayores caps SIEMPRE al profundo
    deep_finalists_cap: int = 50                         # tope DURO de finalistas (coste V4-Pro)
    select_count: int = 10                               # nombres al constructor (paper: "top 10")
    llm_temperature: float = 0.3

    # Guardarraíles del sleeve (LOCKED). Cartera de TAMAÑO FIJO (paper 15 assets → aquí 5).
    max_position_pct: float = 35.0  # % máximo por posición
    max_positions: int = 5          # nº de posiciones de la cartera (FIJO: min = max = 5)
    min_positions: int = 5          # = max_positions → cartera de EXACTAMENTE 5 nombres
    fully_invested: bool = True     # True = sin caja: los pesos se normalizan a 100% (método paper)

    # Universo + muestreo del escaneo.
    universe_market_cap_min: float = 0                   # SIN suelo de cap: todo el mercado US
    universe_market_cap_max: float = 10_000_000_000_000
    universe_min_avg_volume: int = 300_000               # liquidez mínima (gate)
    universe_min_price: float = 5.0                      # descarta penny stocks < $5 (higiene)
    scan_full_universe: bool = True  # mensual: pre-score TODO el universo (cobertura total, ~15 min)
    scan_sample_size: int = 500     # semanal: ventana ROTATORIA de N (~5 semanas tejen el universo)
    leaderboard_size: int = 20      # cuántos muestra el panel además de la cartera
    min_buy_score: int = 0          # 0 = SIN suelo (fiel al paper: entra por score, sin nota mínima)

    # Watchlist relacional — memoria de scores altos: entran siempre al escaneo y sus mejores
    # pasan al análisis profundo (continuidad entre escaneos).
    watchlist_entry_score: int = 80  # entra si score PROFUNDO >= (solo guarda scores profundos)
    watchlist_evict_score: int = 70  # sale si al re-analizar cae por debajo de
    watchlist_max: int = 50          # tope de nombres (protege la exploración random)
    watchlist_stale_days: int = 28   # caduca si no vuelve a puntuar alto en N días

    # Ejecución en la cuenta REAL. DRY_RUN por defecto: simula el fill, no envía órdenes.
    # NADA se ejecuta sin la aprobación explícita del usuario (Sí/No) — ni en dry-run.
    dry_run: bool = True
    approval_expiry_days: int = 3   # una propuesta sin decidir caduca (datos rancios)
    # Órdenes SIEMPRE a LÍMITE (nunca a mercado): el límite = precio de referencia ± este
    # colchón (buy: +%, sell: −%). Es un "límite ejecutable": entra ya al precio actual pero
    # NUNCA peor que ref±buffer (protege de huecos/malos prints). 0.0 = límite estricto al ref.
    limit_buffer_pct: float = 0.2
    # Al aprobar en vivo, cuánto se sondea el estado de la orden límite en IBKR esperando el fill
    # antes de dejarla como 'working' (se reconcilia después al refrescar la Sala Real).
    order_poll_seconds: int = 12

    # IBKR Web API OAuth 1.0a headless vía ibind (self-service portal, cuenta individual Pro).
    # Se generan claves RSA locales, se suben las públicas al portal y se pegan aquí las rutas
    # y tokens. Hasta entonces el broker es DryRunBroker (simulación).
    ibkr_account_id: str = ""
    ibkr_oauth_consumer_key: str = ""              # 9 caracteres A-Z del portal
    ibkr_oauth_access_token: str = ""
    ibkr_oauth_access_token_secret: str = ""
    ibkr_oauth_signature_key_path: str = ""        # private_signature.pem
    ibkr_oauth_encryption_key_path: str = ""       # private_encryption.pem
    ibkr_oauth_dh_prime: str = ""                  # hex del dhparam.pem
    # Cloud (Railway): los .pem no viajan por git — se suben en BASE64 como env vars y al
    # arrancar `materialize_pems()` los vuelca a ficheros temporales y apunta los *_key_path.
    # En local se dejan vacías (se usan las rutas de arriba directamente).
    ibkr_pem_signature_b64: str = ""
    ibkr_pem_encryption_b64: str = ""

    # Web Push (VAPID) — notificaciones gratis, sin Firebase ni terceros.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"  # sobrescribe con tu email vía .env

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
