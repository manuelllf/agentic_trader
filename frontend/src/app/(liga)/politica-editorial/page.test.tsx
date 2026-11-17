// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import editorial from "../../../../messages/es/editorial.json";
import editorialEn from "../../../../messages/en/editorial.json";
import help from "../../../../messages/es/help.json";
import legal from "../../../../messages/es/legal.json";

const idioma = vi.hoisted(() => ({ valor: "es" as "es" | "en" }));
const catalogos = vi.hoisted(() => ({ es: {} as Record<string, string>, en: {} as Record<string, string> }));
Object.assign(catalogos.es, { ...editorial, ...help, ...legal });
Object.assign(catalogos.en, { ...editorialEn, ...help, ...legal });

vi.mock("@/lib/sitio", () => ({
  metadataCompartir: (p: object) => p, URL_PUBLICA: "https://vennett.app", FECHA_EDITORIAL: "2026-11-17",
}));
vi.mock("next-intl", async (importOriginal) => ({ ...(await importOriginal<object>()), useLocale: () => idioma.valor }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createTranslator({ locale: idioma.valor, messages: catalogos[idioma.valor] }),
  getLocale: async () => idioma.valor,
}));
vi.mock("../legal/datos", () => ({
  Contacto: () => <a href="mailto:hola@vennett.app">hola@vennett.app</a>,
}));
vi.mock("../_ui/CabeceraPagina", () => ({ CabeceraPagina: ({ titulo }: { titulo: string }) => <header data-testid="cab">{titulo}</header> }));
vi.mock("../_ui/BarraPestanas", () => ({ BarraPestanas: () => <nav data-testid="barra" /> }));
vi.mock("../liga/ranking.css", () => ({}));
vi.mock("../_ui/grupos.css", () => ({}));
vi.mock("../_ui/paginas.css", () => ({}));

import PoliticaEditorial, { generateMetadata } from "./page";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  idioma.valor = "es";
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function pintar() {
  const elemento = await PoliticaEditorial();
  await act(async () => { root.render(elemento); });
}

it("secciones en el orden de la maqueta y cinco tipos de contenido publicado", async () => {
  await pintar();
  expect(container.querySelector("h1")?.textContent).toBe(editorial.editorial_title);
  const secciones = Array.from(container.querySelectorAll("h2.pg-sec")).map((h) => h.textContent);
  expect(secciones).toEqual([
    editorial.editorial_publicamos_titulo, editorial.editorial_como_titulo, editorial.editorial_datos_titulo,
    editorial.editorial_independencia_titulo, editorial.editorial_no_titulo, editorial.editorial_errores_titulo,
  ]);
  expect(container.querySelectorAll(".cu-celda.alta b").length).toBeGreaterThanOrEqual(5);
  expect(container.querySelector('[data-testid="barra"]')).toBeNull();
});

it("dice que la IA es parte central y que una persona lee cada texto", async () => {
  await pintar();
  expect(container.textContent).toContain(editorial.editorial_como_ia);
  expect(container.textContent).toContain(editorial.editorial_como_textos);
});

it("fecha de revisión formateada en el idioma y enlace a Quiénes somos", async () => {
  await pintar();
  expect(container.querySelector(".pg-pie")?.textContent).toBe(editorial.editorial_pie.replace("{fecha}", "17 de noviembre de 2026"));
  expect(container.querySelector('a.cu-celda[href="/quienes-somos"]')).not.toBeNull();
});

it("en inglés, fecha y textos en inglés", async () => {
  idioma.valor = "en";
  await pintar();
  expect(container.querySelector("h1")?.textContent).toBe(editorialEn.editorial_title);
  expect(container.querySelector(".pg-pie")?.textContent).toContain("November 17, 2026");
});

it("JSON-LD con la fecha de modificación y metadatos de la ruta", async () => {
  await pintar();
  const datos = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
  expect(datos["@type"]).toBe("WebPage");
  expect(datos.dateModified).toBe("2026-11-17");
  const meta = await generateMetadata() as unknown as { ruta: string };
  expect(meta.ruta).toBe("/politica-editorial");
});
