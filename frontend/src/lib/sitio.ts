import type { Metadata } from "next";
import { normalizeLocale } from "@/i18n/locale";
import es from "../../messages/es/system.json";
import en from "../../messages/en/system.json";

export const URL_PUBLICA = "https://vennett.app";

export function metadataCompartir({ titulo, descripcion, idioma, ruta }: {
  titulo: string; descripcion: string; idioma: string; ruta: string;
}): Metadata {
  const locale = normalizeLocale(idioma) ?? "es";
  const textos = locale === "en" ? en : es;
  const imagen = {
    url: `${URL_PUBLICA}/og-vennett.png`, width: 1200, height: 630,
    alt: textos.system_imagen_compartir_alt,
  };
  return {
    title: titulo, description: descripcion,
    openGraph: {
      title: titulo, description: descripcion, siteName: "Vennett", type: "website",
      url: `${URL_PUBLICA}${ruta}`, locale: locale === "en" ? "en_US" : "es_ES", images: [imagen],
    },
    twitter: { card: "summary_large_image", title: titulo, description: descripcion, images: [imagen] },
  };
}
