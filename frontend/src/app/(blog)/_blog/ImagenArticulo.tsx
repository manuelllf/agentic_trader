import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import type { Locale } from "@/i18n/locale";
import { loadMessages } from "@/i18n/messages";
import { leerPublicado } from "@/lib/blog/publico";

// Imagen para compartir de un artículo: la marca de la sección y el título del artículo.
export async function imagenDeArticulo(idioma: Locale, slug: string) {
  const [articulo, mensajes] = await Promise.all([leerPublicado(slug, idioma).catch(() => null), loadMessages(idioma)]);
  if (!articulo) notFound();
  const seccion = (mensajes as Record<string, string>).blog_seo;
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%",
      background: "#0E0F10", color: "#F4F4F2", padding: "64px 72px" }}>
      <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#4FA39D" }}>{seccion}</div>
      <div style={{ display: "flex", fontSize: 60, lineHeight: 1.15, fontWeight: 600 }}>{articulo.titulo}</div>
    </div>,
    { width: 1200, height: 630 },
  );
}
