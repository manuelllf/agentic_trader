"use client";

// Portada sin sesión: una pantalla que se juega sola, con cifras de ejemplo rotuladas como tales.
// Con sesión no enseña nada y redirige a /liga, sin parpadeo.

import Link from "next/link";
import { useState } from "react";
import { Segmentado } from "./_ui";
import { Escena } from "./_portada/Escena";
import { IDEAS } from "./_portada/ideas";
import { useRedirigirSiHaySesion } from "./_sesion/SesionContext";

export default function Portada() {
  const sesion = useRedirigirSiHaySesion();
  const [k, setK] = useState(0);

  if (sesion !== "fuera") return null;

  return (
    <main className="lnd">
      <header className="lnd-top">
        <span className="wordmark">liguilla</span>
        <Link href="/entrar" className="btn discreto small">Entrar</Link>
      </header>

      <div className="lnd-cab">
        <h1>Qué estrategias funcionan, y cuándo.</h1>
        <p className="lnd-sub">
          Escribe una idea, mira qué empresas elige el motor y compara cómo aguanta mes a mes frente
          al S&amp;P 500.
        </p>
      </div>

      <div className="lnd-centro">
        <Segmentado
          etiquetaGrupo="Otra idea de ejemplo"
          valor={String(k)}
          onChange={(v) => setK(Number(v))}
          opciones={IDEAS.map((idea, i) => ({ valor: String(i), etiqueta: idea.corto }))}
        />
        <Escena key={k} idea={IDEAS[k]} />
      </div>

      <div className="lnd-cta">
        <Link href="/entrar?next=/crear" className="btn pri">Crea la tuya</Link>
        <Link href="/liga" className="btn discreto">Ver la liga</Link>
      </div>

      <p className="lnd-legal">
        <span>Juego en papel, sin dinero real. Las cifras de la escena son un ejemplo.</span>
        <Link href="/legal/aviso">Aviso legal</Link>
        <Link href="/legal/privacidad">Privacidad</Link>
        <Link href="/legal/terminos">Términos</Link>
        <Link href="/legal/cookies">Cookies</Link>
      </p>
    </main>
  );
}
