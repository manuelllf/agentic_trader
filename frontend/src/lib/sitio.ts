import type { Metadata } from "next";
import { normalizeLocale } from "@/i18n/locale";
import es from "../../messages/es/system.json";
import en from "../../messages/en/system.json";

export const AUTOR_PUBLICO = "Admin";
export const URL_PUBLICA = "https://vennett.app";

export function metadataCompartir({ titulo, descripcion, idioma, ruta, indexar = true }: {
  titulo: string; descripcion: string; idioma: string; ruta: string; indexar?: boolean;
}): Metadata {
  const locale = normalizeLocale(idioma) ?? "es";
  const textos = locale === "en" ? en : es;
  const imagen = {
    url: `${URL_PUBLICA}/og-vennett.png`, width: 1200, height: 630,
    alt: textos.system_imagen_compartir_alt,
  };
  return {
    title: titulo, description: descripcion, robots: { index: indexar, follow: indexar },
    openGraph: {
      title: titulo, description: descripcion, siteName: "Vennett", type: "website",
      url: `${URL_PUBLICA}${ruta}`, locale: locale === "en" ? "en_US" : "es_ES", images: [imagen],
    },
    twitter: { card: "summary_large_image", title: titulo, description: descripcion, images: [imagen] },
  };
}

// Páginas de sesión o de paso: título propio y fuera de los buscadores, sin imagen al compartir.
export function metadataSinIndexar(titulo: string): Metadata {
  return { title: titulo, robots: { index: false, follow: false } };
}
