"use client";

import { useRef, useState } from "react";
import type { ReglaElegida } from "@/lib/liga/api";

type Copia = {
  reglas: ReglaElegida[]; pesos: Record<string, number>; n_empresas: number;
  reparto: string; max_por_sector: number; excluidas: string[];
};

function copiar(b: Copia): Copia {
  return structuredClone({ reglas: b.reglas, pesos: b.pesos, n_empresas: b.n_empresas,
    reparto: b.reparto, max_por_sector: b.max_por_sector, excluidas: b.excluidas });
}

export function useDeshacer() {
  const [anterior, setAnterior] = useState<Copia | null>(null);
  const arrastre = useRef<Copia | null>(null);
  function guardar(b: Copia) { if (!arrastre.current) setAnterior(copiar(b)); }
  function iniciar(b: Copia) { if (!arrastre.current) arrastre.current = copiar(b); }
  function terminar(b: Copia) {
    if (!arrastre.current) return;
    if (JSON.stringify(arrastre.current) !== JSON.stringify(copiar(b))) setAnterior(arrastre.current);
    arrastre.current = null;
  }
  function recuperar() {
    const copia = anterior;
    setAnterior(null);
    arrastre.current = null;
    return copia;
  }
  return { disponible: anterior !== null, guardar, iniciar, terminar, recuperar };
}
