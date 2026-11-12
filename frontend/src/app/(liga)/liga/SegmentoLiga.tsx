"use client";

import type { CSSProperties } from "react";

// Segmentado de la maqueta v12 (DESIGN §7): pulgar blanco que se desliza sobre una pista gris.
// Va aparte del `Segmentado` de `_ui`, que ficha y mías siguen usando con su aspecto actual.
export interface OpcionSegmentoLiga<V extends string | number> {
  valor: V;
  etiqueta: string;
}

/** Con `valor` fuera de las opciones (o `null`) no hay ninguna elegida y el pulgar no se pinta. */
export function SegmentoLiga<V extends string | number>({
  etiquetaGrupo, opciones, valor, onChange, className, desactivado = false,
}: {
  etiquetaGrupo: string;
  opciones: OpcionSegmentoLiga<V>[];
  valor: V | null;
  onChange: (valor: V) => void;
  className?: string;
  desactivado?: boolean;
}) {
  const indice = opciones.findIndex((o) => o.valor === valor);
  return (
    <div className={className ? `lv-seg ${className}` : "lv-seg"} role="group" aria-label={etiquetaGrupo}
      data-activo={indice < 0 ? undefined : indice} style={{ "--n": opciones.length } as CSSProperties}>
      {indice >= 0 && <span className="lv-pulgar" aria-hidden="true" />}
      {opciones.map((o) => (
        <button key={String(o.valor)} type="button" aria-pressed={o.valor === valor} disabled={desactivado}
          onClick={() => onChange(o.valor)}>
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}
