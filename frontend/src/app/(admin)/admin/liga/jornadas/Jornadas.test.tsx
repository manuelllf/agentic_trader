// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../../../messages/es/admin.json";
import { get, post } from "@/lib/api";
import JornadasAdmin from "./page";

vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), probarResumenLiga: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let vista: HTMLDivElement;
const jornada = { id: 1, numero: 2, dia_inicio: "2026-10-16", dia_fin: "2026-11-16", estado: "formada", inscripciones: 21, siguiente: "cerrar", dias_bolsa: { hechos: 4, total: 22 } };
let j: Record<string, unknown>;
beforeEach(() => { j = { ...jornada }; });
afterEach(() => { if (raiz) act(() => raiz.unmount()); vista?.remove(); vi.resetAllMocks(); });
async function pintar() {
  vi.mocked(get).mockResolvedValue({ diario_activo: true, temporadas: [{ id: 1, nombre: "Temporada 1", cuenta: true, jornadas: [j] }], ultimo_intento: { foto: null } });
  vista = document.createElement("div"); document.body.append(vista); raiz = createRoot(vista);
  await act(async () => { raiz.render(<NextIntlClientProvider locale="es" messages={mensajes}><JornadasAdmin /></NextIntlClientProvider>); });
}
function boton(texto: string) { return Array.from(vista.querySelectorAll("button")).find(b => b.textContent === texto); }
async function abrir(datos: Record<string, unknown>, paso: string) {
  vi.mocked(post).mockResolvedValue(datos); await pintar();
  await act(async () => { boton(paso)!.click(); });
}
describe("Jornadas", () => {
  it("muestra el progreso bursátil y no ofrece descargar copia", async () => {
    await pintar(); expect(vista.textContent).toContain("Día 4 de 22");
    expect(Array.from(vista.querySelectorAll("button")).some(b => b.textContent?.includes("Descargar copia"))).toBe(false);
  });
  it("traduce la foto sin mostrar JSON", async () => {
    j = { ...j, estado: "programada", siguiente: "foto", dias_bolsa: null };
    await abrir({ foto_id: 3, scan_run_id: 12, empresas: 42, con_notas: 40, plan_b: false, avisos: [], actual: { foto_id: 1 } }, "Designar la foto…");
    const previa = vista.querySelector(".adm-previa")!;
    expect(previa.textContent).toContain("Empresas en la foto"); expect(previa.textContent).toContain("42");
    expect(previa.textContent).not.toContain("{"); expect(previa.textContent).not.toContain('"foto_id"');
  });
  it("exige aceptar los cierres faltantes y envía la aceptación", async () => {
    await abrir({ listo: true, filas: [{ nombre: "Ana" }], faltan_cierres: ["ABC"] }, "Cerrar la jornada…");
    expect(boton("Ejecutar")?.disabled).toBe(true);
    await act(async () => { (vista.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    expect(boton("Ejecutar")?.disabled).toBe(false);
    await act(async () => { boton("Ejecutar")!.click(); });
    expect(post).toHaveBeenLastCalledWith("/liga/admin/procesos/cerrar/ejecutar", { jornada_id: 1, aceptar_sin_cierre: true }, 90000);
    expect(vista.querySelector(".adm-previa")?.textContent).toContain("Hecho");
  });
  it("muestra los motivos y oculta Ejecutar si no está listo", async () => {
    await abrir({ listo: false, motivos: ["Aún no ha terminado la jornada."] }, "Cerrar la jornada…");
    expect(vista.textContent).toContain("Todavía no"); expect(vista.textContent).toContain("Aún no ha terminado la jornada."); expect(boton("Ejecutar")).toBeUndefined();
  });
});
