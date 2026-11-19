// Lo que la pantalla de las notas de Jev calcula con lo que ya devuelve el backend.

export interface Par {
  score: number;
  ret: number;
}

export interface Grupo {
  n: number;
  /** Rentabilidad media del grupo, en %. */
  media: number | null;
}

export const GRUPOS = 5;

/** Reparte los pares en cinco grupos del mismo tamaño, de la nota más alta a la más baja, y da la
 *  rentabilidad media de cada uno. Con menos pares que grupos no hay lectura que valga: lista vacía. */
export function porNotas(pares: Par[]): Grupo[] {
  if (pares.length < GRUPOS) return [];
  const orden = [...pares].sort((a, b) => b.score - a.score);
  return Array.from({ length: GRUPOS }, (_, i) => {
    const trozo = orden.slice(Math.floor((i * orden.length) / GRUPOS), Math.floor(((i + 1) * orden.length) / GRUPOS));
    return {
      n: trozo.length,
      media: trozo.length ? Number((trozo.reduce((a, p) => a + p.ret, 0) / trozo.length).toFixed(2)) : null,
    };
  });
}

/** Clase de color solo para cifras de ganar y perder; el cero queda neutro. */
export const tono = (v: number | null): "pd-bien" | "pd-mal" | "" =>
  v === null ? "" : v > 0 ? "pd-bien" : v < 0 ? "pd-mal" : "";
