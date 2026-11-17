import type { Ayuda, Segmento } from "./tipos";

/** La pista como texto corrido, sin los papeles de cada tramo. */
export const textoDePista = (pista: Segmento[]) => pista.map(segmento => segmento.texto).join("");

export function marcarSegmentos(pista: Segmento[], ayudas: Ayuda[], completa = false) {
  return pista.map(segmento => ({ ...segmento,
    marcado: segmento.papel !== null && (completa || ayudas.includes(segmento.papel)),
  }));
}
