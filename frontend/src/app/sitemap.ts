import type { MetadataRoute } from "next";
import { URL_PUBLICA } from "@/lib/sitio";
import { listarPublicados } from "@/lib/blog/publico";
import { leerCiclo } from "@/lib/aprender";
import { guiasVisibles } from "@/app/(liga)/aprender/guias";

// Se genera por petición: la compilación no tiene API. La caché de las llamadas dura cinco minutos.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [es, en, ciclo] = await Promise.all([listarPublicados("es"), listarPublicados("en"), leerCiclo()]);
  const fijas = ["/", "/como-funciona", "/aprender", ...guiasVisibles(ciclo?.premio.visible === true).map(g => `/aprender/${g.slug}`),
    "/legal/aviso", "/legal/privacidad", "/legal/terminos", "/legal/cookies", "/liga", "/premio", "/legal/bases-premio"]
    .map(ruta => ({ url: `${URL_PUBLICA}${ruta}` }));
  const entrada = (idioma: "es" | "en", slug?: string): MetadataRoute.Sitemap[number] => {
    const sufijo = slug ? `/${encodeURIComponent(slug)}` : "";
    return { url: `${URL_PUBLICA}${idioma === "en" ? "/en" : ""}/blog${sufijo}`,
      alternates: { languages: { es: `${URL_PUBLICA}/blog${sufijo}`, en: `${URL_PUBLICA}/en/blog${sufijo}` } } };
  };
  return [...fijas, entrada("es"), entrada("en"), ...es.map(a => entrada("es", a.slug)), ...en.map(a => entrada("en", a.slug))];
}
