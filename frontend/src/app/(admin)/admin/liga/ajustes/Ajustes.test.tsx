// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import comun from "../../../../../../messages/es/common.json";
import sistema from "../../../../../../messages/es/panelSistema.json";
import { get, put } from "@/lib/api";

const confirmar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ get: vi.fn(), put: vi.fn(), del: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ confirmar, dialogo: null }) }));
vi.mock("@/lib/liga/supabase", () => ({ tokenSesion: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let contenedor: HTMLDivElement;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });
async function montar(children: ReactNode) {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => { raiz!.render(<NextIntlClientProvider locale="es" messages={{ ...admin, ...comun, ...sistema }}>{children}</NextIntlClientProvider>); });
}
import Ajustes from "./page";
const fila = { grupo: "IA", titulo: "Prueba", ayuda: "Ayuda.", tipo: "interruptor", unidad: null, minimo: null, maximo: null, defecto: false, valor: null, efectivo: false, actualizado: null, actualizado_por: null };
const estado = { gasto_mes_usd: "3.90", tope_mensual_usd: "5", gasto_formacion_usd: "1.24", finalidades: ["conversor", "pregunta"].map(finalidad => ({ finalidad, funciona: false, razon: "Falta ENABLE_LLM en Railway" })) };
function simular() {
  vi.mocked(get).mockImplementation(async ruta => ruta === "/liga/admin/ajustes" ? [
    { ...fila, clave: "ia.margen_objetivo", titulo: "Margen objetivo" },
    { ...fila, clave: "ia.conversor.activo" }, { ...fila, clave: "ia.pregunta.activo" },
    { ...fila, clave: "procesos.formar.limite_preguntas_s", grupo: "Procesos", tipo: "entero", unidad: "s", defecto: 600, efectivo: 600 },
  ] : estado);
}
const boton = (texto: string) => [...document.querySelectorAll("button")].find(b => b.textContent?.includes(texto));
const escribir = async (input: HTMLInputElement, texto: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, texto);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("Ajustes", () => {
  it("oculta el margen, agrupa razones y guarda solo el número cambiado desde la hoja", async () => {
    simular(); vi.mocked(put).mockResolvedValue({ ...fila, clave: "procesos.formar.limite_preguntas_s", grupo: "Procesos", tipo: "entero", unidad: "s", defecto: 600, valor: 601, efectivo: 601 });
    await montar(<Ajustes />);
    expect(contenedor.textContent).not.toContain("Margen objetivo");
    expect(contenedor.textContent!.split("Falta ENABLE_LLM en Railway")).toHaveLength(2);
    expect(contenedor.textContent).toContain("Descargar copia de la liga");
    expect(contenedor.querySelector("input")).toBeNull();
    await act(async () => { boton("Tiempo máximo para las preguntas")!.click(); });
    const input = document.querySelector<HTMLInputElement>("dialog input")!;
    expect(boton("Guardar")!.hasAttribute("disabled")).toBe(true);
    await escribir(input, "601");
    expect(boton("Guardar")!.hasAttribute("disabled")).toBe(false);
    await escribir(input, "600");
    expect(boton("Guardar")!.hasAttribute("disabled")).toBe(true);
    await escribir(input, "601");
    await act(async () => { boton("Guardar")!.click(); });
    expect(put).toHaveBeenCalledWith("/liga/admin/ajustes/procesos.formar.limite_preguntas_s", { valor: 601 });
  });

  it("encender una IA pide confirmación y sin ella no guarda", async () => {
    simular(); confirmar.mockResolvedValue(false);
    vi.mocked(put).mockResolvedValue({ ...fila, clave: "ia.conversor.activo", valor: true, efectivo: true });
    await montar(<Ajustes />);
    const interruptor = contenedor.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    await act(async () => { interruptor.click(); });
    expect(confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: "¿Encender esta IA?", aceptar: "Encender" }));
    expect(put).not.toHaveBeenCalled();
    confirmar.mockResolvedValue(true);
    await act(async () => { interruptor.click(); });
    expect(put).toHaveBeenCalledWith("/liga/admin/ajustes/ia.conversor.activo", { valor: true });
  });
});
