// De dónde viene cada pantalla de la liga, para el chevron de vuelta (título de la anterior). Una pila de rutas en
// sessionStorage que crece al avanzar y baja al volver; sin almacenamiento, no hay chevron y la cabecera es la normal.

export type Origen = { ruta: string; titulo: string };

const CLAVE = "liga.origen.pila";
const MAXIMO = 20;

function leer(): Origen[] {
  try {
    const bruto = window.sessionStorage.getItem(CLAVE);
    const pila = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(pila) ? pila.filter((o) => typeof o?.ruta === "string" && typeof o?.titulo === "string") : [];
  } catch {
    return [];
  }
}

function guardar(pila: Origen[]): void {
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify(pila.slice(-MAXIMO)));
  } catch {
    // sin almacenamiento, la vuelta no se recuerda
  }
}

/** «Liga · Vennett» → «Liga». */
export function tituloLimpio(titulo: string): string {
  return titulo.replace(/\s*·\s*Vennett\s*$/, "").trim();
}

/** Al cambiar de ruta: si es la de debajo, se ha vuelto (baja la pila); si no, se avanza. */
export function cambioDeRuta(ruta: string): void {
  const pila = leer();
  if (pila.at(-1)?.ruta === ruta) return;
  if (pila.at(-2)?.ruta === ruta) pila.pop();
  else pila.push({ ruta, titulo: "" });
  guardar(pila);
}

/** El título llega cuando la pantalla ya se ha pintado. */
export function anotarTitulo(ruta: string, titulo: string): void {
  const pila = leer();
  const arriba = pila.at(-1);
  if (arriba?.ruta !== ruta) return;
  arriba.titulo = tituloLimpio(titulo);
  guardar(pila);
}

/** La pantalla de la que se vino a `ruta`, si se llegó navegando dentro de la app. */
export function leerOrigen(ruta: string): Origen | null {
  const pila = leer();
  const anterior = pila.at(-1)?.ruta === ruta ? pila.at(-2) : undefined;
  return anterior && anterior.titulo ? anterior : null;
}
