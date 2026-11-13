// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { PasoReglas } from "./PasoReglas";
import { type Catalogo, type Mercado, type PreviewSeleccion } from "@/lib/liga/api";
vi.mock("@/lib/liga/api", () => ({ convertirFrase: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "es", useTranslations: () => traducir, createTranslator: () => (k: string) => k }));
const traducir = Object.assign((k: string, v?: Record<string, unknown>) => k + (v ? " " + Object.values(v).join(" ") : ""),
  { rich: (k: string, v?: Record<string, unknown>) => k + (v ? " " + Object.values(v).filter(x => typeof x !== "function").join(" ") : "") });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.open = false; };
});
const catalogo = { sectores: {}, reglas: [
  { clave: "barata", titulo: "PER bajo", grupo: "precio", parametros: [{ nombre: "per", etiqueta: "PER", tipo: "numero", minimo: "8", maximo: "36", paso: "1", defecto: 18 }] },
  { clave: "caja_neta", titulo: "Más caja", grupo: "deuda", parametros: [] },
  { clave: "oculta", titulo: "Oculta", ofrecida: false, grupo: "precio", parametros: [] },
] } as unknown as Catalogo;
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); vi.clearAllMocks(); });
async function montar() {
  const mercado = { foto_id: 1, notas_del: null, estilos: {}, n: 100, reglas: { barata: { cobertura: 80, mediana: 18, histograma: Array(36).fill(5), sola: 50 } } } as Mercado;
  const div = document.createElement("div"), actualizarB = vi.fn(); root = createRoot(div);
  await act(async () => root.render(<PasoReglas catalogo={catalogo} mercado={mercado} reglas={[{ clave: "barata", params: { per: 22 } }]}
    preview={{ evaluadas: 100, cumplen_reglas: 40, por_regla: [{ clave: "barata", sola: 50, sin_ella: 100, detalle: "PER" }] } as PreviewSeleccion}
    quedan={null} alCambiarQuedan={vi.fn()} alCambiarOcupado={vi.fn()} actualizarB={actualizarB} />));
  return { div, actualizarB };
}
const pulsar = (el: Element | null | undefined) => act(() => (el as HTMLButtonElement).click());
const abierta = (div: HTMLElement) => Array.from(div.querySelectorAll("dialog")).find(d => d.open)!;

it("añadir regla filtra por título y grupo y no ofrece reglas ocultas", async () => {
  const { div } = await montar();
  pulsar(div.querySelector(".cr-celda.accion"));
  const input = div.querySelector("#reglas-busca") as HTMLInputElement;
  const escribir = (v: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(div.querySelectorAll(".reglas-anadir")).toHaveLength(1);
  escribir("deuda"); expect(div.querySelectorAll(".reglas-anadir")).toHaveLength(1);
  escribir("caja"); expect(div.querySelectorAll(".reglas-anadir")).toHaveLength(1);
  escribir("inexistente"); expect(div.querySelectorAll(".reglas-anadir")).toHaveLength(0);
});
it("añadir una regla la pone con sus valores por defecto y abre su hoja", async () => {
  const { div, actualizarB } = await montar();
  pulsar(div.querySelector(".cr-celda.accion"));
  pulsar(div.querySelector(".reglas-anadir"));
  expect(actualizarB).toHaveBeenCalledWith({ reglas: [{ clave: "barata", params: { per: 22 } }, { clave: "caja_neta", params: {} }] });
});
it("la hoja de la regla la quita con «Quitar regla»", async () => {
  const { div, actualizarB } = await montar();
  pulsar(div.querySelector(".cr-celda.regla"));
  pulsar(abierta(div).querySelector(".cr-celda.peligro"));
  expect(actualizarB).toHaveBeenCalledWith({ reglas: [] });
});
it("la hoja enseña medida, cálculo, impacto y cobertura", async () => {
  const { div } = await montar();
  pulsar(div.querySelector(".cr-celda.regla"));
  const hoja = abierta(div);
  expect(hoja.textContent).toContain("builder_regla_barata_mide");
  expect(hoja.textContent).toContain("builder_regla_barata_calculo");
  expect(hoja.textContent).toContain("builder_reglas_impacto 50 100");
  expect(hoja.textContent).toContain("builder_reglas_cobertura 80");
});
it("el histograma marca las barras hasta el PER máximo y la cabecera dice cuántas cumplen", async () => {
  const { div } = await montar();
  expect(div.querySelector(".reglas-total")?.textContent).toBe("builder_reglas_cumplen 40 100");
  pulsar(div.querySelector(".cr-celda.regla"));
  // PER 22 entre 8 y 36: la mitad de las 36 barras.
  expect(abierta(div).querySelectorAll("rect.si")).toHaveLength(18);
});
it("la regla se lee como frase y su deslizador conserva la etiqueta accesible y los límites numéricos", async () => {
  const { div } = await montar();
  expect(div.querySelector(".cr-celda.regla .valor")?.textContent).toBe("builder_regla_maximo 22");
  pulsar(div.querySelector(".cr-celda.regla"));
  const rango = abierta(div).querySelector(".cr-rango") as HTMLInputElement;
  expect(rango.getAttribute("aria-label")).toBe("PER");
  expect([rango.min, rango.max, rango.value]).toEqual(["8", "36", "22"]);
  expect(rango.style.getPropertyValue("--p")).toBe("50%");
});
