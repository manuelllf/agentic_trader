import { describe, expect, it } from "vitest";
import { acceptLanguage, deviceLocale, idiomaAlEntrar, idiomaDeRuta, normalizeLocale, preferredLocale, readCookie, rutaDeIdioma } from "./locale";
import { porcentaje, fecha, miles } from "../lib/liga/format";

describe("language resolution", () => {
  it.each(["/en", "/en/blog/x"])("resolves %s as English", (ruta) => {
    expect(idiomaDeRuta(ruta)).toBe("en");
  });
  it.each(["/", "/blog", "/english", "/entrar"])("leaves %s to language preferences", (ruta) => {
    expect(idiomaDeRuta(ruta)).toBeNull();
  });
  it("uses device language when the ordered language list is unavailable", () => {
    expect(deviceLocale(undefined, "en-US")).toBe("en");
    expect(deviceLocale([], "en-GB")).toBe("en");
    expect(deviceLocale(["es-MX", "en-US"], "en-US")).toBe("es");
    expect(deviceLocale(undefined, "fr-FR")).toBe("es");
  });
  it("honors browser priority and supported regional variants", () => {
    expect(preferredLocale(["fr-FR", "en-GB", "es-ES"])).toBe("en");
    expect(normalizeLocale(" ES_mx ")).toBe("es");
    expect(normalizeLocale("../en")).toBeNull();
    expect(preferredLocale(["fr"])).toBe("es");
  });
  it("honors HTTP quality and rejects excluded or invalid priorities", () => {
    expect(acceptLanguage("en;q=0.2,es;q=0.9")).toBe("es");
    expect(acceptLanguage("es;q=0,en-US;q=1")).toBe("en");
    expect(acceptLanguage("en;q=NaN,es;q=0.5")).toBe("es");
  });
  it("reads only the exact cookie and handles malformed encoding", () => {
    expect(readCookie("vennett_locale", "other_vennett_locale=en; vennett_locale=es")).toBe("es");
    expect(readCookie("vennett_locale", "vennett_locale=%GG")).toBeNull();
  });
});

describe("localized financial presentation", () => {
  it("keeps rounding and neutral zero identical in both languages", () => {
    expect(porcentaje(-0.05, 1, "en")).toBe("−0.1 %");
    expect(porcentaje(-0.05, 1, "es")).toBe("−0,1 %");
    expect(porcentaje(-0.001, 1, "en")).toBe("0.0 %");
    expect(miles(12345, "en")).toBe("12,345");
    expect(miles(12345, "es")).toBe("12.345");
  });
  it("changes date wording without changing the existing calendar boundary", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    expect(fecha("2026-10-03T22:30:00Z", now, "es")).toBe("4 de octubre");
    expect(fecha("2026-10-03T22:30:00Z", now, "en")).toBe("October 4");
  });
});

describe("idioma al entrar en la cuenta", () => {
  it("la elección de la portada gana al idioma de la cuenta y se guarda", () => {
    expect(idiomaAlEntrar({ elegido: "en", perfil: "es", actual: "en" })).toEqual({ idioma: "en", guardar: true, limpiar: true });
  });
  it("si la elección ya es la de la cuenta, no hay nada que guardar", () => {
    expect(idiomaAlEntrar({ elegido: "es", perfil: "es", actual: "en" })).toEqual({ idioma: "es", guardar: false, limpiar: true });
  });
  it("sin elección en la portada, manda el idioma de la cuenta", () => {
    expect(idiomaAlEntrar({ elegido: null, perfil: "en", actual: "es" })).toEqual({ idioma: "en", guardar: false, limpiar: false });
  });
  it("sin idioma en la cuenta, se queda el que ya se ve", () => {
    expect(idiomaAlEntrar({ elegido: null, perfil: null, actual: "en" })).toEqual({ idioma: "en", guardar: false, limpiar: false });
  });
});

describe("idioma del dispositivo en el boletín y el críptico", () => {
  it("un dispositivo en inglés abre la versión en inglés sin elección guardada", () => {
    expect(rutaDeIdioma("/blog", null, "en-US,en;q=0.9")).toBe("/en/blog");
    expect(rutaDeIdioma("/blog/nuestra-historia", null, "en")).toBe("/en/blog/nuestra-historia");
    expect(rutaDeIdioma("/criptico/12", undefined, "en-GB")).toBe("/en/criptico/12");
  });
  it("la elección guardada gana al dispositivo", () => {
    expect(rutaDeIdioma("/blog", "es", "en-US")).toBeNull();
    expect(rutaDeIdioma("/criptico", "en", "es-ES")).toBeNull();
  });
  it("un dispositivo en español o sin cabecera se queda en español", () => {
    expect(rutaDeIdioma("/blog", null, "es-ES,en;q=0.5")).toBeNull();
    expect(rutaDeIdioma("/blog", null, null)).toBeNull();
  });
  it("las rutas en inglés y las demás no cambian", () => {
    expect(rutaDeIdioma("/en/blog", null, "en")).toBeNull();
    expect(rutaDeIdioma("/liga", null, "en")).toBeNull();
  });
});
