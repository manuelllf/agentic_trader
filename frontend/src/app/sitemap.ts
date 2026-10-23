import type { MetadataRoute } from "next";
import { URL_PUBLICA } from "@/lib/sitio";
import { listarPublicados } from "@/lib/blog/publico";
import { leerCiclo } from "@/lib/aprender";
import { guiasVisibles } from "@/app/(liga)/aprender/guias";
import { listarPublicados as listarCripticos } from "@/lib/criptico/publico";

// Se genera por petición: la compilación no tiene API. La caché de las llamadas dura cinco minutos.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [es, en, ciclo, cripticos] = await Promise.all([
    listarPublicados("es").catch(() => []), listarPublicados("en").catch(() => []), leerCiclo().catch(() => null),
    Promise.all([listarCripticos("es"), listarCripticos("en")]).catch(() => [[], []]),
  ]);
  const fijas = ["/", "/como-funciona", "/aprender", ...guiasVisibles(ciclo?.premio.visible === true).map(g => `/aprender/${g.slug}`),
    "/legal/aviso", "/legal/privacidad", "/legal/terminos", "/legal/cookies", "/liga", "/premio", "/legal/bases-premio"]
    .map(ruta => ({ url: `${URL_PUBLICA}${ruta}` }));
  const entrada = (idioma: "es" | "en", slug?: string): MetadataRoute.Sitemap[number] => {
    const sufijo = slug ? `/${encodeURIComponent(slug)}` : "";
    return { url: `${URL_PUBLICA}${idioma === "en" ? "/en" : ""}/blog${sufijo}`,
      alternates: { languages: { es: `${URL_PUBLICA}/blog${sufijo}`, en: `${URL_PUBLICA}/en/blog${sufijo}` } } };
  };
  const archivo = cripticos.flatMap((indice, i) => indice.map(a => ({
    url: `${URL_PUBLICA}${i === 0 ? "" : "/en"}/criptico/${a.numero}`, lastModified: a.fecha,
  })));
  // La portada de cada idioma solo se anuncia si ya tiene algún acertijo publicado.
  const portadas = [0, 1].filter(i => cripticos[i].length > 0)
    .map(i => ({ url: `${URL_PUBLICA}${i === 0 ? "" : "/en"}/criptico` }));
  return [...fijas, entrada("es"), entrada("en"), ...es.map(a => entrada("es", a.slug)), ...en.map(a => entrada("en", a.slug)),
    ...portadas, ...archivo];
}
