import { leerPublicado, listarPublicados, proximaFecha } from "./publico";
import type { Acertijo, Idioma } from "./tipos";

export type EstadoCriptico =
  | { tipo: "hoy"; longitud: number; pista: string; numero: number; nivel: Acertijo["nivel"] }
  | { tipo: "proximo"; fecha: string }
  | null;

/** El de hoy si ya hay; si no, el próximo publicado. Si la API falla, no sale nada. */
export async function estadoCriptico(idioma: Idioma): Promise<EstadoCriptico> {
  try {
    if ((await listarPublicados(idioma)).length > 0) {
      const entrega = await leerPublicado(idioma);
      if (!entrega) return null;
      const { acertijo } = entrega;
      return { tipo: "hoy", longitud: acertijo.longitud, pista: acertijo.pista.map((s) => s.texto).join(""), numero: acertijo.numero, nivel: acertijo.nivel };
    }
    const fecha = await proximaFecha(idioma);
    return fecha ? { tipo: "proximo", fecha } : null;
  } catch {
    return null;
  }
}
