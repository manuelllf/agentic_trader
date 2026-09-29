// La pregunta propia y su peso van juntos: sin pregunta no hay peso y con pregunta tiene que haberlo
// (lo exige la BD). Se ajusta al guardar y al escribir, para que nunca lleguen en desacuerdo.

export const PESO_PREGUNTA_INICIAL = 20;

export type Pesos = Record<string, number>;

export function pesosCoherentes(pregunta: string, pesos: Pesos): { pregunta: string | null; pesos: Pesos } {
  const texto = pregunta.trim();
  if (!texto) return { pregunta: null, pesos: { ...pesos, pregunta: 0 } };
  return { pregunta: texto, pesos: { ...pesos, pregunta: pesos.pregunta || PESO_PREGUNTA_INICIAL } };
}
