import { describe, expect, it } from "vitest";
import { dejarPasar } from "./analitica";

describe("dejarPasar", () => {
  it.each([
    "https://vennett.app/",
    "/liga",
    "/liga?vista=tabla",
    "/liga/",
    "/premio",
    "/como-funciona",
    "/aprender",
    "/aprender/que-pasa-al-cierre",
    "/planes",
    "/entrar?next=%2Fliga",
    "/registrar",
    "/recuperar",
    "/legal/terminos",
    "/legal/bases-premio",
    "/blog",
    "/blog/un-articulo",
    "/en/blog",
    "/en/blog/an-article",
  ])("permite la ruta pública %s", (url) => {
    expect(dejarPasar({ type: "pageview", url })).not.toBeNull();
  });

  it.each([
    "/cuenta",
    "/cuenta/borrar",
    "/mias",
    "/privadas/1",
    "/crear/1",
    "/completar",
    "/auth/callback",
    "/confirmar?token=x",
    "/restablecer?token=x",
    "/cambiar-clave",
    "/avisos-alta",
    "/muestrario",
    "/admin",
    "/admin/liga/usuarios",
    "/api/algo",
    "/legal",
    "/blog/boletin",
    "/blog/boletin/confirmar?token=x",
    "/en/blog/boletin/baja?token=x",
    "/no-existe",
    "/aprender/uno/dos",
    "/ficha/abc123",
  ])("descarta la ruta privada o desconocida %s", (url) => {
    expect(dejarPasar({ type: "pageview", url })).toBeNull();
  });

  it("elimina la query y el fragmento y conserva el tipo", () => {
    expect(dejarPasar({ type: "pageview", url: "https://vennett.app/liga?vista=tabla#x" }))
      .toEqual({ type: "pageview", url: "https://vennett.app/liga" });
  });

  it("conserva la URL absoluta de la portada", () => {
    expect(dejarPasar({ type: "pageview", url: "https://vennett.app/" }))
      .toEqual({ type: "pageview", url: "https://vennett.app/" });
  });
});
