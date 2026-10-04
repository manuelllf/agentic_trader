# Vennett

Asistente personal de inversión sistemática. Un ranker fundamental basado en LLM puntúa
acciones de EE. UU. a partir de sus fundamentales, valoración, noticias y contexto macro, y
propone una cartera concentrada. Ninguna orden real se ejecuta sin aprobación explícita.

> Proyecto personal. No es asesoramiento financiero. Por defecto funciona en simulación
> (`DRY_RUN`): no envía órdenes al bróker.

**En producción:** <https://agentic-trader-manuelllf.vercel.app>. **Vennett** (ver abajo) está en
beta cerrada, por invitación; las salas de administración viven bajo `/admin`, solo con una cuenta
de administrador y verificación en dos pasos.

## Cómo funciona

Un escaneo programado recorre **~3.000 acciones cotizadas en EE. UU.** (ADRs incluidos) y las
puntúa en dos pasos: un cribado sobre todo el universo (cuatro preguntas cerradas:
fundamentales, valoración, riesgo de financiación y catalizador) y un análisis profundo
(informe + score) sobre hasta 100 finalistas. Una segunda opinión intermedia sobre los mejores
de cada sector existe tras un interruptor, apagada por defecto. La selección final es
**determinista y vive en el código** (top-N por score, desempate por capitalización); el LLM
solo reparte los pesos entre los ya seleccionados. Todo el dinero (tamaños, caja, P&L) lo
calcula el código con aritmética exacta en `Decimal`, nunca el LLM.

La **decisión** de cartera es mensual (el último día de bolsa del mes, tras el cierre), porque el análisis razona a un mes vista y
rebalancear más a menudo sería operar su propio ruido. Un botón de simulación en Alpha
corre el mismo circuito completo sin tocar ningún libro, para observar sin decidir.

Dos modos, con libros de capital separados:

- **Beta**: cartera simulada de seguimiento; mide el método frente al S&P 500 sin
  dinero real, neto de comisiones simuladas. La cifra que manda es la de toda la vida de la
  cartera, ponderada por tiempo (las aportaciones no cuentan como rentabilidad); la de las
  posiciones abiertas tras la última rotación queda como dato secundario.
- **Alpha**: conectada a Interactive Brokers. El agente *propone*; el usuario decide
  (Sí / No) cada orden. Órdenes a límite y, por defecto, en modo simulación.

Junto a ellas corre una **estrategia de control sin dinero**: los cinco mejores del cribado,
con como mucho dos por industria y a partes iguales, sin análisis profundo ni constructor. No
mueve capital, ni siquiera simulado; solo se mide su rentabilidad bruta frente a la cartera del
método y al S&P 500, para saber cuánto aporta el paso caro.

## La liga de Vennett

Un producto encima del mismo motor: una **liga de estrategias en papel contra el S&P 500**. Cada
persona escribe una idea en una frase, un modelo la convierte en reglas explícitas (sector,
tamaño, valoración, pesos de las cuatro notas del cribado y, si quiere, una pregunta propia sobre
las empresas) y cada mes esa estrategia juega una jornada. El conversor muestra cada intención
como exacta, aproximada o sin regla disponible; esa interpretación se conserva en el borrador.
Solo se ejecutan las reglas del catálogo que la persona mantiene en su estrategia.

- **Constructor por etapas.** Idea, Reglas, Selección, Cartera y Revisar. Los borradores se
  guardan en la base y se recuperan al volver; las revisiones evitan sobrescribir otra pestaña.
  Entrar en Crear abre Idea; avanzar o volver deja el menú de pasos visible, sin cabecera
  introductoria ni resumen repetido. Los controles se distribuyen según el ancho. Crecimiento
  interanual de ventas, margen operativo, ROE y dividendo tienen umbrales ajustables sobre
  los datos guardados de Yahoo. Las recetas anteriores conservan sus valores por defecto;
  una empresa sin el dato necesario no pasa la regla.
  Una vista previa autenticada cuenta candidatas y muestra la cartera que producirían los
  datos guardados, sin pedir nuevas puntuaciones ni crear una prueba.
  No requiere nombre: este se valida al guardar o inscribir. Cambiar de etapa es inmediato,
  con el guardado del borrador en segundo plano; la vista parcial reutiliza el resultado de
  la misma receta y permanece plegada hasta abrirla. Anterior y Continuar quedan accesibles
  sobre la navegación inferior. La entrada en lenguaje natural tiene una acción principal
  destacada. Idea, descripción de filtros y pregunta propia a Jev tienen un bloque visible.
  En Reglas, las propuestas
  requieren confirmación antes de incorporarse.
  Las cuatro notas guardadas de Jev ordenan las empresas después de aplicar los filtros:
  fundamentales, valoración, solidez financiera y catalizador próximo. Cada una tiene una
  explicación breve y un peso editable; con peso cero no interviene en la selección.
  Los informes de pago sobre una prueba sin guardar indican que primero guardarán su contexto.
- **Navegación y clasificación.** Los enlaces muestran cuándo están abriendo su destino y
  evitan pulsaciones repetidas mientras navegan. Las ayudas adoptan el tema de cada pantalla
  sin depender de los estilos de administración. Las cards del ranking conservan los bordes
  redondeados de la app, con respuesta al pulsar y movimiento que respeta las preferencias
  de accesibilidad. Las estrategias de casa se distinguen con
  los colores de sus salas y los símbolos α, Ω y λ; las estrategias personales conservan
  sus escudos. La jornada actual aparece antes que la clasificación cerrada.
- **Rendimiento y riesgo.** La ficha deriva una curva frente al S&P 500 de los cierres y
  carteras guardados, con dividendos y splits. Señala huecos y periodos provisionales. Incluye
  caída máxima, concentración y, desde 60 retornos diarios válidos, volatilidad, Sharpe y Sortino.
- **Evidencia de cartera.** La ficha usa la receta y la foto fijadas en cada formación para
  comprobar reglas y explicar cambios. Compara el retorno total de las posiciones con el
  S&P del mismo intervalo. Si falta la foto histórica o un cierre exacto, lo señala.
- **Comparación financiera.** Liga y Privadas muestran retorno acumulado de un tramo contiguo
  y su benchmark comparable, con fechas explícitas. Posición, puntos y movimiento entre los
  dos últimos cierres oficiales quedan como contexto; no se suman porcentajes mensuales.
  Liga abre en «Este mes» y permite consultar la clasificación después. Las pantallas interiores
  prescinden de la cabecera de marca; cuenta y sesión siguen accesibles desde Mías.
- **Ligas privadas.** Cada participante muestra su estrategia representante, escudo, retorno
  mensual y acumulado frente al S&P. El mes provisional se refresca cada dos minutos y se
  separa de los puntos oficiales. El detalle abre la cartera y metodología de la ficha,
  respetando su privacidad; invitaciones y gestión quedan en un panel independiente.
  Las tarjetas privadas son filas compactas y abren la misma ficha de detalle que el ranking
  público. La ficha empieza por
  la cartera: cada empresa abre su evidencia en una modal. Metodología sigue los pasos del
  editor (Idea, Reglas, Jev y Reparto); Resultados reúne rendimiento e historial por separado.
  La jornada abierta comparte una consulta de mercado en segundo plano por ventana de dos
  minutos. La ficha muestra retorno provisional de cartera y, según permisos, precio bruto
  y retorno total de cada empresa. Señala la consulta, fecha de mercado y datos pendientes;
  Yahoo puede tener retraso. Estas cotizaciones no sobrescriben cierres ni puntos oficiales.
  Las filas de empresas comparten la tipografía de la app y distinguen retornos positivos,
  negativos y neutros con los colores del tema, manteniendo siempre el signo y la cifra.
- **Seguimiento en Mías.** Resultado provisional de la jornada, último resultado cerrado y
  composición frente a la última revisión y entre las dos últimas carteras formadas.
  Copiar una estrategia publicada requiere
  Pro y crea una metodología independiente, editable por su nueva persona propietaria.
- **Visitas a la cuenta.** Registra inicio y última actividad también con sesiones recuperadas,
  agrupando actividad con menos de 30 minutos de separación. El administrador puede consultar
  totales e historial; la exportación personal incluye borradores, visitas y revisiones.
- **La IA puntúa; la selección es aritmética.** Un LLM (Jev) pone cuatro notas cerradas a cada
  empresa del universo y, si la estrategia lo pide, contesta su pregunta propia; otro modelo
  traduce la frase a reglas y explica los resultados. A partir de esas notas, el orden, los
  filtros, el tope por sector y los pesos son código determinista sobre una foto mensual del
  universo, igual para todas las estrategias, y cada empresa que no pasa sabe decir por qué. Dadas
  las notas, el resultado es reproducible; las notas las pone el modelo, iguales para todas las
  estrategias, y cada empresa deja constancia de la suya.
- **Jornadas mensuales, todas con los mismos cierres.** Arrancan el primer día de bolsa del mes
  (calendario NYSE) y comparan la rentabilidad, con dividendos, contra el S&P 500 en la misma
  ventana: ganar por más de 0,2 puntos vale 3, empatar 1 y perder 0. Comparar ventanas distintas
  es comparar mercados.
- **Ranking en directo.** El mes en juego se ve con el último cierre guardado, marcado como
  provisional; los puntos oficiales se fijan al cerrar la jornada y el registro no cambia después.
- **Equipos de la casa.** Alpha, Omega y Lambda (los tres métodos del sistema) juegan todas las
  jornadas, contra el mismo S&P 500 y con los mismos puntos; la liga solo lee de las salas, nunca escribe en ellas ni toca
  la cartera personal.
- **Ligas privadas, copiar estrategias y créditos de IA** prepago para las llamadas que cuestan
  dinero. Todavía sin pasarela de pago: los concede el administrador.
- **Cada petición es su usuario en Postgres.** Seguridad a nivel de fila con políticas por rol
  probadas con una identidad real, la API de datos de la base sin esquemas expuestos, y un tope de
  gasto mensual que apaga toda la IA de la liga si se alcanza.

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
- **El macro son datos, no una opinión.** Un resumen macro escrito por un modelo arrastraba
  todo el análisis hacia un sector (en una prueba, 65-75% de la cartera en energía por la
  narrativa del petróleo). Ahora cada análisis recibe los datos de mercado, el calendario, los
  eventos recientes y los titulares tal cual, sin previsión, y juzga cada empresa por sí misma.
- **La opinión de terceros no entra como dato.** Los precios objetivo de analistas y las notas
  de gobernanza de ISS no llegan a ningún prompt: el modelo los leía como hechos y penalizaba
  por ellos. Tampoco las medias móviles de 50 y 200 sesiones: en un A/B con un modelo proxy,
  estar por debajo costaba unos 6 puntos de nota y estar por encima no sumaba nada.
- **Elegir y ponderar son pasos distintos.** Que el modelo hiciera las dos cosas hacía
  imposible saber si un acierto venía del análisis o del reparto. Ahora la selección es
  aritmética reproducible y el criterio del LLM queda confinado al peso.
- **Cada escaneo deja traza, y la traza se lee.** Una tabla de auditoría guarda por qué cada
  nombre llegó hasta donde llegó y a qué precio, con 90 días de retención, y la web la
  convierte en respuesta: cuánto rindió después cada grupo (cartera, elegidos sin fondear,
  descartados) frente al S&P 500, como agregados sin nombres. Es evaluación offline y
  **nunca vuelve a un prompt**: almacenar no es inyectar.
- **La simulación paga comisiones.** El libro simulado descuenta la comisión de cada compra y
  la incorpora al coste medio, igual que hace el bróker. Sin eso, la rentabilidad simulada
  está inflada y cualquier comparación entre operar más o menos a menudo sale sesgada a favor
  de operar más: justo el sesgo que un simulador no se puede permitir.
- **El esquema vive en la base de datos.** Cada cambio se aplica primero en SQL y el modelo del
  código solo lo refleja; un script compara los dos y avisa de cualquier deriva. La aplicación
  lee y escribe a través de esas clases, y nunca crea ni altera tablas contra la base real.
- **La API tiene dos caras.** El mismo endpoint responde distinto con sesión y sin ella, según
  una regla única: *cómo se comporta el sistema es público; qué nombres elige, no*. Cuántas
  acciones sobreviven a cada etapa, por sector, es comportamiento; un ticker con su score
  sería un feed de señales. Las posiciones sin sesión salen anonimizadas.

## Segunda estrategia: momentum (Omega)

Independiente del ranker fundamental: universo propio de cíclicas puras (Espacio, IA-infra,
Quantum, cripto-IA, óptica-IA, biotech-IA), sin cartera ni capital compartido. Detecta caídas
violentas por patrón técnico (zigzag / suelo múltiple); un LLM decide una única cosa, si la
caída es miedo o negocio roto (gate de noticias, lista cerrada de motivos), nunca tamaño ni
ejecución. **Esta sala nunca opera sola**: alerta, y el usuario ejecuta a mano en IBKR y lo
reporta de vuelta.

El universo no es una lista cerrada para siempre: un descubrimiento diario sobre menciones
sociales (ApeWisdom) detecta rupturas fuera del universo fijo, las pasa por los mismos filtros
objetivos y el mismo gate de noticias, y el usuario decide fila a fila si entran. Ni el filtro
ni el gate deciden solos en ningún punto del sistema: solo informan. Incorporar o descartar es
siempre un clic humano, y esa decisión se propaga sola al resto (escaneo, validación, universo)
sin tocar código.

## Stack

| Área      | Tecnología                                                    |
|-----------|---------------------------------------------------------------|
| Backend   | Python 3.12 · FastAPI · SQLAlchemy 2 · Pydantic v2            |
| Datos     | yfinance · screener público de NASDAQ · Wikipedia, Google News y GDELT (macro) |
| LLM       | DeepSeek (análisis profundo, constructor) + Jev de TypeSafe AI (cribado inicial, con Qwen y DeepSeek de reserva); capa de proveedor intercambiable |
| Memoria   | pgvector + fastembed (embeddings locales, sin coste)         |
| Bróker    | IBKR Web API (OAuth 1.0a headless, `ibind`)                  |
| Cuentas   | Supabase Auth (JWT verificado por JWKS, TOTP) · RLS por rol   |
| Calendario | `exchange_calendars` (NYSE) para las jornadas               |
| Scheduler | APScheduler                                                  |
| DB        | Postgres (Supabase) en producción; SQLite por defecto en local |
| Frontend  | Next.js 15 · React 19 · TypeScript · Tailwind v4             |
| Deploy    | Railway (backend) · Vercel (frontend)                        |

## Estructura

```
agentic_trading/
├── backend/     # FastAPI: escaneo, scoring, libros de capital, bróker, aprobaciones,
│                #   momentum (2ª estrategia, independiente) y la liga (app/liga)
└── frontend/    # Next.js: Vennett (pública, móvil primero) y, bajo /admin,
                 #   las salas Beta, Alpha y Omega (momentum)
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
`SUPABASE_URL` definida (producción) queda desactivada, para no publicar la superficie de la API.

Variables de entorno en `backend/.env` (no versionado). Para el escaneo con LLM hace falta
`DEEPSEEK_API_KEY` (proveedor por defecto; `OPENROUTER_API_KEY` es opcional, solo para pruebas
puntuales locales con `LLM_PROVIDER=openrouter`); para Alpha, las credenciales OAuth de
IBKR. Sin ellas, el sistema funciona igualmente: el escaneo requiere la clave del LLM y el
bróker cae a simulación.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Modelo de seguridad

- Las salas de administración solo abren con una cuenta con rol de administrador y segundo
  factor; no hay contraseña compartida.
- Nada se ejecuta en la cuenta real sin una aprobación explícita del usuario por cada orden.
- `DRY_RUN` activo por defecto: las aprobaciones se registran, pero no se envían órdenes.
- Las órdenes son a límite, nunca a mercado.
- El libro del agente y la cartera personal del usuario se contabilizan por separado: el
  agente solo puede vender lo que él mismo compró.

## Licencia

Código propietario, todos los derechos reservados (ver [LICENSE](LICENSE)). Ver el repositorio
no otorga ningún permiso de uso, copia o distribución.
