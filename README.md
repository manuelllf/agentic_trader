# Agentic Trader

Asistente personal de inversión sistemática. Un ranker fundamental basado en LLM puntúa
acciones de EE. UU. a partir de sus fundamentales, valoración, noticias y contexto macro, y
propone una cartera concentrada. Ninguna orden real se ejecuta sin aprobación explícita.

> Proyecto personal. No es asesoramiento financiero. Por defecto funciona en simulación
> (`DRY_RUN`): no envía órdenes al bróker.

**En producción:** <https://agentic-trader-manuelllf.vercel.app> · acceso privado (login).

## Cómo funciona

Un escaneo programado recorre el universo de acciones y las puntúa en dos pasos: un cribado
rápido y barato sobre todo el universo, y un análisis profundo (informe + score + precio
objetivo) sobre los finalistas. Con esos scores se selecciona una cartera objetivo; el
reparto de pesos lo decide el LLM sobre los nombres ya seleccionados. Todo el dinero
(tamaños, caja, P&L) lo calcula el código con aritmética exacta en `Decimal` — nunca el LLM.

Dos modos, con libros de capital separados:

- **Sala sombra** — cartera simulada de seguimiento; mide el método frente al S&P 500 sin
  dinero real.
- **Sala real** — conectada a Interactive Brokers. El agente *propone*; el usuario decide
  (Sí / No) cada orden. Órdenes a límite y, por defecto, en modo simulación.

## Stack

| Área      | Tecnología                                                    |
|-----------|---------------------------------------------------------------|
| Backend   | Python 3.12 · FastAPI · SQLAlchemy 2 · Pydantic v2            |
| Datos     | yfinance · screener público de NASDAQ                        |
| LLM       | DeepSeek vía OpenRouter (capa de proveedor intercambiable)   |
| Bróker    | IBKR Web API (OAuth 1.0a headless, `ibind`)                  |
| Scheduler | APScheduler                                                  |
| DB        | SQLite (local) · Postgres/Supabase (opcional en producción)  |
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

Documentación OpenAPI en URL_PROD/docs

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
