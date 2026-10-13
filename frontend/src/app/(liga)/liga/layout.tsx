import { getLocale, getTranslations } from "next-intl/server";
import { metadataCompartir } from "@/lib/sitio";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({
    titulo: `${t("league_titulo")} — Vennett`, descripcion: t("meta_liga_descripcion"), idioma, ruta: "/liga",
  });
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
