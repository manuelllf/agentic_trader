// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import es from "../../../../messages/es/builder.json";
import { PasoRevisar, type PropsRevisar } from "./PasoRevisar";

vi.mock("next-intl", async importOriginal => {
  const original = await importOriginal<typeof import("next-intl")>();
  return { ...original, useLocale: () => "es", useTranslations: () => original.createTranslator({ locale: "es", messages: es }) };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); });
function montar(cambios: Partial<PropsRevisar> = {}) {
  const props: PropsRevisar = { preview: null, nombre: "", cambiarNombre: vi.fn(), ...cambios };
  const div = document.createElement("div"); root = createRoot(div);
  act(() => root.render(<PasoRevisar {...props} />)); return { div, props };
}
it("el embudo cuenta el mercado, los que cumplen y los que entran", () => {
  const { div } = montar({ preview: { evaluadas: 5700, cumplen_reglas: 40, seleccionadas: 5 } as PropsRevisar["preview"] });
  expect(div.querySelectorAll(".cr-embudo li")).toHaveLength(3);
  expect(div.querySelector(".cr-embudo li:last-child")?.classList.contains("final")).toBe(true);
  expect(div.querySelector(".cr-embudo")?.textContent).toContain("5.700");
});
it("el nombre empieza vacio y no hay chips ni sugerencias", () => {
  const { div, props } = montar(); const input = div.querySelector("input")!;
  expect(input.value).toBe(""); expect(input.placeholder).toBe(es.builder_revisar_placeholder);
  expect(input.maxLength).toBe(28);
  expect(div.querySelectorAll("button, .sugg, .chip, .cr-reglas-estilo")).toHaveLength(0);
  act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "Mi estrategia"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(props.cambiarNombre).toHaveBeenCalledWith("Mi estrategia");
});
