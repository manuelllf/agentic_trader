// Desde dónde se abrió una ficha, para que su botón de atrás diga «Liga», «Mías» o el nombre de la liga privada.
// Va ligado a la ficha que se abre: si se llega a otra por un enlace, vuelve a «Liga». Sin sessionStorage, también.

const CLAVE = "liga.volver";

export type Volver = { texto: string; ruta: string };

export function guardarVolver(texto: string, ruta: string, fichaId: string): void {
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify({ texto, ruta, fichaId }));
  } catch {
    // sin almacenamiento, la ficha usa su destino por defecto
  }
}

export function leerVolver(fichaId: string): Volver | null {
  try {
    const bruto = window.sessionStorage.getItem(CLAVE);
    if (!bruto) return null;
    const valor = JSON.parse(bruto) as (Partial<Volver> & { fichaId?: string }) | null;
    return valor && valor.fichaId === fichaId && typeof valor.texto === "string" && typeof valor.ruta === "string"
      ? { texto: valor.texto, ruta: valor.ruta } : null;
  } catch {
    return null;
  }
}
