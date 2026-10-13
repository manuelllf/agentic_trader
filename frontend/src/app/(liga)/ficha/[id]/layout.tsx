import { getLocale, getTranslations } from "next-intl/server";
import { metadataCompartir } from "@/lib/sitio";

// La ficha es de cada estrategia: se comparte por enlace, pero no se indexa.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const [t, idioma, { id }] = await Promise.all([getTranslations(), getLocale(), params]);
  return metadataCompartir({
    titulo: `${t("meta_ficha_titulo")} — Vennett`, descripcion: t("meta_ficha_descripcion"), idioma,
    ruta: `/ficha/${encodeURIComponent(id)}`, indexar: false,
  });
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
