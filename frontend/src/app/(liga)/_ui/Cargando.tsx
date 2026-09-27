// Esqueleto sobrio, sin destello (pedido explícito: nada de shimmer). No está en la maqueta,
// que solo enseña datos ya cargados. Bloques `surface2` estáticos del alto de una fila real
// (66 px, la de clasificación) para que la pantalla no salte al llegar los datos.
export interface CargandoProps {
  filas?: number;
  alto?: number;
  etiqueta?: string;
}

export function Cargando({ filas = 3, alto = 66, etiqueta = "Cargando" }: CargandoProps) {
  return (
    <div className="esqueleto" role="status" aria-live="polite">
      <span className="sr-only">{etiqueta}</span>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="esqueleto-fila" style={{ minHeight: alto }} aria-hidden="true">
          <div className="esqueleto-bloque" style={{ width: 34, height: 34, borderRadius: 999 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="esqueleto-bloque" style={{ width: "60%", height: 14 }} />
            <div className="esqueleto-bloque" style={{ width: "35%", height: 11 }} />
          </div>
          <div className="esqueleto-bloque" style={{ width: 34, height: 14 }} />
        </div>
      ))}
    </div>
  );
}
