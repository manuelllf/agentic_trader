// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Locale } from "@/i18n/locale";
import { SelectorIdiomaBlog } from "./SelectorIdiomaBlog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let contenedor: HTMLDivElement;

afterEach(() => {
  if (raiz) act(() => raiz?.unmount());
  raiz = undefined;
  contenedor?.remove();
});

function montar(idioma: Locale = "es", hrefEs = "/blog", hrefEn = "/en/blog") {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz?.render(<SelectorIdiomaBlog idioma={idioma} hrefEs={hrefEs} hrefEn={hrefEn} />));
  return contenedor.querySelector("button")!;
}

function opciones() {
  return Array.from(contenedor.querySelectorAll<HTMLAnchorElement>(".language-options a"));
}

describe("SelectorIdiomaBlog", () => {
  it.each(["es", "en"] as const)("muestra el código y la etiqueta de %s", idioma => {
    const disparador = montar(idioma);
    expect(disparador.textContent).toBe(idioma.toUpperCase());
    expect(disparador.getAttribute("aria-label")).toBe(idioma === "es" ? "Idioma: Español" : "Language: English");
    expect(disparador.getAttribute("aria-expanded")).toBe("false");
    expect(disparador.querySelector(".language-chevron")).not.toBeNull();
    expect(opciones()).toHaveLength(0);
  });

  it.each(["es", "en"] as const)("abre enlaces del listado y marca %s como activo", idioma => {
    const disparador = montar(idioma);
    act(() => disparador.click());
    expect(disparador.getAttribute("aria-expanded")).toBe("true");
    expect(opciones().map(enlace => enlace.getAttribute("href"))).toEqual(["/blog", "/en/blog"]);
    expect(opciones().map(enlace => enlace.textContent)).toEqual(["Español", "English"]);
    for (const [indice, enlace] of opciones().entries()) {
      const language = indice === 0 ? "es" : "en";
      expect(enlace.lang).toBe(language);
      expect(enlace.getAttribute("aria-pressed")).toBe(String(language === idioma));
    }
  });

  it("conserva las URL del artículo calculadas por el servidor", () => {
    const disparador = montar("es", "/blog/limites", "/en/blog/limites");
    act(() => disparador.click());
    expect(opciones().map(enlace => enlace.getAttribute("href"))).toEqual(["/blog/limites", "/en/blog/limites"]);
  });

  it("cierra con Escape y devuelve el foco al disparador", () => {
    const disparador = montar();
    act(() => disparador.click());
    act(() => opciones()[1].focus());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(opciones()).toHaveLength(0);
    expect(disparador.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(disparador);
  });

  it("mantiene abierto al pulsar dentro y cierra al pulsar fuera", () => {
    const disparador = montar();
    act(() => disparador.click());
    act(() => opciones()[0].dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(opciones()).toHaveLength(2);
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(opciones()).toHaveLength(0);
    expect(disparador.getAttribute("aria-expanded")).toBe("false");
  });
});
