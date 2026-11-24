// Medios que un artículo puede mostrar: solo los de nuestra carpeta pública /blog/img/. Nada de URLs de fuera
// (seguimiento de lectores) ni rutas con «..»; un SVG va como imagen, así que no ejecuta scripts.
const RAIZ = "/blog/img/";
const IMAGEN = /\.(png|jpe?g|webp|avif|gif|svg)$/i;
const VIDEO = /\.(mp4|webm)$/i;
const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type Medio = { tipo: "imagen" | "video"; src: string };

export function medioPropio(src: string | undefined): Medio | null {
  if (!src?.startsWith(RAIZ)) return null;
  const nombre = src.slice(RAIZ.length);
  if (!NOMBRE.test(nombre) || nombre.includes("..")) return null;
  if (IMAGEN.test(nombre)) return { tipo: "imagen", src };
  if (VIDEO.test(nombre)) return { tipo: "video", src };
  return null;
}

/** La tarjeta para compartir el enlace de un artículo, si existe en /blog/img/: `<slug>-tarjeta.png` o `-en`. */
export function rutaTarjeta(slug: string, idioma: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  return `${RAIZ}${slug}-tarjeta${idioma === "en" ? "-en" : ""}.png`;
}
