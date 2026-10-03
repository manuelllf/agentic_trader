"use client";

import Link from "next/link";
import { Chip } from "./Chip";
import { Sesion } from "../_sesion/Sesion";
import { useSesion } from "../_sesion/SesionContext";
import { getCreditos } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { creditos as textoCreditos } from "@/lib/liga/format";

// `.hdr` de la maqueta (DESIGN.md §5): «liguilla» a la izquierda; a la derecha, el chip del
// plan, el chip de créditos (solo Mías/Crear, F7 tarea 4: sin botón de compra, no hay pasarela
// todavía) y el menú de cuenta (`Sesion`, con «Entrar» si no hay sesión).
//
// `plan` sale de `SesionContext` (una sola lectura de `Yo` para toda la app, ver H1 del informe
// de fluidez); `conCreditos` solo pide/enseña el saldo en las pantallas que lo necesitan (Mías,
// Crear), y lo hace con la caché compartida (`creditos`), así no se desincroniza entre pantallas.
export function CabeceraApp({ conCreditos = false }: { conCreditos?: boolean } = {}) {
  const { estado, yo } = useSesion();
  const { datos: creditos } = useCache(conCreditos && estado === "dentro" ? "creditos" : null, getCreditos);
  const saldo = creditos && typeof creditos === "object" ? creditos.saldo : undefined;
  return (
    <header className="cab">
      <Link href="/" className="wordmark">Vennett</Link>
      <div className="cab-r">
        {yo && <Chip>{yo.plan === "pro" ? "Pro" : "Gratis"}</Chip>}
        {conCreditos && saldo != null && (
          <Chip className="num">{textoCreditos(saldo)}</Chip>
        )}
        <Sesion />
      </div>
    </header>
  );
}
