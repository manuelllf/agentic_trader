"use client";

import Link from "next/link";
import { Chip } from "./Chip";
import { Sesion } from "../_sesion/Sesion";
import { creditos as textoCreditos } from "@/lib/liga/format";

// `.hdr` de la maqueta (DESIGN.md §5): «liguilla» a la izquierda; a la derecha, el chip del
// plan, el chip de créditos (solo Mías/Crear, F7 tarea 4: sin botón de compra, no hay pasarela
// todavía) y el menú de cuenta (`Sesion`, con «Entrar» si no hay sesión).
export function CabeceraApp({
  plan, creditosSaldo,
}: { plan?: "gratis" | "pro"; creditosSaldo?: number }) {
  return (
    <header className="cab">
      <Link href="/" className="wordmark">liguilla</Link>
      <div className="cab-r">
        {plan && <Chip>{plan === "pro" ? "Pro" : "Gratis"}</Chip>}
        {creditosSaldo != null && (
          <Chip className="num">{textoCreditos(creditosSaldo)}</Chip>
        )}
        <Sesion />
      </div>
    </header>
  );
}
