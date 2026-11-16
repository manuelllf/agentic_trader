// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import blog from "../../../../../../messages/es/blogAdmin.json";
import panel from "../../../../../../messages/es/panelContenido.json";
import admin from "../../../../../../messages/es/admin.json";
import { listarArticulos, resumenBoletin } from "@/lib/blog/admin";
import Lista from "./Lista";
vi.mock("@/lib/blog/admin", () => ({ listarArticulos: vi.fn(), resumenBoletin: vi.fn(), enviarPruebaBoletin: vi.fn() }));
let root: Root;
let div: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); div?.remove(); vi.resetAllMocks(); });
async function montar() {
  div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div);
  await act(async () => root.render(<NextIntlClientProvider locale="es" messages={{ ...blog, ...panel, ...admin }}><Lista /></NextIntlClientProvider>));
}
it("muestra un solo enlace para crear el artículo cuando no hay ninguno", async () => {
  vi.mocked(listarArticulos).mockResolvedValue([]);
  vi.mocked(resumenBoletin).mockResolvedValue({ suscriptores: [], envios: [] });
  await montar();
  expect(div.querySelectorAll('a[href="/admin/blog/nuevo"]')).toHaveLength(1);
});
it("filtra por estado y enseña el estado y los idiomas de cada fila", async () => {
  vi.mocked(listarArticulos).mockResolvedValue([
    { id: 1, slug: "a", estado: "borrador", programado_para: null, publicado_en: null, titulo_es: "Uno", titulo_en: "One", completo_es: true, completo_en: false },
    { id: 2, slug: "b", estado: "publicado", programado_para: null, publicado_en: "2026-11-10T09:00:00Z", titulo_es: "Dos", titulo_en: "Two", completo_es: true, completo_en: true }]);
  vi.mocked(resumenBoletin).mockResolvedValue({ suscriptores: [{ estado: "confirmado", idioma: "es", total: 4 }], envios: [] });
  await montar();
  expect(div.querySelectorAll('a[href^="/admin/blog/1"], a[href="/admin/blog/2"]')).toHaveLength(2);
  expect(div.textContent).toContain("EN falta");
  await act(async () => (Array.from(div.querySelectorAll(".pnl-chip")).find(b => b.textContent?.startsWith("Publicados")) as HTMLButtonElement).click());
  expect(div.querySelector('a[href="/admin/blog/1"]')).toBeNull();
  expect(div.querySelector('a[href="/admin/blog/2"]')).not.toBeNull();
});
