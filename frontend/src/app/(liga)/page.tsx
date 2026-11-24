import type { Viewport } from "next";
import { Portada } from "./_portada/Portada";
import type { BoletinPortada } from "./_portada/Secciones";
import { getLocale, getTranslations } from "next-intl/server";
import { estadoCriptico } from "@/lib/criptico/estado";
import type { Idioma } from "@/lib/criptico/tipos";
import { escaparJsonLd, listarPublicados } from "@/lib/blog/publico";
import { leerPortadaDemo } from "@/lib/liga/portada";
import { PERFILES_PUBLICOS, URL_PUBLICA, metadataCompartir } from "@/lib/sitio";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: t("portada_meta_titulo"), descripcion: t("portada_meta_descripcion"), idioma, ruta: "/" });
}

// La barra del sistema va del petróleo hondo de la demo, igual en claro y en oscuro.
// Se repite el viewport raíz porque esta exportación lo sustituye.
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#052522" },
    { media: "(prefers-color-scheme: dark)", color: "#021614" },
  ],
};

// El último artículo del boletín; si la API falla o no hay ninguno, la pieza no sale.
async function ultimoArticulo(idioma: Idioma): Promise<BoletinPortada> {
  try {
    const [articulo] = await listarPublicados(idioma);
    if (!articulo) return null;
    return { slug: articulo.slug, titulo: articulo.titulo, resumen: articulo.resumen, minutos: Math.max(1, Math.round(articulo.palabras / 200)) };
  } catch {
    return null;
  }
}

// Antes de pintar: si hay una sesión guardada, la portada espera oculta a saber si va a la liga.
const AVISO_SESION = `try{if(localStorage.getItem("liguilla-sesion"))document.documentElement.setAttribute("data-con-sesion","")}catch(e){}`;

export default async function Page() {
  const locale = await getLocale();
  const idioma: Idioma = locale === "en" ? "en" : "es";
  const [demo, criptico, boletin] = await Promise.all([leerPortadaDemo(idioma), estadoCriptico(idioma), ultimoArticulo(idioma)]);
  const datos = [
    { "@context": "https://schema.org", "@type": "WebSite", name: "Vennett", url: URL_PUBLICA, inLanguage: locale },
    { "@context": "https://schema.org", "@type": "Organization", name: "Vennett", url: URL_PUBLICA, sameAs: PERFILES_PUBLICOS },
  ];
  return <>
    <script dangerouslySetInnerHTML={{ __html: AVISO_SESION }} />
    <script type="application/ld+json">{escaparJsonLd(datos)}</script>
    <Portada demo={demo} criptico={criptico} boletin={boletin} />
  </>;
}
