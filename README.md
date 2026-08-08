# Agentic Trader

Asistente personal de inversión sistemática. Un ranker fundamental basado en LLM puntúa
acciones de EE. UU. a partir de sus fundamentales, valoración, noticias y contexto macro, y
propone una cartera concentrada. Ninguna orden real se ejecuta sin aprobación explícita.

> Proyecto personal. No es asesoramiento financiero. Por defecto funciona en simulación
> (`DRY_RUN`): no envía órdenes al bróker.

**En producción:** <https://agentic-trader-manuelllf.vercel.app> · acceso privado (login).

## Cómo funciona

Un escaneo programado recorre **~3.000 acciones cotizadas en EE. UU.** (ADRs incluidos) y las
puntúa en dos pasos: un cribado rápido y barato sobre todo el universo, y un análisis profundo
(informe + score + precio objetivo) sobre unos 50 finalistas. La selección final es
**determinista y vive en el código** —top-N por score, desempate por capitalización—; el LLM
solo reparte los pesos entre los ya seleccionados. Todo el dinero (tamaños, caja, P&L) lo
calcula el código con aritmética exacta en `Decimal` — nunca el LLM.

El escaneo semanal es un **observatorio**: refresca ranking, watchlist y memoria sin tocar
ningún libro. La **decisión** de cartera es mensual, porque el análisis razona a un mes vista
y rebalancear cada semana sería operar su propio ruido.

Dos modos, con libros de capital separados:

- **Sala sombra** — cartera simulada de seguimiento; mide el método frente al S&P 500 sin
  dinero real, neto de comisiones simuladas.
- **Sala real** — conectada a Interactive Brokers. El agente *propone*; el usuario decide
  (Sí / No) cada orden. Órdenes a límite y, por defecto, en modo simulación.

## Decisiones de diseño

Las que más forma le dan al sistema:

- **El universo se fotografía con la bolsa cerrada.** El volumen que publica un screener
  durante la sesión es el *acumulado del día en curso*, no una media: filtrar en caliente 45
  minutos después de la apertura devolvía una fracción del mercado y, peor, sesgada hacia lo
  que estuviera moviéndose esa mañana. Un job diario toma la foto tras el cierre y los escaneos
  leen esa foto; sin ella, una decisión mensual se aborta en lugar de elegir a ciegas.
- **La liquidez se mide en dólares, no en acciones.** Un mínimo de acciones negociadas castiga
  a los valores caros y deja pasar a los baratos ilíquidos. Además del suelo hay un **tope de
  nombres**: como el cribado gasta una llamada por acción, el coste no puede depender de lo
  movida que estuviera la sesión.
- **Elegir y ponderar son pasos distintos.** Que el modelo hiciera las dos cosas hacía
  imposible saber si un acierto venía del análisis o del reparto. Ahora la selección es
  aritmética reproducible y el criterio del LLM queda confinado al peso.
- **Cada escaneo deja traza — y la traza se lee.** Una tabla de auditoría guarda por qué cada
  nombre llegó hasta donde llegó y a qué precio, con 90 días de retención, y la web la
  convierte en respuesta: cuánto rindió después cada grupo (cartera, elegidos sin fondear,
  descartados) frente al S&P 500, como agregados sin nombres. Es evaluación offline y
  **nunca vuelve a un prompt**: almacenar no es inyectar.
- **La simulación paga comisiones.** El libro simulado descuenta la comisión de cada compra y
  la incorpora al coste medio, igual que hace el bróker. Sin eso, la rentabilidad simulada
  está inflada y cualquier comparación entre operar más o menos a menudo sale sesgada a favor
  de operar más — que es justo el sesgo que un simulador no se puede permitir.
- **La API tiene dos caras.** El mismo endpoint responde distinto con sesión y sin ella, según
  una regla única: *cómo se comporta el sistema es público; qué nombres elige, no*. Cuántas
  acciones sobreviven a cada etapa, por sector, es comportamiento; un ticker con su score
  sería un feed de señales. Las posiciones sin sesión salen anonimizadas.

## Stack

| Área      | Tecnología                                                    |
|-----------|---------------------------------------------------------------|
| Backend   | Python 3.12 · FastAPI · SQLAlchemy 2 · Pydantic v2            |
| Datos     | yfinance · screener público de NASDAQ                        |
| LLM       | DeepSeek vía OpenRouter (capa de proveedor intercambiable)   |
| Memoria   | sqlite-vec + fastembed (embeddings locales, sin coste)       |
| Bróker    | IBKR Web API (OAuth 1.0a headless, `ibind`)                  |
| Scheduler | APScheduler                                                  |
| DB        | SQLite sobre volumen persistente (driver Postgres incluido)  |
| Frontend  | Next.js 15 · React 19 · TypeScript · Tailwind v4             |
| Deploy    | Railway (backend) · Vercel (frontend)                        |

## Estructura

```
agentic_trading/
├── backend/     # FastAPI: escaneo, scoring, libros de capital, bróker, aprobaciones
└── frontend/    # Next.js: sala sombra + sala real
```

## Puesta en marcha

Requisitos: **Python 3.12+** y **Node 20+**.

### Backend

```bash
cd backend
uv sync                                   # https://docs.astral.sh/uv/
uv run uvicorn app.main:app --reload
```

La documentación OpenAPI (`/docs`, `/redoc`, `/openapi.json`) solo se sirve en desarrollo: con
`APP_PASSWORD` definida queda desactivada, para no publicar la superficie de la API.

Variables de entorno en `backend/.env` (no versionado). Para el escaneo con LLM hace falta
`OPENROUTER_API_KEY`; para la sala real, las credenciales OAuth de IBKR. Sin ellas, el
sistema funciona igualmente: el escaneo requiere la clave del LLM y el bróker cae a
simulación.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Modelo de seguridad

- Nada se ejecuta en la cuenta real sin una aprobación explícita del usuario por cada orden.
- `DRY_RUN` activo por defecto: las aprobaciones se registran, pero no se envían órdenes.
- Las órdenes son a límite, nunca a mercado.
- El libro del agente y la cartera personal del usuario se contabilizan por separado: el
  agente solo puede vender lo que él mismo compró.
