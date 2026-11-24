// La idea escrita en la portada viaja a Crear por la sesión del navegador: sobrevive al alta
// y al acceso, y se consume una sola vez.
const CLAVE = "vennett.idea-portada";

export function guardarIdeaPortada(idea: string, almacen: Storage | null = sesion()): void {
  try { almacen?.setItem(CLAVE, idea.trim()); } catch { /* sin almacenamiento, Crear empieza vacío */ }
}

export function tomarIdeaPortada(almacen: Storage | null = sesion()): string | null {
  try {
    const idea = almacen?.getItem(CLAVE) ?? null;
    almacen?.removeItem(CLAVE);
    return idea && idea.trim() ? idea.trim() : null;
  } catch {
    return null;
  }
}

function sesion(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}
