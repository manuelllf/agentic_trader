// Solo estas rutas llegan a Vercel Web Analytics. El resto (cuenta, salas, enlaces con token) no se envía.
const BASE = "http://localhost"; // Solo para resolver rutas relativas; nunca se envía.

const PUBLICAS = [
  /^\/$/,
  /^\/(liga|como-funciona|planes|premio|entrar|registrar|recuperar)$/,
  /^\/aprender(?:\/[a-z-]+)?$/,
  /^\/legal\/[^/]+$/,
  /^\/blog$/,
  /^\/blog\/(?!boletin(?:\/|$))[^/]+$/,
  /^\/en\/blog$/,
  /^\/en\/blog\/(?!boletin(?:\/|$))[^/]+$/,
  /^\/ficha\/[^/]+$/,
];

/** Deja pasar solo las páginas públicas, sin query ni fragmento (pueden llevar datos personales). */
export function dejarPasar<E extends { url: string }>(evento: E): (E & { url: string }) | null {
  let ruta: string;
  try {
    ruta = new URL(evento.url, BASE).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
  return PUBLICAS.some((patron) => patron.test(ruta)) ? { ...evento, url: ruta } : null;
}
