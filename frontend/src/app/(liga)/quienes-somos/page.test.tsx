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
  metadataCompartir: (p: object) => p, AUTOR_PUBLICO: "Manuel", URL_PUBLICA: "https://vennett.app",
  PERFILES_PUBLICOS: ["https://x.com/maanufr_", "https://www.linkedin.com/in/manuel-llao-freire-a10b69278"],
}));
vi.mock("next-intl", async (importOriginal) => ({ ...(await importOriginal<object>()), useLocale: () => idioma.valor }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createTranslator({ locale: idioma.valor, messages: catalogos[idioma.valor] }),
  getLocale: async () => idioma.valor,
}));
vi.mock("../legal/datos", () => ({
  TITULAR: { nombre: "Manuel Llao Freire" },
  Contacto: () => <a href="mailto:hola@vennett.app">hola@vennett.app</a>,
}));
vi.mock("../_ui/CabeceraPagina", () => ({ CabeceraPagina: ({ titulo }: { titulo: string }) => <header data-testid="cab">{titulo}</header> }));
vi.mock("../_ui/BarraPestanas", () => ({ BarraPestanas: () => <nav data-testid="barra" /> }));
vi.mock("../liga/ranking.css", () => ({}));
vi.mock("../_ui/grupos.css", () => ({}));
vi.mock("../_ui/paginas.css", () => ({}));

import QuienesSomos, { generateMetadata } from "./page";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  idioma.valor = "es";
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function pintar() {
  const elemento = await QuienesSomos();
  await act(async () => { root.render(elemento); });
}

it("estructura: título, secciones en orden y barra de pestañas", async () => {
  await pintar();
  expect(container.querySelector('[data-testid="cab"]')?.textContent).toBe(editorial.about_title);
  expect(container.querySelector("h1")?.textContent).toBe(editorial.about_title);
  const secciones = Array.from(container.querySelectorAll("h2.pg-sec")).map((h) => h.textContent);
  expect(secciones).toEqual([
    editorial.about_quien_titulo, editorial.about_hacemos_titulo, editorial.about_ia_titulo,
    editorial.about_porque_titulo, editorial.about_pago_titulo, editorial.about_escribenos_titulo,
  ]);
  expect(container.querySelector('[data-testid="barra"]')).not.toBeNull();
});

it("la IA se presenta como el corazón del producto y enlaza a Cómo funciona", async () => {
  await pintar();
  expect(container.textContent).toContain(editorial.about_ia);
  const hrefs = Array.from(container.querySelectorAll("a.cu-celda")).map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual(["/legal/aviso", "/liga", "/criptico", "/blog", "/como-funciona", "/politica-editorial"]);
});

it("en inglés los enlaces públicos llevan /en y el texto sale del catálogo inglés", async () => {
  idioma.valor = "en";
  await pintar();
  expect(container.querySelector("h1")?.textContent).toBe(editorialEn.about_title);
  const hrefs = Array.from(container.querySelectorAll("a.cu-celda")).map((a) => a.getAttribute("href"));
  expect(hrefs).toContain("/en/criptico");
  expect(hrefs).toContain("/en/blog");
});

it("JSON-LD de AboutPage con el fundador por su nombre público", async () => {
  await pintar();
  const datos = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
  expect(datos["@type"]).toBe("AboutPage");
  expect(datos.about.founder).toEqual({ "@type": "Person", name: "Manuel", sameAs: datos.about.sameAs });
  expect(datos.url).toBe("https://vennett.app/quienes-somos");
  expect(datos.about.sameAs).toEqual(["https://x.com/maanufr_", "https://www.linkedin.com/in/manuel-llao-freire-a10b69278"]);
  expect(datos.about.founder.sameAs).toEqual(datos.about.sameAs);
});

it("metadatos: ruta traducible y descripción propia", async () => {
  const meta = await generateMetadata() as unknown as { ruta: string; idioma: string; titulo: string };
  expect(meta.ruta).toBe("/quienes-somos");
  expect(meta.titulo).toBe(`${editorial.about_title} · Vennett`);
});
