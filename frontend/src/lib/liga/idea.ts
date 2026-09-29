// La idea que alguien escribe en la portada espera en el navegador (almacenamiento de sesión) hasta
// que entra y llega al editor. No sale de ahí y no va por la URL.

const CLAVE = "liguilla-idea";
export const LARGO_IDEA = 300;

/** Guarda la idea para el editor. Vacía, no guarda nada. Nunca lanza: sin almacenamiento, se pierde. */
export function guardarIdea(texto: string): void {
  const idea = texto.trim().slice(0, LARGO_IDEA);
  try {
    if (idea) sessionStorage.setItem(CLAVE, idea);
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* almacenamiento bloqueado: el editor empieza vacío */
  }
}

/** Devuelve la idea guardada y la borra, para que solo se use una vez. */
export function tomarIdea(): string {
  try {
    const idea = sessionStorage.getItem(CLAVE) ?? "";
    sessionStorage.removeItem(CLAVE);
    return idea.slice(0, LARGO_IDEA);
  } catch {
    return "";
  }
}
