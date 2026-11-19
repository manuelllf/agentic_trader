// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../messages/es/admin.json";
import comun from "../../../../../messages/es/common.json";
import datos from "../../../../../messages/es/panelDatos.json";
import { get, runDemo, startPoda, syncFx } from "@/lib/api";
import PantallaDatos from "./PantallaDatos";

const confirmar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  get: vi.fn(), getEstadoDatos: vi.fn(), getUniversoGlobal: vi.fn(), getPodaPrevia: vi.fn(), getFotoStatus: vi.fn(),
  getPodaEstado: vi.fn(), getUniversoGlobalSyncEstado: vi.fn(), startPoda: vi.fn(), syncFx: vi.fn(), startFoto: vi.fn(),
  snapshotUniverse: vi.fn(), syncAnalytics: vi.fn(), syncUniversoGlobal: vi.fn(), subirUniversoGlobalCsv: vi.fn(),
  contarUniversoGlobal: vi.fn(), getScanReport: vi.fn(), getDemoStatus: vi.fn(), runDemo: vi.fn(),
  getScanJevMacro: vi.fn(), putScanJevMacro: vi.fn(),
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
  { proceso: "escaneo", automatico: true, dias_semana: "mon-fri", dia_mes: "24-31", horas: "16", minuto: "45", zona: "America/New_York" },
] };
const informe = { at: "2026-10-30T20:45:00Z", mode: "jev", decide: true, error: null, issues: [], scanned: 3011, prescored: 2987,
  deep: 0, cost: { calls: 2987, cost_usd: 1.23 }, jev_cartera: [] };
const libre = { en_marcha: null, ultima: { analitica: null, poda: null, global: null } };

function simular(estado: unknown = libre) {
  vi.mocked(get).mockImplementation((async (ruta: string) => ruta.endsWith("horario") ? horario : estado) as typeof get);
  vi.mocked(api.getEstadoDatos).mockResolvedValue({ universo: { at: null, elegibles: 3412, a_escanear: 3000 },
    foto_nasdaq: { at: null, n: 0 }, foto_global: { at: null, n: 0 }, fx: { at: null, n: 24 } });
  vi.mocked(api.getUniversoGlobal).mockResolvedValue({ synced_at: null, total: 0, countries: [], exchanges: [] });
  vi.mocked(api.getScanReport).mockResolvedValue({ report: informe as never });
  vi.mocked(api.getScanJevMacro).mockResolvedValue({ enabled: true });
  vi.mocked(api.putScanJevMacro).mockImplementation((async (enabled: boolean) => ({ enabled })) as never);
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

  it("el escaneo de Jev va aparte, con lo del último y su horario de último día de bolsa", async () => {
    simular();
    await montar();
    const cab = [...document.querySelectorAll("h2")].map(h => h.textContent);
    expect(cab).toContain("Con coste");
    expect(contenedor.textContent).toContain("Escaneo de Jev");
    expect(contenedor.textContent).toContain("2987 empresas puntuadas");
    await pulsar(boton("Escaneo de Jev"));
    expect(document.body.textContent).toContain("El último día de bolsa del mes, a las 16:45 (Nueva York)");
  });

  it("lanzar el escaneo pide confirmación y manda solo Jev, oficial y sobre NASDAQ por defecto", async () => {
    simular();
    vi.mocked(runDemo).mockResolvedValue({ started: true } as never);
    confirmar.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await montar();
    await pulsar(boton("Escaneo de Jev"));
    await pulsar(boton("Lanzar escaneo"));
    expect(runDemo).not.toHaveBeenCalled();
    await pulsar(boton("Lanzar escaneo"));
    expect(confirmar).toHaveBeenLastCalledWith(expect.objectContaining({ texto: expect.stringContaining("escaneo oficial") }));
    expect(runDemo).toHaveBeenCalledWith({ soloJev: true, decide: true, modoUniverso: "nasdaq", reutilizarUltimaFoto: false });
  });

  it("el universo global solo vale de prueba: elegirlo cambia el modo y volver a oficial vuelve a NASDAQ", async () => {
    simular();
    vi.mocked(runDemo).mockResolvedValue({ started: true } as never);
    confirmar.mockResolvedValue(true);
    await montar();
    await pulsar(boton("Escaneo de Jev"));
    await pulsar(boton("Global por capitalización"));
    expect(boton("Prueba")!.getAttribute("aria-pressed")).toBe("true");
    await pulsar(boton("Lanzar escaneo"));
    expect(runDemo).toHaveBeenLastCalledWith({ soloJev: true, decide: false, modoUniverso: "global_topcap", reutilizarUltimaFoto: false });
    await pulsar(boton("Escaneo de Jev"));
    await pulsar(boton("Global por capitalización"));
    await pulsar(boton("Oficial"));
    const nasdaq = [...document.querySelectorAll(".pnl-segmento button")].find(b => b.textContent === "NASDAQ");
    expect(nasdaq!.getAttribute("aria-pressed")).toBe("true");
  });

  it("el interruptor del macro se guarda en el backend y reutilizar la foto viaja en el lanzamiento", async () => {
    simular();
    vi.mocked(runDemo).mockResolvedValue({ started: true } as never);
    confirmar.mockResolvedValue(true);
    await montar();
    await pulsar(boton("Escaneo de Jev"));
    const interruptores = [...document.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
    expect(interruptores).toHaveLength(2);
    await pulsar(interruptores[1]);                         // macro: de encendido a apagado
    expect(api.putScanJevMacro).toHaveBeenCalledWith(false);
    await pulsar(interruptores[0]);                         // reutilizar la foto
    await pulsar(boton("Lanzar escaneo"));
    expect(runDemo).toHaveBeenLastCalledWith(expect.objectContaining({ reutilizarUltimaFoto: true }));
  });

  it("si ya hay un escaneo en marcha el backend devuelve que no arrancó y se cuenta", async () => {
    simular();
    vi.mocked(runDemo).mockResolvedValue({ started: false } as never);
    confirmar.mockResolvedValue(true);
    await montar();
    await pulsar(boton("Escaneo de Jev"));
    await pulsar(boton("Lanzar escaneo"));
    await act(async () => {});
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
