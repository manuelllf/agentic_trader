import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { loadMessages } from "@/i18n/messages";
import { leerPublicado } from "@/lib/criptico/publico";
import type { Idioma, Textos } from "@/lib/criptico/tipos";

// Imagen para compartir de un acertijo: su número y su pista. La respuesta nunca sale aquí.
export async function imagenDeAcertijo(idioma: Idioma, numero: string) {
  const [entrega, mensajes] = await Promise.all([leerPublicado(idioma, numero).catch(() => null), loadMessages(idioma)]);
  if (!entrega) notFound();
  const textos = mensajes as Textos;
  const titulo = textos.cr_imagen_numero.replace("{numero}", numero);
  const pista = entrega.acertijo.pista.map((segmento) => segmento.texto).join("").trim();
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%",
      background: "#0E0F10", color: "#F4F4F2", padding: "64px 72px" }}>
      <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#4FA39D" }}>Vennett</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 34, color: "#9AA0A6" }}>{titulo}</div>
        <div style={{ display: "flex", fontSize: 58, lineHeight: 1.2, fontWeight: 600 }}>{pista}</div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
