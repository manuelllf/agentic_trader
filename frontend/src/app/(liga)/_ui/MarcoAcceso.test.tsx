// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../messages/es/auth.json";
import { MarcoAcceso } from "./MarcoAcceso";

vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let contenedor: HTMLDivElement;

afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
});

function montar(pestana: "entrar" | "crear" = "entrar", modo: "completo" | "codigo" = "completo") {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz.render(<NextIntlClientProvider locale="es" messages={mensajes}>
    <MarcoAcceso pestana={pestana} modo={modo}><form /></MarcoAcceso>
  </NextIntlClientProvider>));
}

describe("MarcoAcceso", () => {
  it("marca entrar y conserva las rutas de acceso y legales", () => {
    montar();
    expect(contenedor.querySelectorAll("h1")).toHaveLength(1);
    expect(contenedor.querySelector(".acc-t-movil")?.textContent).toBe(mensajes.auth_entrar);
    expect(contenedor.querySelector(".acc-t-esc")?.textContent).toBe(mensajes.auth_titular);
    const cambio = contenedor.querySelector(".acc-cambio");
    expect(cambio?.textContent).toContain(mensajes.auth_sin_cuenta_pregunta);
    expect(cambio?.querySelector("a")?.getAttribute("href")).toBe("/registrar");
    expect(cambio?.querySelector("a")?.textContent).toBe(mensajes.auth_crear_cuenta);
    expect(contenedor.querySelector("form")?.nextElementSibling).toBe(cambio);
    expect(cambio?.nextElementSibling?.tagName).toBe("FOOTER");
    const fondo = contenedor.querySelector(".acc-arte-fondo");
    expect(fondo?.getAttribute("aria-hidden")).toBe("true");
    expect(fondo?.hasAttribute("role")).toBe(false);
    expect(fondo?.getAttribute("viewBox")).toBe("0 0 390 330");
    expect(contenedor.querySelector(".acc-arte-bloque")?.getAttribute("aria-label")).toBe(mensajes.auth_arte_alt);
    expect(contenedor.querySelector(".acc-arte[id], .acc-arte [id]")).toBeNull();
    const entrar = contenedor.querySelector('nav a[href="/entrar"]');
    const crear = contenedor.querySelector('nav a[href="/registrar"]');
    expect(entrar?.getAttribute("aria-current")).toBe("page");
    expect(entrar?.classList.contains("on")).toBe(true);
    expect(crear?.hasAttribute("aria-current")).toBe(false);
    expect(contenedor.querySelector('nav')?.getAttribute("aria-label")).toBe(mensajes.auth_pestanas);
    for (const ruta of ["/", "/entrar", "/registrar", "/legal/terminos", "/legal/privacidad"]) {
      expect(contenedor.querySelector(`a[href="${ruta}"]`)).not.toBeNull();
    }
  });
  it("marca crear como pestaña actual", () => {
    montar("crear");
    expect(contenedor.querySelectorAll("h1")).toHaveLength(1);
    expect(contenedor.querySelector(".acc-t-movil")?.textContent).toBe(mensajes.auth_crear_cuenta);
    const cambio = contenedor.querySelector(".acc-cambio");
    expect(cambio?.textContent).toContain(mensajes.auth_con_cuenta_pregunta);
    expect(cambio?.querySelector("a")?.getAttribute("href")).toBe("/entrar");
    expect(cambio?.querySelector("a")?.textContent).toBe(mensajes.auth_entrar);
    expect(contenedor.querySelector('nav a[href="/registrar"]')?.getAttribute("aria-current")).toBe("page");
    expect(contenedor.querySelector('nav a[href="/entrar"]')?.hasAttribute("aria-current")).toBe(false);
  });
  it("el modo código omite pestañas y arte y muestra su pie", () => {
    montar("entrar", "codigo");
    expect(contenedor.querySelector("nav")).toBeNull();
    expect(contenedor.querySelector(".acc-cambio")).toBeNull();
    expect(contenedor.querySelector(".acc-arte-fondo")).toBeNull();
    expect(contenedor.querySelectorAll("h1")).toHaveLength(1);
    expect(contenedor.querySelector(".acc-arte")).toBeNull();
    expect(contenedor.querySelector("h1")?.textContent).toBe(mensajes.auth_tu_codigo);
    expect(contenedor.querySelector("footer")?.textContent).toBe(mensajes.auth_codigo_cambia);
    expect(contenedor.querySelector("form")).not.toBeNull();
  });
});
