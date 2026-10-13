// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Catalogo } from "@/lib/liga/api";
import { PasoCriterios } from "./PasoCriterios";
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "es",
  createTranslator: () => (k: string) => k }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const equilibrado = { negocio: 25, precio: 25, deuda: 25, pronto: 25, pregunta: 0 };
const negocio = { negocio: 35, precio: 15, deuda: 30, pronto: 20, pregunta: 0 };
const catalogo = { presets: { equilibrado, negocio }, pesos: {
  claves: Object.keys(equilibrado), etiquetas: { pregunta: "Pregunta" }, maximo: 50, paso: 5,
} } as unknown as Catalogo;
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); });
function montar(pesos = equilibrado, pregunta = "") {
  const div = document.createElement("div"), actualizarB = vi.fn(); root = createRoot(div);
  act(() => root.render(<PasoCriterios catalogo={catalogo} pesos={pesos} pregunta={pregunta} pro={false} actualizarB={actualizarB} />));
  return { div, actualizarB };
}
it("pone la pregunta antes que los pesos y limita el texto", () => {
  const { div } = montar(); const textarea = div.querySelector("textarea")!;
  expect(textarea.compareDocumentPosition(div.querySelector('input')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(textarea.maxLength).toBe(160);
});
it("detecta el preset y aplica los pesos del catálogo", () => {
  const { div, actualizarB } = montar(negocio);
  expect(div.querySelector('[aria-pressed="true"]')?.textContent).toBe("builder_preset_negocio");
  act(() => (div.querySelector('.seg button') as HTMLButtonElement).click());
  expect(actualizarB).toHaveBeenCalledWith({ pesos: equilibrado });
});
it("deja todos sin pulsar si no coinciden", () => {
  const { div } = montar({ ...equilibrado, pronto: 30 });
  expect(div.querySelector('[aria-pressed="true"]')).toBeNull();
});
it.each(["", "   ", "Pregunta"])("suma cien con pregunta %s", pregunta => {
  const { div } = montar({ negocio: 15, precio: 20, deuda: 25, pronto: 10, pregunta: 20 }, pregunta);
  expect(Array.from(div.querySelectorAll('.wrow .num'), e => parseInt(e.textContent!)).reduce((a, b) => a + b, 0)).toBe(100);
  expect(div.querySelectorAll('input')).toHaveLength(pregunta.trim() ? 5 : 4);
  div.querySelectorAll('input').forEach(e => { expect(e.min).toBe("0"); expect(e.max).toBe("50"); expect(e.step).toBe("5"); });
});
it("mantiene el peso de pregunta coherente al aplicar preset", () => {
  const { div, actualizarB } = montar({ ...equilibrado, pregunta: 20 }, "Pregunta");
  act(() => (div.querySelector('.seg button') as HTMLButtonElement).click());
  expect(actualizarB).toHaveBeenCalledWith({ pesos: { ...equilibrado, pregunta: 20 } });
});
