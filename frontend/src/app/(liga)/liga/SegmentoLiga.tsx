"use client";

import type { CSSProperties } from "react";

// Segmentado de la maqueta v12 (DESIGN §7): pulgar blanco que se desliza sobre una pista gris.
// Va aparte del `Segmentado` de `_ui`, que ficha y mías siguen usando con su aspecto actual.
export interface OpcionSegmentoLiga<V extends string> {
  valor: V;
  etiqueta: string;
}

export function SegmentoLiga<V extends string>({
  etiquetaGrupo, opciones, valor, onChange,
}: {
  etiquetaGrupo: string;
  opciones: OpcionSegmentoLiga<V>[];
  valor: V;
  onChange: (valor: V) => void;
}) {
  const indice = Math.max(0, opciones.findIndex((o) => o.valor === valor));
  return (
    <div className="lv-seg" role="group" aria-label={etiquetaGrupo} data-activo={indice}
      style={{ "--n": opciones.length } as CSSProperties}>
      <span className="lv-pulgar" aria-hidden="true" />
      {opciones.map((o) => (
        <button key={o.valor} type="button" aria-pressed={o.valor === valor} onClick={() => onChange(o.valor)}>
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}
