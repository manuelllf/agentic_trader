"use client";

// Puerta a otra sala: mismo fundido a negro que ya usaba AlphaDoor (ahora generalizado a las
// tres) -- #0A0A0A es el fondo real de Alpha/Beta/Omega y de la portada, no #131313.
// Texto plano, mismo peso que "← Portada" -- nada de caja/acento: la firma en itálica es la
// del título de cada sala, esto es solo un enlace secundario (feedback 17-sep-2026).

import { useRouter } from "next/navigation";
import { useState } from "react";

const SALAS = {
  alpha: { href: "/alpha", nombre: "Alpha", titulo: "Cuenta real: el agente propone, tú decides" },
  beta: { href: "/beta", nombre: "Beta", titulo: "Réplica pública en papel del mismo método" },
  omega: { href: "/omega", nombre: "Omega", titulo: "Caza rotación antes de que tenga nombre en ningún radar" },
} as const;

export default function SalaDoor({ to }: { to: keyof typeof SALAS }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const sala = SALAS[to];

  const enter = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => router.push(sala.href), 430);
  };

  return (
    <>
      <button
        onClick={enter}
        className="text-[12px] font-semibold text-[#6E6E6B] transition-colors hover:underline"
      >
        {sala.nombre}
      </button>
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-[100] bg-[#0A0A0A] transition-opacity duration-[420ms] ease-in ${leaving ? "opacity-100" : "opacity-0"}`}
      />
    </>
  );
}
