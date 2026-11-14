// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import legal from "../../../../messages/es/legal.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => createTranslator({ locale: "es", messages: legal }),
  getLocale: async () => "es",
}));
vi.mock("../_ui/CabeceraPagina", () => ({ CabeceraPagina: ({ titulo }: { titulo: string }) => <header data-testid="cab">{titulo}</header> }));
vi.mock("../_ui/BarraPestanas", () => ({ BarraPestanas: () => <nav data-testid="barra" /> }));
vi.mock("../liga/ranking.css", () => ({}));
vi.mock("../_ui/grupos.css", () => ({}));
vi.mock("../_ui/paginas.css", () => ({}));

import { PlantillaLegal, type DocumentoLegal } from "./PlantillaLegal";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function pintar(actual: DocumentoLegal) {
  const elemento = await PlantillaLegal({
    titulo: "Título largo", tituloCorto: "Corto", actual, resumen: ["Uno", "Dos"],
    children: <p>Cuerpo del documento</p>,
  });
  await act(async () => { root.render(elemento); });
}

it("pinta barra, título, fecha y versión, resumen y cuerpo como hijos directos de .pg-legal", async () => {
  await pintar("cookies");
  const pg = container.querySelector(".pg.pg-legal")!;
  expect(container.querySelector('[data-testid="cab"]')?.textContent).toBe("Corto");
  expect(container.querySelector(".legal-cuerpo")).toBeNull();
  const hijos = Array.from(pg.children).map((e) => e.tagName + (e.className ? "." + e.className : ""));
  expect(hijos).toEqual(["H1", "P.legal-fecha", "SECTION.legal-resumen", "P", "P.cu-cab", "UL.cu-grupo"]);
  expect(pg.querySelector("h1")?.textContent).toBe("Título largo");
  expect(pg.querySelector(".legal-fecha")?.textContent).toMatch(/\S/);
  expect(pg.querySelectorAll(".legal-resumen li")).toHaveLength(2);
  expect(pg.querySelector(".legal-resumen h2")?.textContent).toBe(legal.legal_summary_heading);
  expect(container.querySelector('[data-testid="barra"]')).not.toBeNull();
});

it("lista los otros cuatro documentos, sin el actual y en orden", async () => {
  await pintar("terminos");
  const enlaces = Array.from(container.querySelectorAll<HTMLAnchorElement>("ul.cu-grupo a.cu-celda"));
  expect(enlaces.map((a) => a.getAttribute("href"))).toEqual(["/legal/aviso", "/legal/privacidad", "/legal/cookies", "/legal/bases-premio"]);
  expect(enlaces.map((a) => a.querySelector("span")?.textContent)).toEqual([
    legal.legal_notice_title, legal.legal_privacy_title, legal.legal_cookies_title, legal.legal_bases_title,
  ]);
  expect(enlaces.every((a) => a.querySelector("svg.chev"))).toBe(true);
});

it("sin resumen no pinta la sección", async () => {
  const elemento = await PlantillaLegal({ titulo: "T", tituloCorto: "C", actual: "aviso", children: <p>x</p> });
  await act(async () => { root.render(elemento); });
  expect(container.querySelector(".legal-resumen")).toBeNull();
});
