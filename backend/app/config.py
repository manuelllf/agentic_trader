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

    # Ruta de fichero pelada (NO una URL SQLAlchemy — la abre sqlite3 crudo).
    # En Railway vive en el volumen → /data/agent_memory.db.
    memory_db_path: str = "agent_memory.db"

    # Cron anclado a la hora del MERCADO (no UTC): sobrevive al cambio de horario y cae con la
    # foto ya asentada tras el retraso de 15 min de yfinance.
    enable_scheduler: bool = True
    scan_cron_day: str = "tue"                 # día(s) de la semana (APScheduler: mon,tue,...)
    scan_cron_hour: int = 10
    scan_cron_minute: int = 15
    scan_timezone: str = "America/New_York"    # ancla a la bolsa US (sobrevive al horario de verano)
    # La cartera solo se decide en el primer escaneo del mes (señal del scorer es mensual); el
    # resto son observatorio: ranking/watchlist/auditoría al día, sin tocar ningún libro.
    real_proposals_monthly: bool = True

    # CORS: orígenes permitidos del frontend, separados por coma.
    cors_origins: str = "http://localhost:3000"

    # Contraseña única (env APP_PASSWORD). Vacía = auth desactivada (dev local sin candado).
    app_password: str = ""
    auth_token_days: int = 0     # validez del token de sesión en días; 0 = NO caduca nunca
                                 # (sesión permanente en el navegador; revocable cambiando la contraseña)

    # LLM. Método = ranker fundamental (whitepaper DeepSeek): V4-Pro razonador en TODO
    # (scorer por nombre + outlook macro + construcción). enable_llm=False → escaneo no falla.
    enable_llm: bool = False
    # "openrouter" solo para pruebas puntuales locales; nunca fallback automático en producción.
    llm_provider: str = "deepseek"
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    # Reasoning caro solo donde hay pocas llamadas (macro/constructor=1, profundo≤100). "low" en
    # lotes de 20 degradó la granularidad del prescore (menos decimales, peor correlación con el
    # profundo) y costó 2,6× más — vuelve a "none", que da 2 decimales limpios siempre.
    # "high" y no "max": es el default documentado de DeepSeek (el camino más probado) y la doc
    # no publica qué cambia internamente entre niveles — sin evidencia, el default gana.
    macro_reasoning_effort: str | None = "high"
    prescore_reasoning_effort: str | None = "none"
    mid_reasoning_effort: str | None = "low"
    deep_reasoning_effort: str | None = "high"
    reasoning_effort: str | None = "high"   # constructor
    # Alias ROLLING de la API directa de DeepSeek, sin snapshot fechado invocable: se pierde la
    # garantía de que el modelo no cambie solo entre escaneos (no hay forma de pinnear).
    llm_model: str = "deepseek-v4-pro"      # profundo + macro + constructor
    prescore_model: str = "deepseek-v4-flash"  # triaje: ranking 1-100 del universo
    mid_layer: bool = True          # capa media: repuntúa los mejores de cada sector
    # Sectores grandes (Financial Services, Consumer Cyclical...) mandaban solo 10 a la capa
    # media: un #11-15 genuinamente bueno no tenía oportunidad de competir en el carril global.
    mid_per_sector: int = 15        # cuántos por sector entran a la capa media
    # Tope duro: sin él, el tamaño de la capa media lo decide un dato externo (sectores que trae
    # yfinance ese día) — protege de un fallo de datos. 300→200: el nuevo precio peak/off-peak
    # de DeepSeek dobló el coste de esta etapa, recorte de gasto puro (menos llamadas caras).
    mid_candidates_cap: int = 200
    # V4-Pro directo (no el mismo alias que el pre-score): recupera el juicio de un modelo
    # distinto en vez de un re-muestreo del mismo.
    mid_model: str = "deepseek-v4-pro"
    # Corte de finalistas al profundo: top-`deep_per_sector` (amplitud) ∪ posiciones ∪ seguimiento
    # personal ∪ watchlist ∪ mayores caps ∪ el resto por score, todo truncado a `deep_finalists_cap`.
    # El carril sectorial vale 2 sin capa media (única garantía de ver cada sector); 1 con ella.
    deep_per_sector: int = 2                             # top-N por sector (recall de amplitud)
    deep_per_sector_mid: int = 1                         # ídem cuando hubo capa media
    deep_watchlist: int = 5                              # + mejores de la watchlist (continuidad)
    deep_top_caps: int = 10                              # las N mayores caps SIEMPRE al profundo
    # Tope pensado para acotar gasto (coste lineal por llamada), no un límite de calidad. 100→70:
    # mismo recorte que `mid_candidates_cap`, por el nuevo precio peak/off-peak de DeepSeek.
    deep_finalists_cap: int = 70                          # tope DURO de finalistas (coste V4-Pro)
    # Literal del paper (Exhibit 1: "Selection of top 10 companies based on the scores") —
    # fidelidad sobre ampliar el corte, aunque el código puro sea ciego a matices de frontera.
    select_count: int = 10                               # nombres al constructor (fiel al paper)
    # Llegan SIEMPRE al profundo para ver la opinión del sistema sobre la cartera PERSONAL
    # (IBKR) de Manuel; compiten en igualdad, sin veto — nunca implican nada sobre el agente.
    always_deep_tickers: list[str] = ["MSFT", "HUMA", "ASTS", "BTC-USD"]
    # Solo con `llm_provider="openrouter"` (pruebas locales); con "deepseek" el prescore es 1
    # llamada/ticker, fiel al paper — proveedor propio + concurrencia + caché lo hacen asumible.
    prescore_batch_size: int = 20

    # Guardarraíles del sleeve (LOCKED). Cartera de TAMAÑO FIJO (paper 15 assets → aquí 5).
    max_position_pct: float = 35.0  # % máximo por posición
    max_positions: int = 5          # nº de posiciones de la cartera (FIJO: min = max = 5)
    min_positions: int = 5          # = max_positions → cartera de EXACTAMENTE 5 nombres
    fully_invested: bool = True     # True = sin caja: los pesos se normalizan a 100% (método paper)

    # Universo + muestreo del escaneo.
    universe_market_cap_min: float = 0                   # SIN suelo de cap: todo el mercado US
    universe_market_cap_max: float = 10_000_000_000_000
    # Liquidez en DÓLARES negociados/día (no en acciones): contar acciones castiga a los caros.
    universe_min_dollar_volume: float = 3_000_000
    # Tope duro por dinero negociado: sin él, el tamaño del universo (y el coste del pre-score,
    # 1 llamada/nombre) queda al azar de lo movida que estuviera la sesión de la foto.
    universe_max_names: int = 3_000
    universe_min_price: float = 5.0                      # descarta penny stocks < $5 (higiene)
    scan_full_universe: bool = True  # mensual: pre-score TODO el universo (cobertura total, ~15 min)
    scan_sample_size: int = 750     # semanal: ventana rotatoria (teje el universo en varias semanas)
    leaderboard_size: int = 20      # cuántos muestra el panel además de la cartera
    min_buy_score: int = 0          # 0 = SIN suelo (fiel al paper: entra por score, sin nota mínima)

    # Watchlist relacional — memoria de scores altos: entran siempre al escaneo y sus mejores
    # pasan al análisis profundo (continuidad entre escaneos).
    watchlist_entry_score: int = 80  # entra si score PROFUNDO >= (solo guarda scores profundos)
    watchlist_evict_score: int = 70  # sale si al re-analizar cae por debajo de
    watchlist_max: int = 50          # tope de nombres (protege la exploración random)
    watchlist_stale_days: int = 28   # caduca si no vuelve a puntuar alto en N días

    # Comisión SIMULADA (tarifa IBKR): solo la cobran sombra y real-en-dry-run — con bróker en
    # vivo se apunta la de IBKR real. Sin ella la curva mediría rentabilidad bruta inobtenible.
    commission_per_share: float = 0.005   # $/acción
    commission_min: float = 1.0           # suelo por orden
    commission_max_pct: float = 1.0       # techo: % del importe de la orden

    # Ejecución en la cuenta REAL. DRY_RUN por defecto: simula el fill, no envía órdenes.
    # NADA se ejecuta sin la aprobación explícita del usuario (Sí/No) — ni en dry-run.
    dry_run: bool = True
    approval_expiry_days: int = 3   # una propuesta sin decidir caduca (datos rancios)
    # "Límite ejecutable": entra ya al precio actual pero nunca peor que ref±buffer (protege de
    # huecos/malos prints). 0.0 = límite estricto al ref.
    limit_buffer_pct: float = 0.2
    # Al aprobar en vivo, cuánto se sondea el estado de la orden límite en IBKR esperando el fill
    # antes de dejarla como 'working' (se reconcilia después al refrescar la Sala Real).
    order_poll_seconds: int = 12

    # IBKR Web API OAuth 1.0a headless vía ibind (self-service portal, cuenta individual Pro).
    # Hasta que estén todas rellenas, el broker es DryRunBroker (simulación).
    ibkr_account_id: str = ""
    ibkr_oauth_consumer_key: str = ""              # 9 caracteres A-Z del portal
    ibkr_oauth_access_token: str = ""
    ibkr_oauth_access_token_secret: str = ""
    ibkr_oauth_signature_key_path: str = ""        # private_signature.pem
    ibkr_oauth_encryption_key_path: str = ""       # private_encryption.pem
    ibkr_oauth_dh_prime: str = ""                  # hex del dhparam.pem
    # Cloud (Railway): los .pem no viajan por git — van en BASE64 como env vars y
    # `materialize_pems()` los vuelca a ficheros temporales al arrancar.
    ibkr_pem_signature_b64: str = ""
    ibkr_pem_encryption_b64: str = ""

    # Web Push (VAPID) — notificaciones gratis, sin Firebase ni terceros.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"  # sobrescribe con tu email vía .env

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_api_key_present(self) -> bool:
        """La key del proveedor CONFIGURADO, no ambas — evita exigir OPENROUTER_API_KEY cuando
        el circuito real es DeepSeek directo."""
        if self.llm_provider == "openrouter":
            return bool(self.openrouter_api_key)
        return bool(self.deepseek_api_key)


settings = Settings()
