// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../messages/es/admin.json";
import comun from "../../../../../messages/es/common.json";
import datos from "../../../../../messages/es/panelDatos.json";
import { get, startPoda, syncFx } from "@/lib/api";
import PantallaDatos from "./PantallaDatos";

const confirmar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  get: vi.fn(), getEstadoDatos: vi.fn(), getUniversoGlobal: vi.fn(), getPodaPrevia: vi.fn(), getFotoStatus: vi.fn(),
  getPodaEstado: vi.fn(), getUniversoGlobalSyncEstado: vi.fn(), startPoda: vi.fn(), syncFx: vi.fn(), startFoto: vi.fn(),
  snapshotUniverse: vi.fn(), syncAnalytics: vi.fn(), syncUniversoGlobal: vi.fn(), subirUniversoGlobalCsv: vi.fn(),
  contarUniversoGlobal: vi.fn(),
  ApiError: class extends Error { constructor(m: string, readonly kind: string, readonly status?: number) { super(m); } },
}));
vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ confirmar, dialogo: null }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | undefined;
let contenedor: HTMLDivElement;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });

const api = await import("@/lib/api");
const horario = { scheduler_activo: true, procesos: [
  { proceso: "foto", automatico: true, dias_semana: "mon-fri", dia_mes: "*", horas: "16,18", minuto: "30", zona: "America/New_York" },
  { proceso: "fx", automatico: true, dias_semana: "*", dia_mes: "*", horas: "5", minuto: "0", zona: "Europe/Madrid" },
] };
const libre = { en_marcha: null, ultima: { analitica: null, poda: null, global: null } };

function simular(estado: unknown = libre) {
  vi.mocked(get).mockImplementation((async (ruta: string) => ruta.endsWith("horario") ? horario : estado) as typeof get);
  vi.mocked(api.getEstadoDatos).mockResolvedValue({ universo: { at: null, elegibles: 3412, a_escanear: 3000 },
    foto_nasdaq: { at: null, n: 0 }, foto_global: { at: null, n: 0 }, fx: { at: null, n: 24 } });
  vi.mocked(api.getUniversoGlobal).mockResolvedValue({ synced_at: null, total: 0, countries: [], exchanges: [] });
  vi.mocked(api.getPodaPrevia).mockResolvedValue({ previa: { reglas: { dias_texto_llm: 90 }, marcas_archivo: {},
    texto_llm: { llamadas: 41000, sin_archivar: 0, mb: 200 }, mb_total: 212 }, estado: {} as never });
}
async function montar() {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => {
    raiz!.render(<NextIntlClientProvider locale="es" messages={{ ...admin, ...comun, ...datos }}><div>{null as ReactNode}<PantallaDatos /></div></NextIntlClientProvider>);
  });
}
const boton = (texto: string) => [...document.querySelectorAll("button")].find(b => b.textContent?.includes(texto)) as HTMLButtonElement | undefined;
const pulsar = async (b: HTMLButtonElement | undefined) => act(async () => { b!.click(); });

beforeEach(() => { confirmar.mockReset(); });

describe("Datos", () => {
  it("lista los seis procesos y su hoja dice cuándo se lanza solo, leído del horario del backend", async () => {
    simular();
    await montar();
    for (const n of ["Foto del universo", "Universo global", "Fundamentales", "Tasas de cambio", "Analítica", "Poda de lo archivado"]) expect(contenedor.textContent).toContain(n);
    await pulsar(boton("Foto del universo"));
    expect(document.body.textContent).toContain("De lunes a viernes a las 16:30 y 18:30 (Nueva York)");
    expect(boton("Lanzar ahora")!.disabled).toBe(false);
  });

  it("con un proceso en marcha enseña el banner con su avance y no deja lanzar otro", async () => {
    simular({ ...libre, en_marcha: { id: "fund", desde: "2026-11-15T10:00:00Z", progreso: { hechas: 500, total: 2000, unidad: "tickers" } } });
    await montar();
    expect(contenedor.textContent).toContain("500 de 2000 tickers");
    expect(contenedor.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("25");
    await pulsar(boton("Tasas de cambio"));
    expect(boton("Hay otro proceso en marcha")!.disabled).toBe(true);
  });

  it("si el backend dice 409 lo cuenta, porque la pantalla no hace de candado", async () => {
    simular();
    const { ApiError } = await import("@/lib/api");
    vi.mocked(syncFx).mockRejectedValue(new ApiError("ocupado", "http", 409));
    await montar();
    await pulsar(boton("Tasas de cambio"));
    await pulsar(boton("Lanzar ahora"));
    await act(async () => {});
    expect(syncFx).toHaveBeenCalledTimes(1);
    expect(contenedor.querySelector(".pd-aviso")?.textContent).toContain("Hay otro proceso en marcha");
  });

  it("la poda no se lanza sin la confirmación", async () => {
    simular();
    vi.mocked(startPoda).mockResolvedValue({} as never);
    confirmar.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await montar();
    await pulsar(boton("Poda de lo archivado"));
    await act(async () => {});
    expect(document.body.textContent).toContain("212");
    await pulsar(boton("Podar"));
    expect(startPoda).not.toHaveBeenCalled();
    await pulsar(boton("Podar"));
    expect(confirmar).toHaveBeenCalledWith(expect.objectContaining({ peligro: true }));
    expect(startPoda).toHaveBeenCalledTimes(1);
  });
});
