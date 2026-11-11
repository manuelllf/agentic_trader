import type { Viewport } from "next";
import { Portada } from "./_portada/Portada";
import type { BoletinHoy } from "./_portada/Hoy";
import { getLocale, getTranslations } from "next-intl/server";
import { estadoCriptico } from "@/lib/criptico/estado";
import type { Idioma } from "@/lib/criptico/tipos";
import { escaparJsonLd, listarPublicados } from "@/lib/blog/publico";
import { URL_PUBLICA, metadataCompartir } from "@/lib/sitio";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: t("system_titulo_compartir"), descripcion: t("system_descripcion_compartir"), idioma, ruta: "/" });
}

// La barra del sistema sigue el tema para acompañar los colores de la portada.
// Se repite el viewport raíz porque esta exportación lo sustituye.
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2F7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// El último artículo del boletín; si la API falla o no hay ninguno, la pieza no sale.
async function ultimoArticulo(idioma: Idioma): Promise<BoletinHoy> {
  try {
    const [articulo] = await listarPublicados(idioma);
    if (!articulo) return null;
    return { slug: articulo.slug, titulo: articulo.titulo, resumen: articulo.resumen, minutos: Math.max(1, Math.round(articulo.palabras / 200)) };
  } catch {
    return null;
  }
}

// «Hoy» enseña el críptico de hoy o el próximo y el último artículo; lo que falle no sale.
export default async function Page() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations()]);
  const idioma: Idioma = locale === "en" ? "en" : "es";
  const [criptico, boletin] = await Promise.all([estadoCriptico(idioma), ultimoArticulo(idioma)]);
  const datos = [
    { "@context": "https://schema.org", "@type": "WebSite", name: "Vennett", url: URL_PUBLICA, inLanguage: locale },
    { "@context": "https://schema.org", "@type": "Organization", name: "Vennett", url: URL_PUBLICA },
  ];
  return <>
    <script type="application/ld+json">{escaparJsonLd(datos)}</script>
    <h1 className="sr-only">{t("landing_titular")}</h1>
    <Portada criptico={criptico} boletin={boletin} />
  </>;
}
