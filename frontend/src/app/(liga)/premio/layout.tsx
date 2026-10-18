import { getLocale, getTranslations } from "next-intl/server";
import { metadataCompartir } from "@/lib/sitio";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({
    titulo: `${t("premio_titulo")} · Vennett`, descripcion: t("premio_intro_texto"), idioma, ruta: "/premio",
  });
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
