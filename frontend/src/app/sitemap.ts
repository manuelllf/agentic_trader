import type { MetadataRoute } from "next";
import { URL_PUBLICA } from "@/lib/sitio";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/como-funciona", "/planes", "/legal/aviso", "/legal/privacidad", "/legal/terminos", "/legal/cookies"]
    .map((ruta) => ({ url: `${URL_PUBLICA}${ruta}` }));
}
