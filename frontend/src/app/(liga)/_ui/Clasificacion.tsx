import type { ReactNode } from "react";

// `.tbl-h` + filas de la maqueta (DESIGN.md §6 y §7). Es solo el armazón: las filas
// (`FilaEquipo`) y los huecos (`HuecoClasificacion`) se componen como hijos, igual que en
// `viewTabla()` de la maqueta (cabecera, primeras filas, hueco, tu fila, hueco, leyenda).
export interface ClasificacionProps {
  children: ReactNode;
}

export function Clasificacion({ children }: ClasificacionProps) {
  return (
    <div className="ranking-lista">
      {children}
    </div>
  );
}

/** «y 105 más» / «11 más hasta la tuya» (`.gap` de la maqueta). */
export function HuecoClasificacion({ children }: { children: ReactNode }) {
  return <div className="gap">{children}</div>;
}
