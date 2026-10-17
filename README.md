# Vennett

**Liga de estrategias de inversión en papel contra el S&P 500.** Escribe una estrategia con reglas claras, compítela cada mes frente al índice y frente a tus amigos. Sin dinero real y sin recomendaciones de compra o venta.

**En producción:** <https://vennett.app> · Gratis · Español e inglés

## Qué ofrece

- **Crea tu estrategia en una frase.** Describes la idea y Vennett la convierte en reglas explícitas: sector, tamaño, valoración, pesos de cuatro criterios financieros y, si quieres, una pregunta propia sobre cada empresa. Puedes revisarlas y editarlas antes de jugar.
- **Juega cada mes contra el S&P 500.** Cada jornada compara la rentabilidad con dividendos de tu cartera con la del índice en la misma ventana. Ganar por más de 0,2 puntos vale 3, empatar 1 y perder 0.
- **Ligas privadas con tus amigos.** Creas una liga, compartes el código y veis la clasificación de todos. Cada participante muestra su estrategia, su rentabilidad mensual y la acumulada frente al índice.
- **Ficha completa de cada estrategia.** Cartera, evidencia de cada posición, curva frente al S&P 500, caída máxima, volatilidad, Sharpe y Sortino.
- **Clasificación en directo.** El mes en juego se ve como provisional. Los puntos oficiales se fijan al cerrar cada jornada y no cambian después.
- **Lecciones y boletín.** Un blog con lecciones cortas sobre cómo funciona una empresa y cómo se construye una estrategia, en español e inglés, con boletín opcional de doble confirmación.
- **Resúmenes por correo.** Un resumen semanal y otro al cerrar cada jornada, con baja en un clic.

## Cómo se juega

1. **Idea.** Describes en una frase la estrategia que quieres probar.
2. **Reglas y criterios.** Vennett propone reglas que puedes ajustar: umbrales de crecimiento, margen, ROE o dividendo, tope de empresas por sector y el peso de cada criterio.
3. **Cartera.** Ves qué empresas entrarían hoy y cuánto pesaría cada una. El primer día de bolsa de cada mes, la jornada arranca con esa cartera.

Alpha, Omega y Lambda, los tres métodos de la casa, juegan cada jornada contra el mismo índice y con los mismos puntos, para tener una referencia en la tabla.

## Por dentro

Un motor de análisis puntúa unas **3.000 acciones cotizadas en EE. UU.** (ADRs incluidos) con cuatro notas cerradas: fundamentales, valoración, riesgo de financiación y catalizador próximo. Un modelo de lenguaje pone esas notas. La selección posterior es aritmética y reproducible: orden, filtros, tope por sector y pesos son código sobre una foto mensual del universo, igual para todas las estrategias.

Todo el dinero (tamaños, caja, rentabilidad) lo calcula el código con aritmética decimal exacta. El modelo nunca toca cifras de dinero.

## Seguridad y privacidad

- Las cuentas entran con contraseña, con Google o con un enlace al correo. La recuperación también llega por correo.
- Las salas de administración solo abren con una cuenta de administrador y verificación en dos pasos.
- Cada petición actúa como su usuario en Postgres: las políticas de seguridad a nivel de fila se aplican por rol y están probadas con identidades reales.
- Verificación anti-bots (Cloudflare Turnstile) en el alta, la recuperación y el boletín.
- Los datos de cuentas y de la liga viven en una base de datos de la Unión Europea (Supabase, eu-west-1).

## Stack

| Área | Tecnología |
|---|---|
| Backend | Python 3.12 · FastAPI · SQLAlchemy 2 · Pydantic v2 · APScheduler |
| Base de datos | Postgres (Supabase) con seguridad a nivel de fila · pgvector |
| Frontend | Next.js 15 · React 19 · TypeScript · next-intl · Tailwind v4 |
| Cuentas | Supabase Auth (JWT verificado por JWKS, TOTP) |
| Correo | Resend |
| Datos | yfinance · screener público de NASDAQ · Wikipedia, Google News y GDELT |
| Modelos de lenguaje | DeepSeek y Jev (TypeSafe AI), con capa de proveedor intercambiable |
| Bróker (sala Alpha) | Interactive Brokers, Web API (OAuth 1.0a, `ibind`); simulación por defecto |
| Despliegue | Railway (backend) · Vercel (frontend) |

## Quién lo programa

Vennett lo diseña y programa **Manuel Llao Freire**: arquitectura, backend, frontend, datos, pipelines con modelos de lenguaje, base de datos y despliegue. El proyecto se publica en abierto mientras se desarrolla.

## Puesta en marcha

Requisitos: **Python 3.12+** y **Node 20+**.

```bash
# Backend
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

```bash
# Frontend
cd frontend
npm install
npm run dev
```

Las variables de entorno van en `backend/.env` (no versionado). Sin claves de modelo de lenguaje, el sistema arranca igualmente: el escaneo las necesita, y el bróker cae a simulación.

## Aviso

Proyecto personal. Vennett no es asesoramiento financiero, no gestiona dinero real y sus simulaciones no incluyen todas las comisiones ni impuestos.

## Licencia

Código propietario, todos los derechos reservados (ver [LICENSE](LICENSE)). Ver el repositorio no otorga ningún permiso de uso, copia o distribución.
