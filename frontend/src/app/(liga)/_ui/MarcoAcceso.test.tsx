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
  it("pone la cabecera arriba, el formulario en el centro y el pie abajo", () => {
    montar();
    const main = contenedor.querySelector("main");
    const [primero, segundo, tercero] = Array.from(main?.children ?? []).filter(
      (el) => el.tagName !== "svg" && !el.classList.contains("acc-arte-fondo"));
    expect(primero.tagName).toBe("HEADER");
    expect(primero.querySelector(".wordmark")).not.toBeNull();
    expect(segundo.classList.contains("acc-centro")).toBe(true);
    expect(segundo.querySelector("form")).not.toBeNull();
    expect(tercero.tagName).toBe("FOOTER");
  });
  it("no muestra planes ni propuesta de valor en el acceso", () => {
    montar("crear");
    expect(contenedor.querySelector(".acc-puntos")).toBeNull();
    expect(contenedor.querySelector(".acc-puntos, .acc-arte-bloque")).toBeNull();
    expect(contenedor.querySelector(".acc-arte-fondo")?.getAttribute("aria-hidden")).toBe("true");
    expect(contenedor.textContent).not.toMatch(/Pro|4,99|49/);
  });
  it("marca entrar y enlaza con crear y con lo legal", () => {
    montar();
    expect(contenedor.querySelectorAll("h1")).toHaveLength(1);
    expect(contenedor.querySelector("h1")?.textContent).toBe(mensajes.auth_entrar);
    const cambio = contenedor.querySelector(".acc-cambio");
    expect(cambio?.textContent).toContain(mensajes.auth_sin_cuenta_pregunta);
    expect(cambio?.querySelector("a")?.getAttribute("href")).toBe("/registrar");
    const entrar = contenedor.querySelector('nav a[href="/entrar"]');
    const crear = contenedor.querySelector('nav a[href="/registrar"]');
    expect(entrar?.getAttribute("aria-current")).toBe("page");
    expect(entrar?.classList.contains("on")).toBe(true);
    expect(crear?.hasAttribute("aria-current")).toBe(false);
    expect(contenedor.querySelector("nav")?.getAttribute("aria-label")).toBe(mensajes.auth_pestanas);
    for (const ruta of ["/legal/terminos", "/legal/privacidad", "/legal/cookies"]) {
      expect(contenedor.querySelector(`footer a[href="${ruta}"]`)).not.toBeNull();
    }
  });
  it("marca crear como pestaña actual", () => {
    montar("crear");
    expect(contenedor.querySelector("h1")?.textContent).toBe(mensajes.auth_crear_cuenta);
    const cambio = contenedor.querySelector(".acc-cambio");
    expect(cambio?.textContent).toContain(mensajes.auth_con_cuenta_pregunta);
    expect(cambio?.querySelector("a")?.getAttribute("href")).toBe("/entrar");
    expect(contenedor.querySelector('nav a[href="/registrar"]')?.getAttribute("aria-current")).toBe("page");
    expect(contenedor.querySelector('nav a[href="/entrar"]')?.hasAttribute("aria-current")).toBe(false);
  });
  it("el modo código omite pestañas y enlaces y muestra su pie", () => {
    montar("entrar", "codigo");
    expect(contenedor.querySelector("nav")).toBeNull();
    expect(contenedor.querySelector(".acc-cambio")).toBeNull();
    expect(contenedor.querySelectorAll("h1")).toHaveLength(1);
    expect(contenedor.querySelector("h1")?.textContent).toBe(mensajes.auth_tu_codigo);
    expect(contenedor.querySelector("footer")?.textContent).toBe(mensajes.auth_codigo_cambia);
    expect(contenedor.querySelector("form")).not.toBeNull();
  });
});
