import { getFicha } from "./api";
import { precargar } from "./cache";

/** Empieza a pedir la ficha antes del clic (dedo o ratón sobre la fila); `FichaContenido` lee la misma clave. */
export function precargarFicha(id: string): void {
  precargar(`ficha:${id}`, () => getFicha(id));
}
