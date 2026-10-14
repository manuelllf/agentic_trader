// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import es from "../../../../messages/es/builder.json";
import en from "../../../../messages/en/builder.json";
import { PasoRevisar, type PropsRevisar } from "./PasoRevisar";

vi.mock("next-intl", async importOriginal => {
  const original = await importOriginal<typeof import("next-intl")>();
  return { ...original, useLocale: () => "es", useTranslations: () => original.createTranslator({ locale: "es", messages: es }) };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); });
function montar(cambios: Partial<PropsRevisar> = {}) {
  const props: PropsRevisar = { preview: null, pesos: { negocio: 25, precio: 25, deuda: 25, pronto: 25 },
    nEmpresas: 5, reparto: "igual", maxPorSector: 0, nombre: "", cambiarNombre: vi.fn(), ...cambios };
  const div = document.createElement("div"); root = createRoot(div);
  act(() => root.render(<PasoRevisar {...props} />)); return { div, props };
}
it("sin reglas mira todo el mercado", () => {
  const { div } = montar(); expect(div.textContent).toContain("Mira todo el mercado.");
});
it("pone el tamano primero y une dos reglas con coma e y", () => {
  const { div } = montar({ preview: { evaluadas: 5700, cumplen_reglas: 40, seleccionadas: 5,
    por_regla: [{ clave: "dividendo", detalle: "con dividendo" }, { clave: "tamano", detalle: "grandes" },
      { clave: "deuda", detalle: "con poca deuda" }] } as PropsRevisar["preview"] });
  expect(div.textContent).toContain("Busca empresas grandes, con dividendo y con poca deuda.");
  expect(div.querySelectorAll(".embudo li")).toHaveLength(3);
  expect(div.querySelector(".embudo li:last-child")?.classList.contains("final")).toBe(true);
  expect(div.querySelector(".embudo")?.textContent).toContain("5.700");
});
it("el nombre empieza vacio y no hay chips ni sugerencias", () => {
  const { div, props } = montar(); const input = div.querySelector("input")!;
  expect(input.value).toBe(""); expect(input.placeholder).toBe(es.builder_revisar_placeholder);
  expect(input.maxLength).toBe(28);
  expect(div.querySelectorAll("button, .sugg, .chip")).toHaveLength(0);
  act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "Mi estrategia"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(props.cambiarNombre).toHaveBeenCalledWith("Mi estrategia");
});
it("describe preferencia, reparto por nota y tope por sector", () => {
  const { div } = montar({ pesos: { pronto: 50, negocio: 20, precio: 20, deuda: 10 }, reparto: "nota", maxPorSector: 2 });
  expect(div.textContent).toContain(es.builder_revisar_preferencia_pronto);
  expect(div.textContent).toContain("Invierte en 5 empresas seg\u00fan su nota, como mucho 2 por sector.");
});
it.each(["es", "en"])("las uniones ICU funcionan en %s", idioma => {
  const t = createTranslator({ locale: idioma, messages: idioma === "es" ? es : en });
  expect(t("builder_revisar_union", { left: "A", right: "B", last: "no" })).toBe("A, B");
  expect(t("builder_revisar_union", { left: "A, B", right: "C", last: "yes" })).toBe(idioma === "es" ? "A, B y C" : "A, B and C");
});
