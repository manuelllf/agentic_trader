import type { MetadataRoute } from "next";
import { URL_PUBLICA } from "@/lib/sitio";
import { listarPublicados } from "@/lib/blog/publico";

// Se genera por petición: la compilación no tiene API. La caché de las llamadas dura cinco minutos.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fijas = ["/", "/como-funciona", "/legal/aviso", "/legal/privacidad", "/legal/terminos", "/legal/cookies"]
    .map(ruta => ({ url: `${URL_PUBLICA}${ruta}` }));
  const [es, en] = await Promise.all([listarPublicados("es"), listarPublicados("en")]);
  const entrada = (idioma: "es" | "en", slug?: string): MetadataRoute.Sitemap[number] => {
    const sufijo = slug ? `/${encodeURIComponent(slug)}` : "";
    return { url: `${URL_PUBLICA}${idioma === "en" ? "/en" : ""}/blog${sufijo}`,
      alternates: { languages: { es: `${URL_PUBLICA}/blog${sufijo}`, en: `${URL_PUBLICA}/en/blog${sufijo}` } } };
  };
  return [...fijas, entrada("es"), entrada("en"), ...es.map(a => entrada("es", a.slug)), ...en.map(a => entrada("en", a.slug))];
}
