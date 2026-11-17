import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

const pedir = (ruta: string, cabeceras: Record<string, string> = {}) =>
  middleware(new NextRequest(`https://vennett.app${ruta}`, { headers: cabeceras }));
const EN = { "accept-language": "en-US,en;q=0.9" };

describe("middleware: idioma en las páginas públicas", () => {
  it("un dispositivo en inglés sin elección pasa a la versión /en, con su query", () => {
    const r = pedir("/liga?vista=tabla", EN);
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://vennett.app/en/liga?vista=tabla");
    expect(pedir("/", EN).headers.get("location")).toBe("https://vennett.app/en");
  });

  it("la elección guardada, un dispositivo en español o un buscador sin cabecera no se redirigen", () => {
    expect(pedir("/liga", { ...EN, cookie: "vennett_locale=es" }).status).toBe(200);
    expect(pedir("/liga", { "accept-language": "es-ES" }).status).toBe(200);
    const buscador = pedir("/liga");
    expect(buscador.status).toBe(200);
    expect(buscador.headers.get("content-language")).toBe("es");
  });

  it("las páginas privadas no se redirigen ni se reescriben", () => {
    expect(pedir("/cuenta", EN).status).toBe(200);
    expect(pedir("/auth/callback", EN).status).toBe(200);
  });

  it("/en/<página pública> sirve la página española con el idioma marcado como inglés", () => {
    for (const [ruta, destino] of [["/en", "/"], ["/en/liga", "/liga"], ["/en/legal/terminos", "/legal/terminos"],
      ["/en/aprender/que-es-la-liga", "/aprender/que-es-la-liga"], ["/en/entrar", "/entrar"],
      ["/en/quienes-somos", "/quienes-somos"], ["/en/politica-editorial", "/politica-editorial"]]) {
      const r = pedir(ruta);
      expect(r.headers.get("x-middleware-rewrite")).toBe(`https://vennett.app${destino}`);
      expect(r.headers.get("x-middleware-request-x-vennett-idioma")).toBe("en");
      expect(r.headers.get("content-language")).toBe("en");
    }
  });

  it("el idioma de la ruta gana a la cookie y al dispositivo", () => {
    const r = pedir("/en/liga", { cookie: "vennett_locale=es", "accept-language": "es-ES" });
    expect(r.headers.get("x-middleware-rewrite")).toBe("https://vennett.app/liga");
    expect(r.headers.get("content-language")).toBe("en");
  });

  it("en inglés lo que no es una página pública con versión no se reescribe: blog y críptico tienen sus ficheros", () => {
    for (const ruta of ["/en/blog", "/en/blog/un-articulo", "/en/criptico", "/en/criptico/3", "/en/criptico/archivo", "/en/cuenta", "/en/admin"]) {
      const r = pedir(ruta);
      expect(r.headers.get("x-middleware-rewrite")).toBeNull();
      expect(r.headers.get("x-middleware-request-x-vennett-idioma")).toBe("en");
    }
  });
});
