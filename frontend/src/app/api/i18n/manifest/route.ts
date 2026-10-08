import { NextResponse } from "next/server";
import { normalizeLocale } from "@/i18n/locale";
import { loadMessages } from "@/i18n/messages";

const application = {
  "name": "Vennett",
  "short_name": "Vennett",
  "description": "Pon a prueba tu estrategia y compárala con el S&P 500.",
  "id": "/",
  "start_url": "/liga",
  "scope": "/",
  "lang": "es",
  "display": "standalone",
  "background_color": "#0E0F10",
  "theme_color": "#FFFFFF",
  "icons": [
    {
      "src": "/icon-192.png?v=vennett-10",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png?v=vennett-10",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
};
const rooms = {
  "name": "Vennett · salas",
  "short_name": "Vennett",
  "description": "Las salas de Vennett: Alpha, Beta y Omega",
  "id": "/admin/",
  "start_url": "/admin/alpha",
  "scope": "/admin/",
  "display": "standalone",
  "background_color": "#0A0A0A",
  "theme_color": "#0A0A0A",
  "icons": [
    {
      "src": "/icon-192.png?v=vennett-10",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png?v=vennett-10",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = normalizeLocale(url.searchParams.get("locale")) ?? "es";
  const messages = await loadMessages(locale);
  const isAdmin = url.searchParams.get("scope") === "admin";
  return NextResponse.json({ ...(isAdmin ? rooms : application), lang: locale,
    description: messages[isAdmin ? "system_descripcion_salas" : "system_descripcion_app"] },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, max-age=3600" } });
}
