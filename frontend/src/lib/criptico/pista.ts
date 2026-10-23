import type { Ayuda, Segmento } from "./tipos";

export function marcarSegmentos(pista: Segmento[], ayudas: Ayuda[], completa = false) {
  return pista.map(segmento => ({ ...segmento,
    marcado: segmento.papel !== null && (completa || ayudas.includes(segmento.papel)),
  }));
}
