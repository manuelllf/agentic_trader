// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import es from "../../../../messages/es/builder.json";
import en from "../../../../messages/en/builder.json";
import { PasoCartera, type PropsCartera } from "./PasoCartera";

vi.mock("next-intl", async importOriginal => {
  const original = await importOriginal<typeof import("next-intl")>();
  return { ...original, useLocale: () => "es", useTranslations: () => original.createTranslator({ locale: "es", messages: es }) };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); });
const metricas = { per: 18.4, margen_operativo: 22.5, crecimiento: -3.2, dividendo_medio: 1.7, beta: 0.85 };
function montar(cambios: Partial<PropsCartera> = {}) {
  const props: PropsCartera = {
    preview: { elegidas: [{ ticker: "AAA", nombre: "Empresa", sector: "Technology", peso: 33.3, porque: "Motivo", nota: 80, mejor: "negocio" }],
      caja_pct: 66.7, perfil: { cartera: metricas, mercado: { ...metricas, per: 25.6 }, tamanos: { grandes: 1 },
        sectores: [{ sector: "Technology", peso: 33.3, cuota_mercado: 20 }] },
      avisos: [{ codigo: "caja", huecos: 2, pct: 66.7 }, { codigo: "concentracion", sector: "Technology", pct: 70 },
        { codigo: "sin_sector", sector: "Healthcare", cuota: 12 }, { codigo: "pocas", n: 8 }] } as unknown as PropsCartera["preview"],
    nEmpresas: 3, reparto: "igual", maxPorSector: 0, sectores: { Technology: "Tecnología", Healthcare: "Salud" }, criterios: { negocio: "Negocio" },
    excluidas: [], cambio: null, actualizarB: vi.fn(), cambiar: vi.fn(), recuperar: vi.fn(), leer: vi.fn(), lecturas: [],
    busca: "", buscar: vi.fn(), sugerencias: [], preguntar: vi.fn(), porque: null, cadaDia1: "revisar", cambiarCadaDia1: vi.fn(), ...cambios,
  };
  const div = document.createElement("div"); root = createRoot(div);
  act(() => root.render(<PasoCartera {...props} />)); return { div, props };
}
it.each(["es", "en"])("traduce todos los avisos desde su código en %s", idioma => {
  const t = createTranslator({ locale: idioma, messages: idioma === "es" ? es : en });
  for (const codigo of ["caja", "concentracion", "sin_sector", "pocas"] as const) {
    expect(t(`builder_aviso_${codigo}`, { count: "2", percent: "70 %", sector: "Tecnología" })).not.toContain("builder_aviso_");
  }
});
it("cada empresa muestra ticker y sector, sin datos que no tiene", () => {
  const { div } = montar();
  expect(div.querySelector(".pick > div > span")?.textContent).toBe("AAA · Tecnología");
});
it("deja la caja como una fila de la lista y no la repite en los avisos", () => {
  const { div } = montar();
  const hueco = div.querySelector(".cartera-hueco")!;
  expect(hueco.textContent).toContain("2 huecos en caja");
  expect(hueco.textContent).toContain("66,7");
  expect(Array.from(div.querySelectorAll(".cartera-perfil .callout"), e => e.textContent).join(" ")).not.toContain("caja");
});
it("pinta los avisos traducidos con los datos de la vista previa", () => {
  const { div } = montar();
  const avisos = Array.from(div.querySelectorAll('.cartera-perfil .callout'), e => e.textContent);
  expect(avisos).toEqual(["70,0\u00a0% de la cartera está en Tecnología.",
    "No hay empresas de Salud, que representa 12,0\u00a0% del mercado.", "Solo 8 empresas cumplen tus reglas."]);
});
it("pinta las cifras del perfil y la marca del mercado", () => {
  const { div } = montar(); const tabla = div.querySelector("table")!;
  for (const cifra of ["18,4", "25,6", "22,5\u00a0%", "−3,2\u00a0%", "1,7\u00a0%", "0,85", "1 grandes"]) expect(tabla.textContent).toContain(cifra);
  expect((div.querySelector('.cartera-riel i') as HTMLElement).style.left).toBe("20%");
});
it("Cambiar dispara su acción con el ticker", () => {
  const { div, props } = montar(); act(() => (div.querySelector('.pick-r button') as HTMLButtonElement).click());
  expect(props.cambiar).toHaveBeenCalledWith("AAA");
});
it("recupera quitadas y permite tres empresas por sector", () => {
  const { div, props } = montar({ excluidas: ["BBB"] });
  act(() => Array.from(div.querySelectorAll('button')).find(e => e.textContent === "BBB · recuperar")!.click());
  expect(props.recuperar).toHaveBeenCalledWith("BBB");
  act(() => Array.from(div.querySelectorAll('.seg')).at(-1)!.querySelectorAll('button')[3].click());
  expect(props.actualizarB).toHaveBeenCalledWith({ max_por_sector: 3 });
});
it("sustituye el porqué cuando hay cambio y oculta lectura y conserva radio", () => {
  const { div, props } = montar({ cambio: { entra: "AAA", sale: "BBB" } });
  expect(div.textContent).toContain("BBB");
  expect(div.textContent).not.toContain(es.builder_read_deep);
  expect(props.leer).not.toHaveBeenCalled();
  expect(div.querySelectorAll('[role="radio"]')).toHaveLength(2);
});
it("explica la ausencia de perfil sin inventar cifras", () => {
  const { div } = montar({ preview: null }); expect(div.querySelector('table')).toBeNull();
  expect(div.textContent).toContain(es.builder_cartera_perfil_vacio);
});
