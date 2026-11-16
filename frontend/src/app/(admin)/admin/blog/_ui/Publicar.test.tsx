// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import blog from "../../../../../../messages/es/blogAdmin.json";
import panel from "../../../../../../messages/es/panelContenido.json";
import admin from "../../../../../../messages/es/admin.json";
import { leerArticulo, publicarArticulo, programarArticulo, resumenBoletin, type Detalle } from "@/lib/blog/admin";
import Publicar from "./Publicar";
vi.mock("@/lib/blog/admin", () => ({ leerArticulo: vi.fn(), publicarArticulo: vi.fn(), programarArticulo: vi.fn(), resumenBoletin: vi.fn() }));
const mensajes = { ...blog, ...panel, ...admin };
const articulo: Detalle = { id: 7, slug: "mi-articulo", estado: "borrador", programado_para: null,
  publicado_en: null, creado: "2026-01-01", creado_por: null, actualizado_en: null, actualizado_por: null,
  textos: { es: { titulo: "Hola", resumen: "Resumen", cuerpo: "Texto" }, en: { titulo: "Hello", resumen: "Summary", cuerpo: "Body" } } };
let root: Root;
let div: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); div?.remove(); vi.resetAllMocks(); });
async function montar() {
  vi.mocked(leerArticulo).mockResolvedValue(articulo);
  vi.mocked(resumenBoletin).mockResolvedValue({ suscriptores: [{ estado: "confirmado", idioma: "es", total: 3 }], envios: [] });
  div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div);
  await act(async () => root.render(<NextIntlClientProvider locale="es" messages={mensajes}><Publicar id={7} /></NextIntlClientProvider>));
}
const accion = () => div.querySelector(".pc-botones button") as HTMLButtonElement;
const interruptores = () => Array.from(div.querySelectorAll('[role="switch"]')) as HTMLButtonElement[];
async function revisar() { await act(async () => interruptores()[0].click()); }
it("exige la revisión y comienza con Programar y el boletín marcados", async () => {
  await montar(); expect(accion().disabled).toBe(true);
  expect(div.querySelector(".lv-seg [aria-pressed='true']")?.textContent).toBe("Programar");
  expect(interruptores()[1].getAttribute("aria-checked")).toBe("true");
  await revisar(); expect(accion().disabled).toBe(false);
});
it("rechaza una fecha pasada sin enviar ninguna petición de publicación", async () => {
  await montar(); await revisar();
  const campo = div.querySelector("#ba-date") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "2020-01-01");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => accion().click());
  expect(div.querySelector('[role="alert"]')?.textContent).toBe(blog.ba_future_error);
  expect(programarArticulo).not.toHaveBeenCalled(); expect(publicarArticulo).not.toHaveBeenCalled();
});
it("muestra el texto del servidor al publicar ahora", async () => {
  await montar(); await revisar();
  vi.mocked(publicarArticulo).mockRejectedValue(new Error("Falta el cuerpo en inglés."));
  await act(async () => (Array.from(div.querySelectorAll(".lv-seg button")).find(b => b.textContent === "Ahora") as HTMLButtonElement).click());
  await act(async () => accion().click());
  expect(publicarArticulo).toHaveBeenCalledWith(7, true);
  expect(div.querySelector('[role="alert"]')?.textContent).toBe("Falta el cuerpo en inglés.");
});
