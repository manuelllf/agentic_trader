"use client";

// `.seg` de la maqueta (DESIGN.md §6): grupo de botones exclusivos, `role="group"` +
// `aria-pressed` en cada opción (DESIGN.md §11). `pequeno` porta la variante `.sm`.
export interface OpcionSegmentado<V extends string | number> {
  valor: V;
  etiqueta: string;
}

export interface SegmentadoProps<V extends string | number> {
  etiquetaGrupo: string;
  opciones: OpcionSegmentado<V>[];
  valor: V;
  onChange: (valor: V) => void;
  pequeno?: boolean;
  className?: string;
}

export function Segmentado<V extends string | number>({
  etiquetaGrupo,
  opciones,
  valor,
  onChange,
  pequeno = false,
  className,
}: SegmentadoProps<V>) {
  const clases = ["seg", pequeno ? "sm" : "", className].filter(Boolean).join(" ");
  return (
    <div className={clases} role="group" aria-label={etiquetaGrupo}>
      {opciones.map((o) => (
        <button
          key={String(o.valor)}
          type="button"
          aria-pressed={o.valor === valor}
          onClick={() => onChange(o.valor)}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}
