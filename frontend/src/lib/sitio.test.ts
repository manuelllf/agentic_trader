import { describe, expect, it } from "vitest";
import { metadataCompartir } from "./sitio";

describe("metadataCompartir", () => {
  it.each([
    ["es", "es_ES", "Logotipo de Vennett"],
    ["en", "en_US", "Vennett logo"],
  ])("comparte en %s con imagen absoluta", (idioma, locale, alt) => {
    const metadata = metadataCompartir({ titulo: "Título", descripcion: "Descripción", idioma, ruta: "/legal/aviso" });
    expect(metadata).toMatchObject({
      title: "Título", description: "Descripción",
      openGraph: {
        title: "Título", description: "Descripción", siteName: "Vennett", type: "website",
        url: "https://vennett.app/legal/aviso", locale,
        images: [{ url: "https://vennett.app/og-vennett.png", width: 1200, height: 630, alt }],
      },
      twitter: {
        card: "summary_large_image", title: "Título", description: "Descripción",
        images: [{ url: "https://vennett.app/og-vennett.png", width: 1200, height: 630, alt }],
      },
    });
  });
});
