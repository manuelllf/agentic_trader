// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import mensajes from "../../../../../../messages/es/blogAdmin.json";
import { crearArticulo, guardarArticulo, leerArticulo, type Detalle } from "@/lib/blog/admin";
import Editor from "./Editor";
vi.mock("@/lib/blog/admin", () => ({ crearArticulo: vi.fn(), guardarArticulo: vi.fn(), leerArticulo: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
const articulo: Detalle = { id: 7, slug: "mi-articulo", estado: "borrador", programado_para: null,
  publicado_en: null, creado: "2026-01-01", creado_por: null, actualizado_en: null, actualizado_por: null,
  textos: { es: { titulo: "Hola", resumen: "", cuerpo: "" }, en: { titulo: "Hello", resumen: "Summary", cuerpo: "Body" } } };
let root: Root;
let div: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); div?.remove(); vi.clearAllMocks(); });
async function montar(nuevo = false) {
  vi.mocked(leerArticulo).mockResolvedValue(articulo);
  vi.mocked(guardarArticulo).mockResolvedValue(articulo);
  div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div);
  await act(async () => root.render(<NextIntlClientProvider locale="es" messages={mensajes}>
    <Editor id={nuevo ? undefined : 7} /></NextIntlClientProvider>));
}
async function escribir(selector: string, texto: string) {
  const campo = div.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  const prototipo = campo.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pulsar(texto: string) {
  const boton = Array.from(div.querySelectorAll("button")).find(b => b.textContent?.includes(texto))!;
  await act(async () => boton.click());
}
it("marca español como falta si el borrador no tiene cuerpo", async () => {
  await montar(); expect(div.querySelector('[role="tab"]')?.textContent).toContain("falta");
});
it("conserva cambios entre pestañas y guarda el idioma editado", async () => {
  await montar(); await escribir("#ba-titulo", "Título editado");
  expect(div.textContent).toContain("Hay cambios sin guardar");
  await pulsar("English");
  expect((div.querySelector("#ba-titulo") as HTMLInputElement).value).toBe("Hello");
  await pulsar("Guardar");
  expect(guardarArticulo).toHaveBeenCalledWith(7, { es: { ...articulo.textos.es, titulo: "Título editado" }, en: articulo.textos.en });
});
it("limita el resumen a 160 caracteres y actualiza el contador", async () => {
  await montar(); await escribir("#ba-resumen", "a".repeat(161));
  const campo = div.querySelector("#ba-resumen") as HTMLTextAreaElement;
  expect(campo.maxLength).toBe(160); expect(campo.value).toHaveLength(160);
  expect(div.textContent).toContain("160 / 160");
});
it("rechaza mayúsculas en el slug sin crear ni guardar", async () => {
  await montar(true); await escribir("#ba-slug", "Mayusculas"); await pulsar("Guardar");
  expect(div.querySelector("#ba-slug-error")?.textContent).toBe(mensajes.ba_slug_error);
  expect(crearArticulo).not.toHaveBeenCalled(); expect(guardarArticulo).not.toHaveBeenCalled();
});
