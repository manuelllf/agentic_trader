"use client";

import Link from "next/link";
import { Chip } from "./Chip";

// `.hdr` de la maqueta (DESIGN.md §5): «liguilla» a la izquierda y a la derecha el chip del
// plan. La maqueta añade el chip de créditos en euros, pero `/liga/yo` todavía no da un saldo
// de créditos (gap de backend, ver el informe de F7): se omite en vez de inventar una cifra.
export function CabeceraApp({ plan }: { plan?: "gratis" | "pro" }) {
  return (
    <header className="cab">
      <Link href="/" className="wordmark">liguilla</Link>
      {plan && <div className="cab-r"><Chip>{plan === "pro" ? "Pro" : "Gratis"}</Chip></div>}
    </header>
  );
}
