import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import type { Locale } from "@/i18n/locale";
import { loadMessages } from "@/i18n/messages";
import { rutaTarjeta } from "@/lib/blog/imagenes";
import { leerPublicado } from "@/lib/blog/publico";

// Si el artículo trae su tarjeta en /public/blog/img/, esa es su imagen para compartir.
async function tarjetaPropia(idioma: Locale, slug: string, origen: string) {
  const ruta = rutaTarjeta(slug, idioma);
  if (!ruta) return null;
  const respuesta = await fetch(new URL(ruta, origen), { next: { revalidate: 3600 } }).catch(() => null);
  const tipo = respuesta?.headers.get("content-type") ?? "";
  if (!respuesta?.ok || !tipo.startsWith("image/")) return null;
  return new Response(await respuesta.arrayBuffer(), { headers: { "content-type": tipo, "cache-control": "public, max-age=3600" } });
}

// Imagen para compartir de un artículo: su tarjeta si la tiene; si no, la marca de la sección y el título.
export async function imagenDeArticulo(idioma: Locale, slug: string, origen: string) {
  const [articulo, mensajes] = await Promise.all([leerPublicado(slug, idioma).catch(() => null), loadMessages(idioma)]);
  if (!articulo) notFound();
  const tarjeta = await tarjetaPropia(idioma, slug, origen);
  if (tarjeta) return tarjeta;
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
