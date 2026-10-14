// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PasoReglas } from "./PasoReglas";
import { getMercado, type Catalogo, type PreviewSeleccion } from "@/lib/liga/api";
vi.mock("@/lib/liga/api", () => ({ getMercado: vi.fn(), convertirFrase: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "es", useTranslations: () => traducir, createTranslator: () => (k: string) => k }));
const traducir = (k: string, v?: Record<string, unknown>) => k + (v ? " " + Object.values(v).join(" ") : "");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const catalogo = { sectores: {}, reglas: [
  { clave: "barata", titulo: "PER bajo", grupo: "precio", parametros: [{ nombre: "per", etiqueta: "PER", tipo: "numero", minimo: 0, maximo: 36, paso: 1, defecto: 18 }] },
  { clave: "caja_neta", titulo: "Más caja", grupo: "deuda", parametros: [] },
  { clave: "oculta", titulo: "Oculta", ofrecida: false, grupo: "precio", parametros: [] },
] } as unknown as Catalogo;
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); vi.clearAllMocks(); });
async function montar() {
  vi.mocked(getMercado).mockResolvedValue({ foto_id: 1, notas_del: null, estilos: {}, n: 100, reglas: { barata: { cobertura: 80, mediana: 18, histograma: Array(36).fill(5), sola: 50 } } } as Awaited<ReturnType<typeof getMercado>>);
  const div = document.createElement("div"), actualizarB = vi.fn(); root = createRoot(div);
  await act(async () => root.render(<PasoReglas catalogo={catalogo} reglas={[{ clave: "barata", params: { per: 18 } }]}
    preview={{ evaluadas: 100, cumplen_reglas: 40, por_regla: [{ clave: "barata", sola: 50, sin_ella: 100, detalle: "PER" }] } as PreviewSeleccion}
    quedan={null} alCambiarQuedan={vi.fn()} alCambiarOcupado={vi.fn()} actualizarB={actualizarB} />));
  return { div, actualizarB };
}
it("filtra por título y grupo y no ofrece reglas ocultas", async () => {
  const { div } = await montar();
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
it("quita una regla", async () => {
  const { div, actualizarB } = await montar();
  act(() => (div.querySelector('.reglas-cabecera button:last-child') as HTMLButtonElement).click());
  expect(actualizarB).toHaveBeenCalledWith({ reglas: [] });
});
it("la i muestra medida, cálculo, impacto y cobertura", async () => {
  const { div } = await montar(); const boton = div.querySelector('[aria-expanded]') as HTMLButtonElement;
  act(() => boton.click()); expect(boton.getAttribute("aria-expanded")).toBe("true");
  expect(div.textContent).toContain("builder_regla_barata_mide");
  expect(div.textContent).toContain("builder_regla_barata_calculo");
  expect(div.textContent).toContain("builder_reglas_impacto 50 100");
  expect(div.textContent).toContain("builder_reglas_cobertura 80");
});
it("marca en el histograma las barras hasta el PER máximo", async () => {
  const { div } = await montar(); expect(div.querySelectorAll("rect.si")).toHaveLength(18);
  expect(div.querySelector(".reglas-total")?.textContent).toBe("builder_reglas_total 10040");
});
it("la regla se lee como frase y su deslizador conserva la etiqueta accesible", async () => {
  const { div } = await montar();
  expect(div.querySelector(".reglas-cabecera output")?.textContent).toBe("builder_regla_maximo 18");
  expect(div.querySelector(".regla-rango")?.getAttribute("aria-label")).toBe("PER");
});
