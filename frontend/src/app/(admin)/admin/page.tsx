"use client";

// Entrada del admin: las tres salas. Por ahora con la contraseña de siempre (AuthGate); el
// acceso con cuenta y 2FA la sustituye cuando exista.

import Link from "next/link";
import AuthGate from "@/components/AuthGate";

const SALAS = [
  { href: "/admin/alpha", nombre: "Alpha", texto: "Cuenta real: el agente propone, tú decides." },
  { href: "/admin/beta", nombre: "Beta", texto: "Réplica en papel del mismo método." },
  { href: "/admin/omega", nombre: "Omega", texto: "Caídas fuertes, con la IA de filtro." },
];

export default function Admin() {
  return (
    <AuthGate>
      <main className="mx-auto max-w-md px-4 pb-10 pt-8">
        <h1 className="text-[15px] font-bold text-white">Salas</h1>
        <ul className="mt-4 border-t border-[#303030]">
          {SALAS.map((s) => (
            <li key={s.href} className="border-b border-[#303030]">
              <Link href={s.href} className="flex min-h-[64px] flex-col justify-center gap-0.5 py-3">
                <span className="text-[19px] text-white"
                      style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>
                  {s.nombre}
                </span>
                <span className="text-[12.5px] text-[#898781]">{s.texto}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </AuthGate>
  );
}
