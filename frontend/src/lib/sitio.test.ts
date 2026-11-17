import { describe, expect, it } from "vitest";
import { metadataCompartir, metadataSinIndexar } from "./sitio";

describe("indexación", () => {
  it("indexa lo público por defecto y deja fuera lo que se pida", () => {
    const base = { titulo: "Título", descripcion: "Descripción", idioma: "es", ruta: "/ficha/1" };
    expect(metadataCompartir(base).robots).toEqual({ index: true, follow: true });
    expect(metadataCompartir({ ...base, indexar: false }).robots).toEqual({ index: false, follow: false });
  });

  it("una página de sesión lleva su título y queda fuera de los buscadores", () => {
    expect(metadataSinIndexar("Cuenta · Vennett")).toEqual({
      title: "Cuenta · Vennett", robots: { index: false, follow: false },
    });
  });
});

describe("versiones por idioma", () => {
  const base = { titulo: "T", descripcion: "D" };
  it.each([
    ["es", "/liga", "https://vennett.app/liga"],
    ["en", "/liga", "https://vennett.app/en/liga"],
    ["es", "/", "https://vennett.app/"],
    ["en", "/", "https://vennett.app/en"],
  ])("en %s, %s es su propia canónica y anuncia las dos versiones", (idioma, ruta, canonica) => {
    const alternates = metadataCompartir({ ...base, idioma, ruta }).alternates;
    expect(alternates?.canonical).toBe(canonica);
    expect(alternates?.languages).toEqual({
      es: ruta === "/" ? "https://vennett.app/" : `https://vennett.app${ruta}`,
      en: ruta === "/" ? "https://vennett.app/en" : `https://vennett.app/en${ruta}`,
      "x-default": ruta === "/" ? "https://vennett.app/" : `https://vennett.app${ruta}`,
    });
  });

  it("sin versión propia o sin indexar no hay canonical ni hreflang", () => {
    expect(metadataCompartir({ ...base, idioma: "en", ruta: "/ficha/1" }).alternates).toBeUndefined();
    expect(metadataCompartir({ ...base, idioma: "en", ruta: "/liga", indexar: false }).alternates).toBeUndefined();
  });
});

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
        url: idioma === "en" ? "https://vennett.app/en/legal/aviso" : "https://vennett.app/legal/aviso", locale,
        images: [{ url: "https://vennett.app/og-vennett.png", width: 1200, height: 630, alt }],
      },
      twitter: {
        card: "summary_large_image", title: "Título", description: "Descripción",
        images: [{ url: "https://vennett.app/og-vennett.png", width: 1200, height: 630, alt }],
      },
    });
  });
});
