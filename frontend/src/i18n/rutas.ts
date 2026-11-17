// Páginas públicas que existen en los dos idiomas. El español vive en la ruta de siempre y el inglés en
// `/en/<ruta>`, que el middleware reescribe a la misma página con el idioma marcado. El blog y el críptico
// tienen sus propios ficheros en `/en`, así que no entran aquí.
import type { Locale } from "./locale";

const TRADUCIBLES = [
  /^\/$/,
  /^\/(liga|como-funciona|planes|premio|entrar|registrar|recuperar|quienes-somos|politica-editorial)$/,
  /^\/aprender(?:\/[a-z-]+)?$/,
  /^\/legal\/[a-z-]+$/,
];

/** La ruta sin el prefijo de idioma: `/en` es la portada y `/en/liga` es `/liga`. */
export function quitarIdioma(ruta: string): string {
  if (ruta === "/en") return "/";
  return ruta.startsWith("/en/") ? ruta.slice(3) : ruta;
}

/** Si la ruta (sin query ni fragmento, con o sin `/en`) es una página pública con versión en cada idioma. */
export function esRutaTraducible(ruta: string): boolean {
  const base = quitarIdioma(ruta.length > 1 ? ruta.replace(/\/+$/, "") : ruta);
  return TRADUCIBLES.some(patron => patron.test(base));
}

function partir(href: string): [string, string] {
  const corte = href.search(/[?#]/);
  return corte === -1 ? [href, ""] : [href.slice(0, corte), href.slice(corte)];
}

/** La ruta de esa página en el idioma pedido, conservando query y fragmento; igual si no es traducible. */
export function rutaEnIdioma(href: string, idioma: Locale): string {
  const [ruta, resto] = partir(href);
  if (!ruta.startsWith("/") || !esRutaTraducible(ruta)) return href;
  const base = quitarIdioma(ruta);
  return `${idioma === "en" ? (base === "/" ? "/en" : `/en${base}`) : base}${resto}`;
}

/** Los pares de URLs absolutas de una página pública, para canonical, hreflang y sitemap. */
export function urlsDeIdiomas(origen: string, base: string): Record<Locale, string> {
  const ruta = quitarIdioma(base);
  return { es: `${origen}${ruta}`, en: `${origen}${ruta === "/" ? "/en" : `/en${ruta}`}` };
}
