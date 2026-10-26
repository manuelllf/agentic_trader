import type { Viewport } from "next";
import { Portada } from "./_portada/Portada";
import { getLocale, getTranslations } from "next-intl/server";
import { estadoCriptico } from "@/lib/criptico/estado";
import type { Idioma } from "@/lib/criptico/tipos";
import { metadataCompartir } from "@/lib/sitio";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: t("system_titulo_compartir"), descripcion: t("system_descripcion_compartir"), idioma, ruta: "/" });
}

// La barra del sistema sigue el tema para acompañar los colores de la portada.
// Se repite el viewport raíz porque esta exportación lo sustituye.
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0C0D" },
  ],
};

// La regleta enseña el críptico de hoy o el próximo; si la API falla, no sale.
export default async function Page() {
  const idioma: Idioma = (await getLocale()) === "en" ? "en" : "es";
  return <Portada criptico={await estadoCriptico(idioma)} />;
}
