// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import mensajes from "../../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
vi.mock("@/lib/api", () => ({ get: vi.fn(), put: vi.fn(), del: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ confirmar: vi.fn().mockResolvedValue(true), dialogo: null }) }));
vi.mock("@/lib/liga/supabase", () => ({ tokenSesion: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let contenedor: HTMLDivElement;
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });
async function montar(children: ReactNode) {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => { raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}>{children}</NextIntlClientProvider>); });
}
import Ajustes from "./page";
const fila = { grupo: "IA", titulo: "Prueba", ayuda: "Ayuda.", tipo: "interruptor", unidad: null, minimo: null, maximo: null, defecto: false, valor: null, efectivo: false, actualizado: null, actualizado_por: null };
it("oculta el margen, agrupa razones y guarda solo los números cambiados", async () => {
  vi.mocked(get).mockImplementation(async ruta => ruta === "/liga/admin/ajustes" ? [
    { ...fila, clave: "ia.margen_objetivo", titulo: "Margen objetivo" },
    { ...fila, clave: "ia.conversor.activo" }, { ...fila, clave: "ia.pregunta.activo" },
    { ...fila, clave: "procesos.formar.limite_preguntas_s", grupo: "Procesos", tipo: "entero", unidad: "s", defecto: 600, efectivo: 600 },
  ] : { gasto_mes_usd: "3.90", tope_mensual_usd: "5", gasto_formacion_usd: "1.24", finalidades: ["conversor", "pregunta"].map(finalidad => ({ finalidad, funciona: false, razon: "Falta ENABLE_LLM en Railway" })) });
  await montar(<Ajustes />);
  expect(contenedor.textContent).not.toContain("Margen objetivo");
  expect([...contenedor.querySelectorAll(".adm-chip")].filter(e => e.textContent === "Falta ENABLE_LLM en Railway")).toHaveLength(1);
  expect([...contenedor.querySelectorAll("button")].some(b => b.textContent === "Guardar")).toBe(false);
  expect(contenedor.textContent).toContain("Descargar copia de la liga");
  const input = contenedor.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "601");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect([...contenedor.querySelectorAll("button")].some(b => b.textContent === "Guardar")).toBe(true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "600");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect([...contenedor.querySelectorAll("button")].some(b => b.textContent === "Guardar")).toBe(false);
});
