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
    # Cadencia de DECISIÓN: la cartera (sombra Y propuestas a la real) solo se decide en el
    # PRIMER escaneo programado del mes — la señal del scorer es mensual ("próximo mes") y
    # rebalancear cada semana sería operar el ruido del LLM, además de impedir ver si cada
    # elección funciona (no vive su mes). Los escaneos semanales restantes son OBSERVATORIO:
    # ranking, watchlist, memoria y auditoría al día, sin tocar ningún libro. Los MANUALES
    # (botón «Analizar mercado») siempre deciden. False = todos los escaneos deciden.
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
    # "max" a propósito, para medir si el razonamiento extra compra algo — sube el razonamiento
    # a ~95% de los tokens de la llamada, pero el razonamiento oculto YA se facturaba como
    # completion tokens sin este campo (ver
    # `_PRICING` en openrouter.py), así que esto es un multiplicador de coste REAL, no cosmético.
    # Confirmado por API (GET /api/v1/models) que v4-pro, v4-flash y v4-flash-0731 declaran
    # "reasoning" en supported_parameters antes de activarlo. None desactiva el campo entero.
    reasoning_effort: str | None = "max"
    # PRIORIDAD 1 (medida en producción, escaneo del 8/9-ago): el pre-score con razonamiento
    # "max" costó $2,6655 —el doble de lo estimado sin él— sobre ~3.000 llamadas de un triaje
    # barato que no necesita razonar mucho. El profundo, la capa media y el constructor son
    # decenas de llamadas, así que ahí el coste extra sí compra algo. None = sin el campo
    # (el proveedor decide su nivel por defecto), igual que el resto del circuito antes de max.
    prescore_reasoning_effort: str | None = None
    # Circuito ÚNICO en flash-0731 — profundo, pre-score, capa media y constructor. V4-Pro
    # descartado del todo. Alias fijado a fecha y no el genérico: el genérico apunta a un
    # snapshot MÁS VIEJO y cuesta 0,14/0,28 por millón, mientras el 0731 es más reciente y
    # cuesta 0,09/0,18. Se fija a propósito: si el modelo cambiara solo entre escaneos, los
    # scores dejarían de ser comparables y la auditoría histórica perdería sentido.
    llm_model: str = "deepseek/deepseek-v4-flash-0731"   # profundo: informe + target + construcción
    prescore_model: str = "deepseek/deepseek-v4-flash-0731"  # rápido: ranking 1-100 del universo
    # Capa media: repuntúa los mejores de cada sector entre el pre-score y el profundo
    # (implementación en otro módulo; aquí solo se declara la config).
    mid_layer: bool = True          # capa media: repuntúa los mejores de cada sector
    mid_per_sector: int = 10        # cuántos por sector entran a la capa media
    # Tope DURO, como el `deep_finalists_cap` del profundo. Sin él, la capa media es la única
    # etapa cuyo tamaño lo decide un dato EXTERNO: 10 × (sectores que traiga yfinance ese día).
    # Hoy son ~11 sectores (~110 llamadas), pero el número no lo fijamos nosotros — si el campo
    # `sector` viniera sucio, cada valor raro abriría su propio cupo de 10 llamadas al modelo
    # caro. 150 deja aire sobre las ~110 normales y convierte un fallo de datos en un recorte,
    # no en una factura. Al truncar se conservan los de MAYOR pre-score (la lista llega ordenada).
    mid_candidates_cap: int = 150
    # Mismo modelo que el pre-score (0731 en todo el circuito): la capa media deja de ser una
    # SEGUNDA OPINIÓN de un modelo mejor y pasa a ser un re-muestreo del mismo modelo sobre el
    # mismo prompt corto. Sigue reduciendo ruido de una tirada suelta (promedia dos llamadas en
    # vez de fiarse de una), pero ya no aporta el juicio de un modelo distinto.
    mid_model: str = "deepseek/deepseek-v4-flash-0731"
    # Corte de finalistas al profundo (fiel al paper, sin colapsar en un solo sector):
    #   top-`deep_per_sector` por sector (amplitud) ∪ top-`deep_finalists` global (los mejores)
    #   + posiciones + top-`deep_watchlist` watchlist, truncado a `deep_finalists_cap`.
    # El carril sectorial vale 2 cuando NO hay capa media (el semanal): es la única garantía de
    # que el profundo vea cada sector. Cuando la capa media corre (el mensual), un modelo bueno
    # ya ha puntuado el top-10 de CADA sector, así que basta 1 como red de seguridad.
    deep_per_sector: int = 2                             # top-N por sector (recall de amplitud)
    deep_per_sector_mid: int = 1                         # ídem cuando hubo capa media
    deep_finalists: int = 25                             # top-N global por pre-score
    deep_watchlist: int = 5                              # + mejores de la watchlist (continuidad)
    deep_top_caps: int = 10                              # las N mayores caps SIEMPRE al profundo
    deep_finalists_cap: int = 50                         # tope DURO de finalistas (coste V4-Pro)
    select_count: int = 10                               # nombres al constructor (paper: "top 10")
    # Lote del pre-score (medido en vivo el 09/10-ago): agrupar N tickers en una sola llamada
    # amortiza la sobrecarga fija por llamada (18,5-49s de una sola empresa, dominada por cola
    # del proveedor detrás del alias, no por generación) entre las N — 2.997 llamadas individuales
    # bajan a ~150 de 20. Probado en vivo con 20/20: limpio, sin JSON roto ni tickers ausentes.
    # Riesgo medido y ya cubierto (ver `scorer.prescore_batch`): 1 de 2 lotes de prueba colapsó
    # a un solo decimal en las 20 notas a la vez — guardarraíl estadístico + reintento del lote
    # entero. Solo el pre-score puro; capa media y profundo se quedan individuales (muchas menos
    # llamadas, no compensa la complejidad).
    prescore_batch_size: int = 20

    # Guardarraíles del sleeve (LOCKED). Cartera de TAMAÑO FIJO (paper 15 assets → aquí 5).
    max_position_pct: float = 35.0  # % máximo por posición
    max_positions: int = 5          # nº de posiciones de la cartera (FIJO: min = max = 5)
    min_positions: int = 5          # = max_positions → cartera de EXACTAMENTE 5 nombres
    fully_invested: bool = True     # True = sin caja: los pesos se normalizan a 100% (método paper)

    # Universo + muestreo del escaneo.
    universe_market_cap_min: float = 0                   # SIN suelo de cap: todo el mercado US
    universe_market_cap_max: float = 10_000_000_000_000
    # Liquidez en DÓLARES negociados al día (precio × volumen), no en número de acciones:
    # contar acciones castiga a los caros (PLMR mueve $41M/día y no llegaba a 300k acciones).
    universe_min_dollar_volume: float = 3_000_000
    # Tope DURO de nombres (los de MÁS dinero negociado). El suelo solo no basta: con umbral
    # fijo, el tamaño del universo lo decide lo movida que estuviera la sesión de la foto —
    # la misma descarga da 2.317 o 2.731 nombres según cuánto llevaba negociado el mercado.
    # Como el pre-scorer gasta UNA llamada por nombre, eso es dejar el coste al azar. Con tope,
    # el gasto está acotado por diseño y el recorte cae donde debe: en los menos negociados.
    # 3.000: con el tope en 2.600, una foto real dejó fuera 433 nombres que SÍ pasaban el
    # suelo de liquidez, y el recorte los ordena por volumen — el mismo sesgo hacia "lo que se
    # estaba moviendo" que la foto al cierre venía a evitar, colándose por la puerta del tope.
    universe_max_names: int = 3_000
    universe_min_price: float = 5.0                      # descarta penny stocks < $5 (higiene)
    scan_full_universe: bool = True  # mensual: pre-score TODO el universo (cobertura total, ~15 min)
    # semanal: ventana ROTATORIA de N. Con el universo en 3.000 nombres, 500 tejía el universo
    # entero en 6 semanas; con 750 lo teje en 4 — coste extra: ~4,5 céntimos más por escaneo.
    scan_sample_size: int = 750
    leaderboard_size: int = 20      # cuántos muestra el panel además de la cartera
    min_buy_score: int = 0          # 0 = SIN suelo (fiel al paper: entra por score, sin nota mínima)

    # Watchlist relacional — memoria de scores altos: entran siempre al escaneo y sus mejores
    # pasan al análisis profundo (continuidad entre escaneos).
    watchlist_entry_score: int = 80  # entra si score PROFUNDO >= (solo guarda scores profundos)
    watchlist_evict_score: int = 70  # sale si al re-analizar cae por debajo de
    watchlist_max: int = 50          # tope de nombres (protege la exploración random)
    watchlist_stale_days: int = 28   # caduca si no vuelve a puntuar alto en N días

    # Comisión SIMULADA (tarifa fija de IBKR para acciones US). Solo la cobran los libros
    # simulados — sombra y real-en-dry-run —; con bróker en vivo se apunta la de IBKR, no esta.
    # Sin ella, la curva que se publica mediría una rentabilidad bruta que nadie puede obtener:
    # a ~$2.000 y ~10 operaciones por rebalanceo, el suelo por orden ya pesa ~0,5% al mes.
    # Poner per_share y min a 0 desactiva el modelo. Ver `app/commissions.py`.
    commission_per_share: float = 0.005   # $/acción
    commission_min: float = 1.0           # suelo por orden
    commission_max_pct: float = 1.0       # techo: % del importe de la orden

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
