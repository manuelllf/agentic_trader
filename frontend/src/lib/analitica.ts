// Solo estas rutas llegan a Vercel Web Analytics. El resto (cuenta, salas, enlaces con token) no se envía.
const BASE = "https://vennett.app"; // Solo para resolver rutas relativas; Vercel siempre envía la URL absoluta.

const PUBLICAS = [
  /^\/$/,
  /^\/(liga|como-funciona|planes|premio|entrar|registrar|recuperar)$/,
  /^\/aprender(?:\/[a-z-]+)?$/,
  /^\/legal\/[^/]+$/,
  /^\/blog$/,
  /^\/blog\/(?!boletin(?:\/|$))[^/]+$/,
  /^\/en\/blog$/,
  /^\/en\/blog\/(?!boletin(?:\/|$))[^/]+$/,
];

/** Deja pasar solo las páginas públicas, sin query ni fragmento (pueden llevar datos personales). */
export function dejarPasar<E extends { url: string }>(evento: E): (E & { url: string }) | null {
  try {
    const ruta = new URL(evento.url, BASE).pathname.replace(/\/+$/, "") || "/";
    const url = new URL(evento.url, BASE);
    url.pathname = ruta;
    url.search = "";
    url.hash = "";
    return PUBLICAS.some((patron) => patron.test(ruta)) ? { ...evento, url: url.toString() } : null;
  } catch {
    return null;
  }
}
