"use client";

// Portada sin sesión: una pantalla que se juega sola, con un único ejemplo rotulado como tal, y un
// campo libre para escribir la idea. Con sesión no enseña nada y redirige a /liga, sin parpadeo.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Escena } from "./_portada/Escena";
import { EJEMPLO } from "./_portada/ideas";
import { useRedirigirSiHaySesion } from "./_sesion/SesionContext";
import { LARGO_IDEA, guardarIdea } from "@/lib/liga/idea";

export default function Portada() {
  const sesion = useRedirigirSiHaySesion();
  const router = useRouter();
  const [idea, setIdea] = useState("");

  if (sesion !== "fuera") return null;

  const empezar = (e: React.FormEvent) => {
    e.preventDefault();
    guardarIdea(idea);
    router.push("/entrar?next=/crear");
  };

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

      <form className="lnd-cta" onSubmit={empezar}>
        <label className="sr-only" htmlFor="lnd-idea">Tu idea de inversión</label>
        <input
          id="lnd-idea" className="inp" value={idea} maxLength={LARGO_IDEA} autoComplete="off"
          placeholder="Tu idea de inversión"
          onChange={(e) => setIdea(e.target.value)}
        />
        <button type="submit" className="btn pri">Crea la tuya</button>
      </form>

      <p className="lnd-legal">
        <span>Juego en papel, sin dinero real. La escena es un ejemplo con cifras inventadas.</span>
        <Link href="/legal/aviso">Aviso legal</Link>
        <Link href="/legal/privacidad">Privacidad</Link>
        <Link href="/legal/terminos">Términos</Link>
        <Link href="/legal/cookies">Cookies</Link>
      </p>
    </main>
  );
}
