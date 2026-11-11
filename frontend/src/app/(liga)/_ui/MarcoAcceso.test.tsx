// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../messages/es/auth.json";
import { MarcoAcceso } from "./MarcoAcceso";

vi.mock("./acceso-v3.css", () => ({}));
vi.mock("@/components/selector-idioma.css", () => ({}));
vi.mock("@/i18n/Provider", () => ({
  useLanguage: () => ({ locale: "es", changing: false, selectLocale: () => {} }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let contenedor: HTMLDivElement;

afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
});

function montar(pestana: "entrar" | "crear" = "entrar", modo: "completo" | "codigo" | "tramite" = "completo", sinCambio = false) {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz.render(<NextIntlClientProvider locale="es" messages={mensajes}>
    <MarcoAcceso pestana={pestana} modo={modo} sinCambio={sinCambio}><form /></MarcoAcceso>
  </NextIntlClientProvider>));
}

describe("MarcoAcceso", () => {
  it("pone la cabecera arriba, el formulario en el centro y el pie abajo", () => {
    montar();
    const main = contenedor.querySelector("main");
    const [primero, segundo, tercero] = Array.from(main?.children ?? []);
    expect(primero.tagName).toBe("HEADER");
    expect(primero.querySelector(".wordmark")).not.toBeNull();
    expect(primero.querySelector(".selector-idioma")).not.toBeNull();
    expect(segundo.classList.contains("acc-centro")).toBe(true);
    expect(segundo.querySelector("form")).not.toBeNull();
    expect(tercero.tagName).toBe("FOOTER");
  });
  it("no muestra planes, propuesta de valor ni dibujo de fondo en el acceso", () => {
    montar("crear");
    expect(contenedor.querySelector(".acc-arte-fondo")).toBeNull();
    expect(contenedor.querySelector(".acc-puntos")).toBeNull();
    expect(contenedor.textContent).not.toMatch(/Pro|4,99|49/);
  });
  it("marca entrar en el segmentado y enlaza con crear", () => {
    montar();
    const h1 = contenedor.querySelector("h1");
    expect(h1?.textContent).toBe(mensajes.auth_entrar);
    expect(h1?.classList.contains("v3-sr")).toBe(true);
    const nav = contenedor.querySelector("nav.v3-seg");
    expect(nav?.getAttribute("aria-label")).toBe(mensajes.auth_pestanas);
    expect(nav?.querySelector('a[href="/entrar"]')?.getAttribute("aria-current")).toBe("page");
    expect(nav?.querySelector('a[href="/registrar"]')?.hasAttribute("aria-current")).toBe(false);
    for (const ruta of ["/legal/terminos", "/legal/privacidad", "/legal/cookies"]) {
      expect(contenedor.querySelector(`footer a[href="${ruta}"]`)).not.toBeNull();
    }
  });
  it("marca crear como pestaña actual", () => {
    montar("crear");
    expect(contenedor.querySelector("h1")?.textContent).toBe(mensajes.auth_crear_cuenta);
    expect(contenedor.querySelector('nav a[href="/registrar"]')?.getAttribute("aria-current")).toBe("page");
    expect(contenedor.querySelector('nav a[href="/entrar"]')?.hasAttribute("aria-current")).toBe(false);
    expect(contenedor.querySelector('nav.v3-seg')?.getAttribute("data-activo")).toBe("crear");
  });
  it("con sinCambio no muestra las pestañas", () => {
    montar("crear", "completo", true);
    expect(contenedor.querySelector("nav.v3-seg")).toBeNull();
    expect(contenedor.querySelector('a[href="/entrar"]')).toBeNull();
    expect(contenedor.querySelector('a[href="/registrar"]')).toBeNull();
    expect(contenedor.querySelector("h1")?.textContent).toBe(mensajes.auth_crear_cuenta);
    expect(contenedor.querySelector("form")).not.toBeNull();
  });
  it("el modo código omite las pestañas y muestra el título visible", () => {
    montar("entrar", "codigo");
    expect(contenedor.querySelector("nav.v3-seg")).toBeNull();
    expect(contenedor.querySelectorAll("h1")).toHaveLength(1);
    expect(contenedor.querySelector("h1")?.textContent).toBe(mensajes.auth_tu_codigo);
    expect(contenedor.querySelector("h1")?.classList.contains("v3-sr")).toBe(false);
    expect(contenedor.querySelector("footer a[href='/legal/terminos']")).not.toBeNull();
    expect(contenedor.querySelector("form")).not.toBeNull();
  });
  it("los trámites conservan su diseño anterior", () => {
    montar("entrar", "tramite");
    expect(contenedor.querySelector("main")?.classList.contains("acc-solo")).toBe(true);
    expect(contenedor.querySelector("main")?.classList.contains("acc-v3")).toBe(false);
    expect(contenedor.querySelector("h1")?.classList.contains("v3-sr")).toBe(false);
    expect(contenedor.querySelector("nav.v3-seg")).toBeNull();
  });
});
