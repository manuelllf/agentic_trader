// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./selector-idioma.css", () => ({}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: (p: Record<string, unknown>) => React.createElement("a", p) };
});
import { SelectorIdioma } from "./SelectorIdioma";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function montar(props: Parameters<typeof SelectorIdioma>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => { createRoot(host).render(createElement(SelectorIdioma, props)); });
  return host;
}

describe("SelectorIdioma", () => {
  it("con enlaces: EN a la izquierda y el activo marcado", () => {
    const host = montar({ actual: "es", etiqueta: "Idioma", enlaces: { es: "/blog", en: "/en/blog" } });
    const enlaces = [...host.querySelectorAll("a")];
    expect(enlaces.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")]))
      .toEqual([["EN", "/en/blog", null], ["ES", "/blog", "true"]]);
    expect(host.querySelector(".selector-idioma")!.getAttribute("aria-label")).toBe("Idioma");
  });

  it("con botones: avisa solo al elegir otro idioma", () => {
    const onElegir = vi.fn();
    const host = montar({ actual: "es", etiqueta: "Idioma", onElegir });
    const [en, es] = [...host.querySelectorAll("button")];
    expect([en.getAttribute("aria-pressed"), es.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
    act(() => { es.click(); });
    expect(onElegir).not.toHaveBeenCalled();
    act(() => { en.click(); });
    expect(onElegir).toHaveBeenCalledWith("en");
  });
});
