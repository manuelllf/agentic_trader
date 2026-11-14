// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import help from "../../../../messages/es/help.json";
import legal from "../../../../messages/es/legal.json";

const messages = { ...help, ...legal };
const mercado = vi.hoisted(() => ({ valor: null as unknown }));
const cifras = vi.hoisted(() => ({ valor: null as unknown }));

vi.mock("@/lib/aprender", () => ({ leerMercado: async () => mercado.valor, cifrasDelMetodo: () => cifras.valor }));
vi.mock("@/lib/sitio", () => ({ metadataCompartir: () => ({}) }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createTranslator({ locale: "es", messages }),
  getLocale: async () => "es",
}));
vi.mock("../_ui/CabeceraPagina", () => ({ CabeceraPagina: ({ titulo }: { titulo: string }) => <header data-testid="cab">{titulo}</header> }));
vi.mock("../_ui/BarraPestanas", () => ({ BarraPestanas: () => <nav data-testid="barra" /> }));
vi.mock("../liga/ranking.css", () => ({}));
vi.mock("../_ui/grupos.css", () => ({}));
vi.mock("../_ui/paginas.css", () => ({}));

import ComoFunciona from "./page";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function pintar() {
  const elemento = await ComoFunciona();
  await act(async () => { root.render(elemento); });
}

it("con datos: cifras en los pasos y bloques en el orden de la maqueta", async () => {
  mercado.valor = {};
  cifras.valor = { total: "5.738", umbral: 1, pasan: "537" };
  await pintar();
  const q = (s: string) => container.querySelector(s);
  expect(q('[data-testid="cab"]')?.textContent).toBe("Cómo funciona");
  const pasos = Array.from(container.querySelectorAll(".pg-paso"));
  expect(pasos).toHaveLength(5);
  expect(pasos.map((p) => p.querySelector(".n")?.textContent)).toEqual(["1", "2", "3", "4", "5"]);
  expect(pasos[0].querySelector("p")?.textContent).toContain("5.738");
  expect(pasos[0].querySelector("small")?.textContent).toContain("5.738");
  expect(pasos[1].querySelector("small")?.textContent).toContain("537");
  expect(pasos[2].querySelector(".extra")).not.toBeNull();
  expect(pasos[3].querySelector("small")).toBeNull();

  const orden = Array.from(container.querySelectorAll(".pg > h1, .pg > h2, .pg > .cu-boton, .pg > .pg-pie"))
    .map((e) => e.tagName + "." + e.className);
  expect(orden).toEqual(["H1.", "H2.pg-sec", "H2.pg-sec", "H2.pg-sec", "A.cu-boton", "P.pg-pie"]);
  expect(container.querySelectorAll(".cu-cab")).toHaveLength(2);
  expect(container.querySelectorAll(".cu-celda.texto").length).toBe(4 + 4 + 5);
});

it("sin datos: el texto del paso 1 va sin cifra y no hay cifras", async () => {
  mercado.valor = null;
  cifras.valor = null;
  await pintar();
  const pasos = container.querySelectorAll(".pg-paso");
  expect(pasos[0].querySelector("p")?.textContent).toBe(help.help_step_1_text_sin_cifra);
  expect(pasos[0].querySelector("small")).toBeNull();
  expect(pasos[1].querySelector("small")).toBeNull();
  expect(pasos).toHaveLength(5);
});

it("el ejemplo lleva las notas sobre 100 y la nota final", async () => {
  cifras.valor = null;
  await pintar();
  const filas = Array.from(container.querySelectorAll(".cu-celda.alta"));
  expect(filas).toHaveLength(5);
  expect(filas[0].querySelector("b")?.textContent).toBe(help.help_example_company);
  expect(filas.slice(1).map((f) => f.querySelector(".valor.fuerte")?.textContent)).toEqual(["70", "50", "80", "60"]);
  expect(filas[1].querySelector("b")?.textContent).toBe("Fundamentales");
  expect(filas[1].querySelector("small")?.textContent).toBe("peso 30 %");
  const total = Array.from(container.querySelectorAll(".valor.fuerte")).pop();
  expect(total?.textContent).toBe(`64 ${help.help_out_of_100}`);
  expect(container.querySelector(".cu-pie")?.textContent).toContain(help.help_example_disclaimer);
  expect(container.querySelectorAll("li b").length).toBeGreaterThan(5);
});

it("enlaces, pie legal y barra de pestañas", async () => {
  cifras.valor = null;
  await pintar();
  expect(container.querySelector("a.cu-boton")?.getAttribute("href")).toBe("/entrar?next=/crear");
  const filas = Array.from(container.querySelectorAll("a.cu-celda"));
  expect(filas.map((a) => a.getAttribute("href"))).toEqual(["/liga", "/aprender"]);
  expect(filas.every((a) => a.querySelector("svg.chev"))).toBe(true);
  const pie = container.querySelector(".pg-pie")!;
  expect(pie.textContent).toContain(help.help_disclaimer);
  expect(pie.querySelector("a.pg-a")?.getAttribute("href")).toBe("/legal/terminos");
  expect(container.querySelector('[data-testid="barra"]')).not.toBeNull();
});
