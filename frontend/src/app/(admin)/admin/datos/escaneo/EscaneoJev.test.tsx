// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import comun from "../../../../../../messages/es/common.json";
import datos from "../../../../../../messages/es/panelDatos.json";
import EscaneoJev from "./EscaneoJev";

vi.mock("@/lib/api", () => ({
  getScanReport: vi.fn(), getScanOutcomes: vi.fn(), fetchAnalyticsScans: vi.fn(), fetchAnalyticsCosteEtapa: vi.fn(),
  fetchScanAudit: vi.fn(), getScanFull: vi.fn(),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = await import("@/lib/api");
let raiz: Root | undefined;
let contenedor: HTMLDivElement;
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); vi.useRealTimers(); });

const informe = {
  at: "2026-10-30T20:45:00Z", mode: "jev", decide: true, error: null, issues: ["3 nombre(s) sin datos de mercado: AAA, BBB, CCC"],
  scanned: 3011, prescored: 2987, deep: 0, cost: { calls: 2987, cost_usd: 1.23 }, jev_macro: true,
  universe: { fuente: "cierre", at: "2026-10-30T20:30:00Z", dias: 0, size: 3011 },
  jev_cartera: [
    { ticker: "AAA", industry: "Semiconductors", score: 87.5, confidence: 0.82, weight_pct: 20 },
    { ticker: "BBB", industry: "Software", score: 84, confidence: null, weight_pct: 20 },
  ],
};
// Diez pares con la nota subiendo y el retorno subiendo con ella: la nota "predice".
const pares = Array.from({ length: 10 }, (_, i) => ({ score: 50 + i * 5, ret: i - 3, funded: false }));

function simular({ report = informe as unknown, pairs = pares, outcomesFalla = false, analiticaFalla = false } = {}) {
  vi.mocked(api.getScanReport).mockResolvedValue({ report: report as never });
  vi.mocked(api.getScanFull).mockResolvedValue({ scan: {
    at: "2026-10-30T20:45:00Z", cadence: "jev/full", decide: true, regime: "", vix: 15.3, outlook: "",
    macro_calendario: "Oct 1: FOMC", macro_eventos: "Sep 20: evento",
    macro_titulares: [{ fuente: "gnews", texto: "Fed holds rates" }],
  } });
  if (outcomesFalla) vi.mocked(api.getScanOutcomes).mockRejectedValue(new Error("x"));
  else vi.mocked(api.getScanOutcomes).mockResolvedValue({ scans: [{ at: "2026-10-30T20:45:00Z", mode: "decisión", tipo: "jev", days: 20, groups: { cartera: { n: 0, avg: null, median: null }, seleccionados: { n: 0, avg: null, median: null }, descartados: { n: 0, avg: null, median: null }, spy: 1.4 }, pairs, corte: {} as never }], book: null });
  if (analiticaFalla) vi.mocked(api.fetchAnalyticsScans).mockRejectedValue(new Error("503"));
  else {
    vi.mocked(api.fetchAnalyticsScans).mockResolvedValue({ items: [{ id: 7, at: "2026-10-30T20:45:00Z", cadence: "jev/full" }] });
    vi.mocked(api.fetchAnalyticsCosteEtapa).mockResolvedValue({ items: [{ stage: "prescore", llamadas: 2987, usd: 1.2, ms_medios: 900, cache_hit_pct: 71.2, fallos: 3 }] });
  }
}
async function montar() {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => {
    raiz!.render(<NextIntlClientProvider locale="es" messages={{ ...admin, ...comun, ...datos }}><EscaneoJev /></NextIntlClientProvider>);
  });
}

describe("Notas del último escaneo de Jev", () => {
  it("cuenta cómo fue el escaneo y enseña la cartera de Lambda con sus notas", async () => {
    simular();
    await montar();
    const t = contenedor.textContent ?? "";
    expect(t).toContain("Oficial");
    expect(t).toContain("2987 de 3011");
    expect(t).toContain("3011 empresas, foto de hace 0 d");
    expect(t).toContain("Datos, eventos y titulares");
    expect(t).toContain("3 nombre(s) sin datos de mercado");
    expect(t).toContain("Cartera de Lambda");
    expect(t).toContain("Nota 87,5");
    expect(t).toContain("Semiconductors · confianza 82");
    expect(t).toContain("Software · confianza -");           // sin confianza no se inventa
  });

  it("«¿predice la nota?» reparte la muestra en cinco grupos y deja el S&P al lado", async () => {
    simular();
    await montar();
    const filas = [...contenedor.querySelectorAll("li")].map(li => li.textContent ?? "");
    const grupo = (nombre: string) => filas.find(f => f.startsWith(nombre)) ?? "";
    expect(grupo("Notas más altas")).toContain("+5,5");        // retornos 6 y 5: media 5,5
    expect(grupo("Notas más bajas")).toContain("−2,5");        // retornos −3 y −2
    expect(contenedor.querySelectorAll(".pd-bien").length).toBeGreaterThan(0);
    expect(contenedor.querySelectorAll(".pd-mal").length).toBeGreaterThan(0);
    expect(grupo("S&P 500")).toContain("+1,4");
  });

  it("si no hay retorno que comparar lo dice sin inventar nada", async () => {
    simular({ pairs: [] });
    await montar();
    expect(contenedor.textContent).toContain("Aún no hay rentabilidad que comparar");
  });

  it("el coste sale por etapa y, si la analítica no está sincronizada, dice qué hacer", async () => {
    simular();
    await montar();
    expect(api.fetchAnalyticsCosteEtapa).toHaveBeenCalledWith(7);
    expect(contenedor.textContent).toContain("2987 llamadas");
    expect(contenedor.textContent).toContain("caché 71 %");
    expect(contenedor.textContent).toContain("3 fallidas");
    act(() => raiz!.unmount()); contenedor.remove();
    simular({ analiticaFalla: true });
    await montar();
    expect(contenedor.textContent).toContain("Sin sincronizar la analítica");
  });

  it("sin ningún escaneo guardado, estado vacío que explica qué pasa", async () => {
    simular({ report: null });
    await montar();
    expect(contenedor.textContent).toContain("Aún no hay ningún escaneo");
    expect(contenedor.textContent).not.toContain("Cartera de Lambda");
  });

  it("un escaneo reventado enseña su error y no pretende que hubiera notas", async () => {
    simular({ report: { ...informe, error: "Prescore cortado: proveedor caído", jev_cartera: [] } });
    await montar();
    expect(contenedor.textContent).toContain("El escaneo no terminó");
    expect(contenedor.textContent).toContain("Prescore cortado: proveedor caído");
    expect(contenedor.textContent).not.toContain("¿Predice la nota?");
  });

  it("una empresa: busca su historia con retraso y, si no está, lo dice", async () => {
    vi.useFakeTimers();
    simular();
    vi.mocked(api.fetchScanAudit).mockResolvedValueOnce({ ticker: "AAPL", scans: [{ at: "2026-10-30T20:45:00Z", stage: "prescore", prescore: 71, deep_score: null, price: 188.5, weight_pct: null }] })
      .mockResolvedValueOnce({ ticker: "ZZZZ", scans: [] });
    await montar();
    const campo = contenedor.querySelector<HTMLInputElement>('input[type="text"]')!;
    const escribir = async (v: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, v);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(500);
      });
    };
    await escribir("aapl");
    expect(api.fetchScanAudit).toHaveBeenCalledWith("aapl");
    expect(contenedor.textContent).toContain("Nota 71");
    await escribir("zzzz");
    expect(contenedor.textContent).toContain("ZZZZ no aparece en ningún escaneo guardado");
    await escribir("no es un ticker!");
    expect(api.fetchScanAudit).toHaveBeenCalledTimes(2);       // lo que no parece un ticker no se pide
  });
});
