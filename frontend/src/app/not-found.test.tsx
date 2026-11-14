// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import system from "../../messages/es/system.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => createTranslator({ locale: "es", messages: system }),
}));
vi.mock("./(liga)/liga/ranking.css", () => ({}));
vi.mock("./(liga)/_ui/grupos.css", () => ({}));
vi.mock("./(liga)/_ui/paginas.css", () => ({}));

import NoEncontrada from "./not-found";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

it("pinta el vacío con título, texto y enlace a la portada, sin barra de pestañas", async () => {
  const elemento = await NoEncontrada();
  await act(async () => { root.render(elemento); });
  expect(container.querySelector(".pg-vacio h1")?.textContent).toBe(system.system_no_encontrada);
  expect(container.querySelector(".pg-vacio p")?.textContent).toBe(system.system_direccion_no_existe);
  expect(container.querySelector(".pg-vacio svg.ico")).not.toBeNull();
  const volver = container.querySelector<HTMLAnchorElement>(".acciones a.cu-boton");
  expect(volver?.getAttribute("href")).toBe("/");
  expect(volver?.textContent).toBe(system.system_volver_portada);
  expect(container.querySelector('a.pg-sello[aria-label="Vennett"]')?.getAttribute("href")).toBe("/");
  expect(container.querySelector("nav")).toBeNull();
  expect(container.textContent).not.toContain("404");
});
