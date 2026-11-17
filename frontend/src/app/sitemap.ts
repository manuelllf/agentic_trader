import type { MetadataRoute } from "next";
import { FECHA_SITIO, URL_PUBLICA } from "@/lib/sitio";
import { urlsDeIdiomas } from "@/i18n/rutas";
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
    "/legal/aviso", "/legal/privacidad", "/legal/terminos", "/legal/cookies", "/liga", "/premio", "/legal/bases-premio",
    "/quienes-somos", "/politica-editorial"]
    .flatMap(ruta => {
      // Cada página se lista en sus dos idiomas, y las dos entradas se anuncian entre sí.
      const urls = urlsDeIdiomas(URL_PUBLICA, ruta);
      const alternates = { languages: { es: urls.es, en: urls.en, "x-default": urls.es } };
      return [{ url: urls.es, lastModified: FECHA_SITIO, alternates }, { url: urls.en, lastModified: FECHA_SITIO, alternates }];
    });
  const entrada = (idioma: "es" | "en", slug?: string, fecha: string = FECHA_SITIO): MetadataRoute.Sitemap[number] => {
    const sufijo = slug ? `/${encodeURIComponent(slug)}` : "";
    return { url: `${URL_PUBLICA}${idioma === "en" ? "/en" : ""}/blog${sufijo}`, lastModified: fecha,
      alternates: { languages: { es: `${URL_PUBLICA}/blog${sufijo}`, en: `${URL_PUBLICA}/en/blog${sufijo}` } } };
  };
  const archivo = cripticos.flatMap((indice, i) => indice.map(a => ({
    url: `${URL_PUBLICA}${i === 0 ? "" : "/en"}/criptico/${a.numero}`, lastModified: a.fecha,
  })));
  // La portada de cada idioma solo se anuncia si ya tiene algún acertijo publicado.
  const portadas = [0, 1].filter(i => cripticos[i].length > 0)
    .map(i => ({ url: `${URL_PUBLICA}${i === 0 ? "" : "/en"}/criptico`, lastModified: cripticos[i].at(-1)?.fecha ?? FECHA_SITIO }));
  // El archivo se anuncia con la fecha del último acertijo, que es cuando cambia.
  const listas = [0, 1].filter(i => cripticos[i].length > 0)
    .map(i => ({ url: `${URL_PUBLICA}${i === 0 ? "" : "/en"}/criptico/archivo`, lastModified: cripticos[i].at(-1)?.fecha }));
  return [...fijas, entrada("es", undefined, es[0]?.publicado_en), entrada("en", undefined, en[0]?.publicado_en),
    ...es.map(a => entrada("es", a.slug, a.publicado_en)), ...en.map(a => entrada("en", a.slug, a.publicado_en)),
    ...portadas, ...listas, ...archivo];
}
