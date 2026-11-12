// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import es from "../../../../messages/es/builder.json";
import en from "../../../../messages/en/builder.json";
import { PasoCartera, type PropsCartera } from "./PasoCartera";

vi.mock("next-intl", async importOriginal => {
  const original = await importOriginal<typeof import("next-intl")>();
  return { ...original, useLocale: () => "es", useTranslations: () => original.createTranslator({ locale: "es", messages: es }) };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.open = false; };
});
let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); });
const metricas = { per: 18.4, margen_operativo: 22.5, crecimiento: -3.2, dividendo_medio: 1.7, beta: 0.85 };
function montar(cambios: Partial<PropsCartera> = {}) {
  const props: PropsCartera = {
    preview: { elegidas: [{ ticker: "AAA", nombre: "Empresa", sector: "Technology", peso: 33.3, porque: "Motivo", nota: 80, mejor: "negocio",
      notas: { negocio: 90, precio: 70, deuda: 60, pronto: 50 } }],
      caja_pct: 66.7, perfil: { cartera: metricas, mercado: { ...metricas, per: 25.6 }, tamanos: { grandes: 1 },
        sectores: [{ sector: "Technology", peso: 33.3, cuota_mercado: 20 }] },
      avisos: [{ codigo: "caja", huecos: 2, pct: 66.7 }, { codigo: "concentracion", sector: "Technology", pct: 70 },
        { codigo: "sin_sector", sector: "Healthcare", cuota: 12 }, { codigo: "pocas", n: 8 }] } as unknown as PropsCartera["preview"],
    nEmpresas: 3, reparto: "igual", maxPorSector: 0, sectores: { Technology: "Tecnología", Healthcare: "Salud" },
    excluidas: [], cambio: null, actualizarB: vi.fn(), cambiar: vi.fn(), recuperar: vi.fn(), leer: vi.fn(), lecturas: [],
    busca: "", buscar: vi.fn(), sugerencias: [], preguntar: vi.fn(), porque: null, cadaDia1: "revisar", cambiarCadaDia1: vi.fn(),
    irReglas: vi.fn(), ...cambios,
  };
  const div = document.createElement("div"); root = createRoot(div);
  act(() => root.render(<PasoCartera {...props} />)); return { div, props };
}
const pulsar = (el: Element | null | undefined) => act(() => (el as HTMLButtonElement).click());
const abierta = (div: HTMLElement) => Array.from(div.querySelectorAll("dialog")).find(d => d.open);

it.each(["es", "en"])("traduce todos los avisos desde su código en %s", idioma => {
  const t = createTranslator({ locale: idioma, messages: idioma === "es" ? es : en });
  for (const codigo of ["caja", "concentracion", "sin_sector", "pocas"] as const) {
    expect(t(`builder_aviso_${codigo}`, { count: "2", percent: "70 %", sector: "Tecnología" })).not.toContain("builder_aviso_");
  }
});
it("cada empresa muestra su baldosa, nombre, nota con lo que destaca y peso", () => {
  const { div } = montar();
  const fila = div.querySelector(".cr-empresa")!;
  expect(fila.querySelector(".cr-tile")?.textContent).toBe("AAA");
  expect(fila.querySelector(".t b")?.textContent).toBe("Empresa");
  expect(fila.querySelector(".t small")?.textContent).toBe("Nota 80 · destaca en negocio");
  expect(fila.querySelector(".valor")?.textContent).toBe("33 %");
});
it("deja la caja como una fila de la lista y no la repite en los avisos", () => {
  const { div } = montar();
  const hueco = div.querySelector(".cartera-hueco")!;
  expect(hueco.textContent).toContain("2 huecos en caja");
  expect(hueco.textContent).toContain("67");
  expect(Array.from(div.querySelectorAll(".aviso-cartera"), e => e.textContent).join(" ")).not.toContain("caja");
});
it("pinta los avisos traducidos con los datos de la vista previa", () => {
  const { div } = montar();
  expect(Array.from(div.querySelectorAll(".aviso-cartera"), e => e.textContent)).toEqual(["70 % de la cartera está en Tecnología.",
    "No hay empresas de Salud, que representa 12 % del mercado.", "Solo 8 empresas cumplen tus reglas."]);
});
it("pinta las cifras frente al mercado y la marca del mercado en cada sector", () => {
  const { div } = montar(); const perfil = div.querySelector(".cartera-perfil")!;
  for (const cifra of ["18,4", "25,6", "22,5 %", "−3,2 %", "1,7 %", "0,85"]) expect(perfil.textContent).toContain(cifra);
  expect((perfil.querySelector(".cr-riel i") as HTMLElement).style.left).toBe("20%");
});
it("la hoja de la empresa enseña el porqué y sus cuatro notas, y «Cambiar por otra» la cambia", () => {
  const { div, props } = montar();
  pulsar(div.querySelector(".cr-empresa"));
  const hoja = abierta(div)!;
  expect(hoja.textContent).toContain("Cumple tus reglas y tiene nota 80 con tus pesos. Destaca en negocio.");
  expect(Array.from(hoja.querySelectorAll(".cr-nota .num"), n => n.textContent)).toEqual(["90", "70", "60", "50"]);
  pulsar(Array.from(hoja.querySelectorAll("button")).find(b => b.textContent === es.builder_cambiar_por_otra));
  expect(props.cambiar).toHaveBeenCalledWith("AAA");
});
it("recupera quitadas y el menú del máximo por sector permite tres", () => {
  const { div, props } = montar({ excluidas: ["BBB"] });
  pulsar(Array.from(div.querySelectorAll("button")).find(e => e.getAttribute("aria-label") === "BBB · recuperar"));
  expect(props.recuperar).toHaveBeenCalledWith("BBB");
  const filas = div.querySelectorAll(".cr-celda.popup button[aria-haspopup='menu']");
  pulsar(filas[2]);
  pulsar(Array.from(div.querySelectorAll(".cr-menu button")).find(b => b.textContent === "3"));
  expect(props.actualizarB).toHaveBeenCalledWith({ max_por_sector: 3 });
  expect(div.querySelector(".cr-menu")).toBeNull();
});
it("con un cambio, la fila dice a quién sustituye; sin lectura a la vista y con las dos opciones de cada mes", () => {
  const { div, props } = montar({ cambio: { entra: "AAA", sale: "BBB" } });
  expect(div.querySelector(".cr-empresa .t small")?.textContent).toBe("Entra en lugar de BBB");
  expect(div.textContent).not.toContain(es.builder_read_deep);
  expect(props.leer).not.toHaveBeenCalled();
  expect(div.querySelectorAll('[role="radio"]')).toHaveLength(2);
});
it("sin cartera no inventa cifras y ofrece volver a las reglas", () => {
  const { div, props } = montar({ preview: null });
  expect(div.querySelector(".cartera-perfil")).toBeNull();
  expect(div.textContent).toContain(es.builder_cartera_ninguna);
  pulsar(div.querySelector(".cr-celda.accion"));
  expect(props.irReglas).toHaveBeenCalledOnce();
});
