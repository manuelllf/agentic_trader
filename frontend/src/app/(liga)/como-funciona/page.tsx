import Link from "next/link";

export const metadata = { title: "Cómo funciona — liguilla" };

// Página pública de método: cómo entra cada empresa en una estrategia y qué pone la IA. Los números
// del ejemplo son inventados y se rotulan como tal; el resto describe lo que hace el código
// (`backend/app/liga/motor`). Si cambia el motor (pesos, desempate, margen de empate), cambia aquí.
type Quien = "ia" | "codigo";
type Paso = { titulo: string; texto: string; cifra?: string; quien?: Quien; extra?: string };

const PASOS: Paso[] = [
  {
    titulo: "Una foto igual para todos",
    texto: "El último día de bolsa del mes fotografiamos unas 3.000 empresas de EE. UU. con sus datos. Todas las estrategias parten de esa misma foto.",
    cifra: "≈ 3.000 empresas",
  },
  {
    titulo: "Tus reglas apartan empresas",
    texto: "Sector, tamaño, valoración, lo que pidas. Las que no cumplen alguna regla se quedan fuera, y sabemos decirte cuál: «vale 1.900 M$ y pides más de 2.000 M$».",
    cifra: "pasan unas 400 (ejemplo)",
  },
  {
    titulo: "Cada empresa tiene cuatro notas",
    texto: "Una IA (Jev) puntúa a todas, una vez al mes, en cuatro cosas: fundamentales, valoración, riesgo de financiación y catalizador. La nota es la misma para todo el mundo; tú decides cuánto pesa cada una.",
    quien: "ia",
    extra: "Si añades una pregunta propia, la IA la contesta solo para las empresas que pasan tus reglas: sí o no, y con qué seguridad.",
  },
  {
    titulo: "Se ordenan y se reparte",
    texto: "Con tus pesos sale una nota de 0 a 10 por empresa. Se ordenan y, si empatan, gana la de más capitalización. Entran las primeras N respetando tu tope por sector. Lo que no llega a N se queda en caja.",
    quien: "codigo",
  },
  {
    titulo: "Se fija y se compara con el S&P 500",
    texto: "La cartera se fija el primer día de bolsa del mes y no cambia. Se compara con el S&P 500 en la misma ventana: más de 0,2 puntos por encima, 3 puntos; a 0,2 o menos de distancia, 1; por debajo, 0.",
    quien: "codigo",
  },
];

const QUIEN: Record<Quien, string> = {
  ia: "La pone una IA · la misma para todos",
  codigo: "Lo hace el código · se repite igual",
};

export default function ComoFunciona() {
  return (
    <main className="sencilla cf">
      <header className="sencilla-top">
        <Link href="/" className="wordmark">liguilla</Link>
        <Link href="/liga" className="cf-cerrar">Ir a la liga</Link>
      </header>

      <div className="cf-cuerpo">
        <p className="cf-eyebrow">Cómo funciona</p>
        <h1>Cómo entran las empresas en tu estrategia</h1>
        <p className="cf-lead">
          Tú pones las reglas. Cada mes las aplicamos a las mismas empresas y con las mismas notas
          para todo el mundo. Aquí va cada paso, con lo que hace una IA y lo que hace el código.
        </p>

        <ol className="cf-pasos">
          {PASOS.map((p, i) => (
            <li className="cf-paso" key={p.titulo}>
              <span className="cf-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h2>{p.titulo}</h2>
                <p>{p.texto}</p>
                <div className="cf-etiquetas">
                  {p.quien && <span className={`cf-quien ${p.quien}`}>{QUIEN[p.quien]}</span>}
                  {p.cifra && <span className="cf-cifra">{p.cifra}</span>}
                </div>
                {p.extra && <p className="cf-extra">{p.extra}</p>}
              </div>
            </li>
          ))}
        </ol>

        <section className="cf-sec" aria-labelledby="cf-quien-pone">
          <h2 id="cf-quien-pone">Qué pone la IA y qué hace el código</h2>
          <div className="cf-dos">
            <div className="cf-caja">
              <h3><span className="cf-punto ia" aria-hidden="true" />Lo pone un modelo</h3>
              <ul>
                <li>Convertir tu frase en reglas</li>
                <li>Las cuatro notas de cada empresa</li>
                <li>La respuesta a tu pregunta propia</li>
                <li>El texto que explica tus resultados</li>
              </ul>
              <p>Siempre va marcado como IA, y las notas son las mismas para todas las estrategias.</p>
            </div>
            <div className="cf-caja">
              <h3><span className="cf-punto codigo" aria-hidden="true" />Lo hace el código</h3>
              <ul>
                <li>Aplicar tus reglas y tus exclusiones</li>
                <li>Ordenar, desempatar y el tope por sector</li>
                <li>Los pesos de cada empresa</li>
                <li>La rentabilidad y los puntos</li>
              </ul>
              <p>Con las mismas notas, sale siempre lo mismo.</p>
            </div>
          </div>
        </section>

        <section className="cf-sec" aria-labelledby="cf-ejemplo">
          <h2 id="cf-ejemplo">Un ejemplo</h2>
          <p className="cf-sub">Con una empresa inventada, para ver la cuenta.</p>
          <div className="cf-ejemplo">
            <p className="cf-rotulo">Ejemplo inventado · no es una empresa real</p>
            <div className="cf-emp"><b>Empresa Ejemplo</b><span>EJEM · Tecnología</span></div>
            <div className="cf-notas">
              <div><b>7</b><small>Fundamentales · peso 30 %</small></div>
              <div><b>5</b><small>Valoración · peso 30 %</small></div>
              <div><b>8</b><small>Financiación · peso 20 %</small></div>
              <div><b>6</b><small>Catalizador · peso 20 %</small></div>
            </div>
            <p className="cf-total">Nota con tus pesos: <b>6,4</b> de 10</p>
            <p className="cf-porque">Entra: la cuarta entre las que pasan tus reglas, sin pasarse del tope de 2 empresas por sector.</p>
          </div>
        </section>

        <section className="cf-sec" aria-labelledby="cf-justo">
          <h2 id="cf-justo">Qué lo mantiene justo</h2>
          <ul className="cf-lista">
            <li><b>Las reglas están versionadas.</b> Cada estrategia guarda con qué versión del catálogo jugó.</li>
            <li><b>Los resultados oficiales no se reescriben.</b> Se fijan al cerrar la jornada y se quedan así.</li>
            <li><b>La casa puntúa como tú.</b> Alpha, Omega y Lambda juegan la misma jornada, contra el mismo S&amp;P y con los mismos puntos; sus carteras vienen de los métodos del sistema y no se publican.</li>
            <li><b>Todo lo que hace la administración deja registro.</b></li>
          </ul>
          <p className="cf-callout">
            <b>¿Algo no te cuadra?</b> En tu estrategia, «¿Por qué no sale X?» te dice si la empresa
            entraría y por qué. Y si sigue sin cuadrarte, escríbenos.
          </p>
        </section>

        <div className="cf-cta">
          <Link href="/entrar?next=/crear" className="btn pri">Crear mi estrategia</Link>
          <Link href="/liga" className="btn">Ver la clasificación</Link>
        </div>
        <p className="cf-pie">
          La liguilla es un juego en papel: no hay dinero real ni es asesoramiento financiero.{" "}
          <Link href="/legal/terminos">Términos</Link>
        </p>
      </div>
    </main>
  );
}
