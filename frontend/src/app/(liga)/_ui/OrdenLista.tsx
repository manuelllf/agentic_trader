"use client";

export interface OpcionOrden<V extends string> { valor: V; etiqueta: string }
export interface OrdenListaProps<V extends string> {
  etiquetaGrupo: string; opciones: OpcionOrden<V>[]; valor: V; onChange: (valor: V) => void;
}

// Texto subrayado en vez de píldora: se lee como la cabecera de la lista y no como otro control.
export function OrdenLista<V extends string>({ etiquetaGrupo, opciones, valor, onChange }: OrdenListaProps<V>) {
  return (
    <div className="orden" role="group" aria-label={etiquetaGrupo}>
      {opciones.map((opcion) => (
        <button key={opcion.valor} type="button" aria-pressed={opcion.valor === valor}
          onClick={() => onChange(opcion.valor)}>
          {opcion.etiqueta}
        </button>
      ))}
    </div>
  );
}
