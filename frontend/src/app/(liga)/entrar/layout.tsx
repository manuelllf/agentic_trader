import { getLocale, getTranslations } from "next-intl/server";
import { metadataCompartir } from "@/lib/sitio";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: `${t("auth_entrar")} · Vennett`, descripcion: t("meta_entrar_descripcion"), idioma, ruta: "/entrar" });
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
