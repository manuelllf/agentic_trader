// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as idioma from "./Provider";
import type { Locale } from "./locale";
import { LanguageSelector } from "./LanguageSelector";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let contenedor: HTMLDivElement;

afterEach(() => {
  if (raiz) act(() => raiz?.unmount());
  raiz = undefined;
  contenedor?.remove();
  document.cookie = "vennett_locale=; Path=/; Max-Age=0";
  vi.restoreAllMocks();
});

function montar(locale: Locale = "es") {
  const selectLocale = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(idioma, "useLanguage").mockReturnValue({
    locale, changing: false, failure: false, selectLocale, setAccount: vi.fn(),
  });
  document.cookie = `vennett_locale=${locale}; Path=/`;
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz?.render(<idioma.LanguageProvider locale={locale} messages={{
    common_idioma: locale === "es" ? "Idioma" : "Language",
    common_idioma_error: "Error",
  }}>
    <LanguageSelector />
  </idioma.LanguageProvider>));
  const disparador = contenedor.querySelector("button")!;
  return { disparador, selectLocale };
}

function opciones() {
  return Array.from(contenedor.querySelectorAll<HTMLButtonElement>(".language-options button"));
}

describe("LanguageSelector", () => {
  it.each(["es", "en"] as const)("muestra el código de %s sin bandera", locale => {
    const { disparador } = montar(locale);
    expect(disparador.textContent).toBe(locale.toUpperCase());
    expect(disparador.getAttribute("aria-label")).toBe(locale === "es" ? "Idioma: Español" : "Language: English");
    expect(disparador.querySelectorAll("svg")).toHaveLength(1);
    expect(disparador.querySelector("svg")?.classList.contains("language-chevron")).toBe(true);
    expect(disparador.querySelector("svg:not(.language-chevron)")).toBeNull();
  });

  it.each(["es", "en"] as const)("abre las opciones y marca %s como activo", locale => {
    const { disparador } = montar(locale);
    act(() => disparador.click());
    expect(disparador.getAttribute("aria-expanded")).toBe("true");
    expect(opciones().map(boton => boton.textContent)).toEqual(["Español", "English"]);
    for (const [indice, boton] of opciones().entries()) {
      const language = indice === 0 ? "es" : "en";
      expect(boton.lang).toBe(language);
      expect(boton.getAttribute("aria-pressed")).toBe(String(language === locale));
      expect(boton.hasAttribute("title")).toBe(false);
      expect(boton.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(language === locale ? 1 : 0);
    }
  });

  it.each(["es", "en"] as const)("elige el otro idioma desde %s y cierra el menú", locale => {
    const { disparador, selectLocale } = montar(locale);
    act(() => disparador.click());
    act(() => opciones()[locale === "es" ? 1 : 0].click());
    expect(selectLocale).toHaveBeenCalledExactlyOnceWith(locale === "es" ? "en" : "es");
    expect(opciones()).toHaveLength(0);
    expect(disparador.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(disparador);
  });

  it("Escape cierra el menú y devuelve el foco al disparador", () => {
    const { disparador } = montar();
    act(() => disparador.click());
    act(() => opciones()[1].focus());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(opciones()).toHaveLength(0);
    expect(disparador.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(disparador);
  });

  it("cierra el menú al pulsar fuera", () => {
    const { disparador } = montar();
    act(() => disparador.click());
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(opciones()).toHaveLength(0);
    expect(disparador.getAttribute("aria-expanded")).toBe("false");
  });
});
