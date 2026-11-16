// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import common from "../../../../../../messages/es/common.json";
import panel from "../../../../../../messages/es/panelLiga.json";
import { get, post } from "@/lib/api";
import JornadasAdmin from "./page";

const mensajes = { ...admin, ...common, ...panel };
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), probarResumenLiga: vi.fn(), ApiError: class extends Error {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let vista: HTMLDivElement;
const jornada = { id: 1, numero: 2, dia_inicio: "2026-10-16", dia_fin: "2026-11-16", estado: "formada", inscripciones: 21, siguiente: "cerrar", dias_bolsa: { hechos: 4, total: 22 } };
let j: Record<string, unknown>;
beforeEach(() => {
  j = { ...jornada };
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { if (raiz) act(() => raiz.unmount()); vista?.remove(); vi.resetAllMocks(); });
async function pintar(extra: Record<string, unknown> = {}) {
  vi.mocked(get).mockResolvedValue({ diario_activo: true, temporadas: [{ id: 1, nombre: "Temporada 1", cuenta: true, n_jornadas: 12, jornadas: [j] }], ultimo_intento: { foto: null }, ...extra });
  vista = document.createElement("div"); document.body.append(vista); raiz = createRoot(vista);
  await act(async () => { raiz.render(<NextIntlClientProvider locale="es" messages={mensajes}><JornadasAdmin /></NextIntlClientProvider>); });
}
const boton = (texto: string, dentro: ParentNode = vista) => Array.from(dentro.querySelectorAll("button")).find(b => b.textContent === texto);
const celda = (texto: string) => Array.from(vista.querySelectorAll("button.pnl-celda")).find(b => b.textContent?.includes(texto)) as HTMLButtonElement | undefined;
const hoja = () => vista.querySelector("dialog.hoja-liga")!;
async function abrir(datos: Record<string, unknown>, paso: string) {
  vi.mocked(post).mockResolvedValue(datos); await pintar();
  await act(async () => { celda(paso)!.click(); });
}
describe("Jornadas", () => {
  it("muestra el progreso bursátil y no ofrece descargar copia", async () => {
    await pintar(); expect(vista.textContent).toContain("Jornada 2 de 12"); expect(vista.textContent).toContain("Día 4 de 22");
    expect(vista.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("18");
    expect(Array.from(vista.querySelectorAll("button")).some(b => b.textContent?.includes("Descargar copia"))).toBe(false);
  });
  it("traduce la foto sin mostrar JSON", async () => {
    j = { ...j, estado: "programada", siguiente: "foto", dias_bolsa: null };
    await abrir({ foto_id: 3, scan_run_id: 12, empresas: 42, con_notas: 40, plan_b: false, avisos: [], actual: { foto_id: 1 } }, "Designar la foto");
    const previa = hoja();
    expect(previa.textContent).toContain("Empresas en la foto"); expect(previa.textContent).toContain("42");
    expect(previa.textContent).not.toContain("{"); expect(previa.textContent).not.toContain('"foto_id"');
  });
  it("exige aceptar los cierres faltantes y envía la aceptación", async () => {
    await abrir({ listo: true, filas: [{ nombre: "Ana" }], faltan_cierres: ["ABC"] }, "Cerrar la jornada");
    expect(boton("Ejecutar", hoja())?.disabled).toBe(true);
    await act(async () => { (hoja().querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    expect(boton("Ejecutar", hoja())?.disabled).toBe(false);
    await act(async () => { boton("Ejecutar", hoja())!.click(); });
    expect(post).toHaveBeenLastCalledWith("/liga/admin/procesos/cerrar/ejecutar", { jornada_id: 1, aceptar_sin_cierre: true }, 90000);
    expect(hoja().textContent).toContain("Hecho");
  });
  it("muestra los motivos y desactiva Ejecutar si no está listo", async () => {
    await abrir({ listo: false, motivos: ["Aún no ha terminado la jornada."] }, "Cerrar la jornada");
    expect(hoja().textContent).toContain("Todavía no"); expect(hoja().textContent).toContain("Aún no ha terminado la jornada.");
    expect(boton("Ejecutar", hoja())?.disabled).toBe(true);
  });
  it("lista el último intento de cada proceso y el cierre diario", async () => {
    await pintar({ ultimo_intento: { foto: null, cerrar: { cuando: "2026-11-13T17:42:00Z", ok: false, objeto: null, detalle: null } } });
    expect(vista.textContent).toContain("Cerrar jornada"); expect(vista.textContent).toContain("nunca"); expect(vista.textContent).toContain("falló");
    await act(async () => { (vista.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    expect(post).toHaveBeenLastCalledWith("/liga/admin/procesos/diario/interruptor", { activo: false });
  });
});
