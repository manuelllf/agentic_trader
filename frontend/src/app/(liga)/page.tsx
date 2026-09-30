"use client";

// Portada sin sesión: una pantalla que se juega sola, con un único ejemplo rotulado como tal.
// Con sesión no enseña nada y redirige a /liga, sin parpadeo.

import Link from "next/link";
import { Escena } from "./_portada/Escena";
import { EJEMPLO } from "./_portada/ideas";
import { useRedirigirSiHaySesion } from "./_sesion/SesionContext";

export default function Portada() {
  const sesion = useRedirigirSiHaySesion();

  if (sesion !== "fuera") return null;

  return (
    <main className="lnd">
      <header className="lnd-top">
        <span className="wordmark">liguilla</span>
        <nav className="lnd-nav">
          <Link href="/liga" className="btn discreto small">Ver la liga</Link>
          <Link href="/entrar" className="btn discreto small">Entrar</Link>
        </nav>
      </header>

      <div className="lnd-cab">
        <h1>Qué estrategias funcionan, y cuándo.</h1>
        <p className="lnd-sub">
          Escribe la idea que quieras, mira qué empresas elige el motor y compara cómo aguanta mes a
          mes frente al S&amp;P 500.
        </p>
      </div>

      <div className="lnd-centro">
        <Escena idea={EJEMPLO} />
      </div>

      <div className="lnd-cta">
        <Link href="/entrar?next=/crear" className="btn pri">Crea la tuya</Link>
      </div>

      <p className="lnd-legal">
        <span>Juego en papel, sin dinero real. La escena es un ejemplo con cifras inventadas; las empresas son solo ilustración, no una recomendación.</span>
        <Link href="/como-funciona">Cómo funciona</Link>
        <Link href="/legal/aviso">Aviso legal</Link>
        <Link href="/legal/privacidad">Privacidad</Link>
        <Link href="/legal/terminos">Términos</Link>
        <Link href="/legal/cookies">Cookies</Link>
      </p>
    </main>
  );
}
