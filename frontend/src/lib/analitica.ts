import { quitarIdioma } from "@/i18n/rutas";

// Solo estas rutas llegan a Vercel Web Analytics. El resto (cuenta, salas, enlaces con token) no se envía.
const BASE = "https://vennett.app"; // Solo para resolver rutas relativas; Vercel siempre envía la URL absoluta.

const PUBLICAS = [
  /^\/$/,
  /^\/(liga|como-funciona|planes|premio|entrar|registrar|recuperar)$/,
  /^\/aprender(?:\/[a-z-]+)?$/,
  /^\/legal\/[^/]+$/,
  /^\/blog$/,
  /^\/blog\/(?!boletin(?:\/|$))[^/]+$/,
  // El críptico y su archivo por número; la baja y la confirmación llevan token y quedan fuera.
  /^\/criptico$/,
  /^\/criptico\/\d+$/,
];

/** Deja pasar solo las páginas públicas (en español o con `/en`), sin query ni fragmento (pueden llevar
 *  datos personales). */
export function dejarPasar<E extends { url: string }>(evento: E): (E & { url: string }) | null {
  try {
    const ruta = new URL(evento.url, BASE).pathname.replace(/\/+$/, "") || "/";
    const url = new URL(evento.url, BASE);
    url.pathname = ruta;
    url.search = "";
    url.hash = "";
    const base = quitarIdioma(ruta);
    return PUBLICAS.some((patron) => patron.test(base)) ? { ...evento, url: url.toString() } : null;
  } catch {
    return null;
  }
}
