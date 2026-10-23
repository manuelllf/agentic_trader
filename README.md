# Vennett

**Liga de estrategias de inversión en papel contra el S&P 500.** Escribe una estrategia con reglas claras, compítela cada semana frente al índice y frente a tus amigos. Sin dinero real y sin recomendaciones de compra o venta.

**Entra en <https://vennett.app>** · Gratis · Español e inglés

Si quieres usarla, sigue la sección [Empezar](#empezar).

## Empezar

1. **Crea una cuenta.** Con contraseña, con Google o con un enlace al correo. Confirma el correo para activarla.
2. **Escribe la idea de tu estrategia en una frase.** Vennett la convierte en reglas explícitas: sector, tamaño, valoración y pesos de cuatro criterios financieros. Revísalas y ajústalas antes de jugar.
3. **Mira la cartera de hoy.** Ves qué empresas entrarían y cuánto pesaría cada una. Cada semana es una jornada: tu cartera se fija el viernes al cierre y juega desde el lunes. La cartera nueva del mes sale del escaneo del último día de bolsa y entra el lunes siguiente.

Después, invita a tus amigos: crea una liga privada y comparte el código. Veréis la clasificación de todos.

## Qué ofrece

- **Juega cada semana contra el S&P 500.** Cada jornada compara la rentabilidad con dividendos de tu cartera con la del índice en la misma ventana.
- **Ligas privadas con tus amigos.** Creas una liga, compartes el código y veis la clasificación de todos. Cada participante muestra su estrategia, su rentabilidad de la semana y la acumulada frente al índice.
- **Ficha completa de cada estrategia.** Cartera, evidencia de cada posición, curva frente al S&P 500, caída máxima, volatilidad, Sharpe y Sortino.
- **Clasificación en directo.** La semana en juego se ve como provisional. Los puntos oficiales se fijan al cerrar cada jornada y no cambian después.
- **Lecciones y boletín.** Un blog con lecciones cortas sobre cómo funciona una empresa y cómo se construye una estrategia, en español e inglés, con boletín opcional de doble confirmación.
- **Resúmenes por correo.** Un resumen semanal y otro al cerrar cada jornada, con baja en un clic.

## Cómo se puntúa

Cada jornada se compara la rentabilidad de tu cartera con la del S&P 500 en la misma ventana. Ganas si tu ventaja, redondeada a una décima, supera los 0,2 puntos: vale 3. Si queda entre −0,2 y +0,2, empatas y vale 1. Si queda por debajo de −0,2, pierdes y vale 0.

Alpha, Omega y Lambda, los tres métodos de la casa, juegan cada jornada contra el mismo índice y con los mismos puntos, para tener una referencia en la tabla.

## Por dentro

Un motor de análisis puntúa unas **2.850 acciones cotizadas en EE. UU.** (ADRs incluidos) en cada escaneo, con cuatro notas cerradas: fundamentales, valoración, riesgo de financiación y catalizador próximo. Un modelo de lenguaje pone esas notas. La selección posterior es aritmética y reproducible: orden, filtros, tope por sector y pesos son código sobre una foto mensual del universo, igual para todas las estrategias.

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
| Base de datos analítica | DuckDB, copia columnar de solo lectura sincronizada desde Postgres |
| Frontend | Next.js 15 · React 19 · TypeScript · next-intl · Tailwind v4 |
| Cuentas | Supabase Auth (JWT verificado por JWKS, TOTP) |
| Correo | Resend |
| Datos | yfinance · screener público de NASDAQ · Wikipedia, Google News y GDELT |
| Modelos de lenguaje | DeepSeek y Jev (TypeSafe AI), con capa de proveedor intercambiable |
| Bróker (sala Alpha) | Interactive Brokers, Web API (OAuth 1.0a, `ibind`); simulación por defecto |
| Despliegue | Railway (backend) · Vercel (frontend) |

## Aviso

Proyecto personal. Vennett no es asesoramiento financiero, no gestiona dinero real y sus simulaciones no incluyen todas las comisiones ni impuestos.

## Licencia

Código propietario, todos los derechos reservados (ver [LICENSE](LICENSE)). Ver el repositorio no otorga ningún permiso de uso, copia o distribución.
