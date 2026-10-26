import { leerPublicado, listarPublicados, proximaFecha } from "./publico";
import type { Idioma } from "./tipos";

export type EstadoCriptico =
  | { tipo: "hoy"; longitud: number; pista: string }
  | { tipo: "proximo"; fecha: string }
  | null;

/** El de hoy si ya hay; si no, el próximo publicado. Si la API falla, no sale nada. */
export async function estadoCriptico(idioma: Idioma): Promise<EstadoCriptico> {
  try {
    if ((await listarPublicados(idioma)).length > 0) {
      const entrega = await leerPublicado(idioma);
      if (!entrega) return null;
      return { tipo: "hoy", longitud: entrega.acertijo.longitud, pista: entrega.acertijo.pista.map((s) => s.texto).join("") };
    }
    const fecha = await proximaFecha(idioma);
    return fecha ? { tipo: "proximo", fecha } : null;
  } catch {
    return null;
  }
}
