import { describe, expect, it } from "vitest";
import { esRutaTraducible, quitarIdioma, rutaEnIdioma, urlsDeIdiomas } from "./rutas";

describe("quitarIdioma", () => {
  it.each([
    ["/en", "/"], ["/en/liga", "/liga"], ["/en/aprender/uno", "/aprender/uno"],
    ["/", "/"], ["/liga", "/liga"], ["/entrar", "/entrar"], ["/english", "/english"], ["/en-curso", "/en-curso"],
  ])("%s queda como %s", (ruta, esperado) => {
    expect(quitarIdioma(ruta)).toBe(esperado);
  });
});

describe("esRutaTraducible", () => {
  it.each([
    "/", "/en", "/liga", "/en/liga", "/liga/", "/como-funciona", "/planes", "/premio", "/entrar", "/registrar",
    "/recuperar", "/aprender", "/aprender/crear-tu-estrategia", "/en/aprender/el-premio", "/legal/aviso",
    "/legal/bases-premio", "/en/legal/cookies",
  ])("%s tiene versión en cada idioma", (ruta) => {
    expect(esRutaTraducible(ruta)).toBe(true);
  });

  it.each([
    "/cuenta", "/en/cuenta", "/mias", "/crear", "/crear/1", "/privadas/2", "/ficha/abc", "/admin", "/en/admin",
    "/auth/callback", "/confirmar", "/restablecer", "/completar", "/muestrario", "/legal", "/aprender/uno/dos",
    "/blog", "/en/blog", "/criptico", "/premio/estrategia", "/api/x", "/en/en/liga",
  ])("%s no la tiene", (ruta) => {
    expect(esRutaTraducible(ruta)).toBe(false);
  });
});

describe("rutaEnIdioma", () => {
  it("en inglés añade /en a las públicas y conserva query y fragmento", () => {
    expect(rutaEnIdioma("/liga", "en")).toBe("/en/liga");
    expect(rutaEnIdioma("/", "en")).toBe("/en");
    expect(rutaEnIdioma("/liga?vista=tabla", "en")).toBe("/en/liga?vista=tabla");
    expect(rutaEnIdioma("/entrar?next=/crear", "en")).toBe("/en/entrar?next=/crear");
    expect(rutaEnIdioma("/legal/privacidad#derechos", "en")).toBe("/en/legal/privacidad#derechos");
    expect(rutaEnIdioma("/aprender/que-es-la-liga", "en")).toBe("/en/aprender/que-es-la-liga");
  });

  it("en español quita el prefijo", () => {
    expect(rutaEnIdioma("/en/liga", "es")).toBe("/liga");
    expect(rutaEnIdioma("/en", "es")).toBe("/");
    expect(rutaEnIdioma("/en/entrar?next=/crear", "es")).toBe("/entrar?next=/crear");
  });

  it("no toca lo que no es una página pública traducible", () => {
    for (const href of ["/crear", "/mias", "/cuenta/plan", "/ficha/1", "#derechos", "https://x.test/liga",
      "mailto:a@b.c", "/en/blog", "/blog/uno", "/criptico/3"]) {
      expect(rutaEnIdioma(href, "en")).toBe(href);
    }
  });

  it("una ruta que ya está en inglés no se duplica", () => {
    expect(rutaEnIdioma("/en/liga", "en")).toBe("/en/liga");
  });
});

describe("urlsDeIdiomas", () => {
  it("da las dos versiones absolutas, desde cualquiera de las dos", () => {
    const esperado = { es: "https://vennett.app/liga", en: "https://vennett.app/en/liga" };
    expect(urlsDeIdiomas("https://vennett.app", "/liga")).toEqual(esperado);
    expect(urlsDeIdiomas("https://vennett.app", "/en/liga")).toEqual(esperado);
    expect(urlsDeIdiomas("https://vennett.app", "/")).toEqual({ es: "https://vennett.app/", en: "https://vennett.app/en" });
  });
});
