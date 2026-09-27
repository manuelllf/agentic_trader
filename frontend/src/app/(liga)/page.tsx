import type { Metadata } from "next";
import { Sesion } from "./_sesion/Sesion";

// Página de espera mientras se construye la liguilla (LIGA_ENABLED apagado).
export const metadata: Metadata = {
  title: "liguilla",
  description: "Escribe tu idea para invertir con tus palabras y juega cada mes contra el S&P 500. "
    + "En papel. La temporada 1 empieza en enero de 2027.",
};

export default function Proximamente() {
  return (
    <main className="sencilla">
      <header className="sencilla-top">
        <span className="wordmark">liguilla</span>
        <Sesion />
      </header>

      <section className="sencilla-cuerpo" aria-labelledby="titular">
        <h1 id="titular">¿Tu idea para invertir le gana al mercado?</h1>
        <p className="sencilla-lema">
          Tú pones el criterio, la IA hace el trabajo, el mercado pone la nota.
        </p>
        <p>
          Escribes qué empresas te gustan con tus palabras, la IA lo convierte en reglas y cada mes
          tu estrategia juega contra el S&amp;P&nbsp;500. Todo en papel: aquí no se compra ni se
          vende nada.
        </p>
        <p className="sencilla-dato">
          <b>La temporada 1 empieza en enero de 2027.</b> Hasta entonces la estamos terminando.
        </p>
      </section>

      <footer className="sencilla-pie">
        <p>Lo hace una persona. Es un juego en papel y no es asesoramiento financiero.</p>
      </footer>
    </main>
  );
}
