// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import omega from "../../../../../messages/es/omega.json";
import panel from "../../../../../messages/es/panelOmega.json";
import admin from "../../../../../messages/es/admin.json";
import common from "../../../../../messages/es/common.json";
import * as api from "./api";
import Sala from "./page";

vi.mock("@/lib/api", () => ({ ApiError: class extends Error {}, getFx: vi.fn().mockResolvedValue({ rate: 1.1 }), get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("./api");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

let raiz: Root | undefined;
let contenedor: HTMLDivElement;
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });

const base = { ticker: "ANET", sector: "Tech", tipo: "zigzag", entry_date: "2026-11-10", entry_price: 100, ref_label: "pico_referencia", ref_price: 120,
  caida_pct: 16, resuelta: false, exit_date: null, ret: 5, motivo: null, dias: 3, gate_detalle: "" };

async function pintarSala() {
  vi.mocked(api.getCuenta).mockResolvedValue({ cash: { EUR: "100" }, desplegado_usd: "0", gate_gastado_usd: "0.6", gate_llamadas: 100, pnl_abierto_usd: "0",
    pnl_abierto_pct: "0", pnl_realizado_usd: "0", pnl_realizado_pct: "0", tope_usd: "0", libre_usd: "0" });
  vi.mocked(api.getAlertas).mockResolvedValue([{ ...base, id: 1, estado: "nueva", gate_resultado: null }, { ...base, id: 2, ticker: "CRWD", estado: "ejecutada", gate_resultado: "pasa",
    posicion_abierta: { acciones: 8, coste_medio: 48.2 } }] as never);
  vi.mocked(api.getHistorial).mockResolvedValue([]);
  vi.mocked(api.getValidacion).mockResolvedValue([]);
  vi.mocked(api.getCandidatos).mockResolvedValue([]);
  vi.mocked(api.getRegimen).mockResolvedValue({ cesta_60d: -3.2, umbral: -10, activo: false });
  vi.mocked(api.getPreciosVivos).mockResolvedValue({});
  vi.mocked(api.getGateConfig).mockResolvedValue({ provider: "deepseek" });
  vi.mocked(api.getGateProgreso).mockResolvedValue({ status: "idle", total: 0, hecho: 0, ok: 0, fail: 0, ticker_actual: null, error: null });
  vi.mocked(api.getScanProgreso).mockResolvedValue({ status: "idle", total: 0, hecho: 0, ticker_actual: null, nuevas: 0, resueltas: 0, error: null });
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => {
    raiz!.render(<NextIntlClientProvider locale="es" messages={{ ...omega, ...panel, ...admin, ...common }}><Sala /></NextIntlClientProvider>);
  });
}
const texto = () => contenedor.textContent ?? "";
const celdaDe = (ticker: string) => [...contenedor.querySelectorAll("button")]
  .find((b) => b.textContent?.startsWith(`${ticker}zigzag`) && b.className.includes("pnl-celda"))!;

it("lista las alertas, abre la señal con sus acciones y pide confirmar el gate", async () => {
  await pintarSala();
  expect(texto()).toContain("ANET");
  expect(texto()).toContain("CRWD");
  expect(texto()).toContain("1 señal espera el gate");
  await act(async () => { celdaDe("ANET").click(); });
  const botones = () => [...contenedor.querySelectorAll("button")].map((b) => b.textContent);
  expect(botones()).toEqual(expect.arrayContaining(["Descartar", "Marcar ejecutada"]));
  const gate = [...contenedor.querySelectorAll("button")].find((b) => b.textContent?.includes("una llamada de pago"))!;
  await act(async () => { gate.click(); });
  // Nada se lanza hasta confirmar: la alerta propia sale con el coste medio de cada llamada.
  expect(api.lanzarGate).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("DeepSeek Flash");
  expect(document.body.textContent).toMatch(/0,006\s\$/);
});

it("cada pantalla tiene su dirección y el atrás del navegador vuelve a la raíz", async () => {
  window.history.replaceState(null, "", "/admin/omega");
  await pintarSala();
  await act(async () => { celdaDe("ANET").click(); });
  expect(window.location.search).toBe("?p=senal&id=1");
  expect(texto()).toContain("Marcar ejecutada");
  await act(async () => {
    window.history.back();
    await new Promise((r) => window.addEventListener("popstate", r, { once: true }));
  });
  expect(window.location.search).toBe("");
  expect(texto()).toContain("1 señal espera el gate");
});

it("un PnL de cero no se pinta de verde ni lleva signo", async () => {
  await pintarSala();
  const pnl = [...contenedor.querySelectorAll(".pnl-celda")].find((c) => c.textContent?.startsWith("PnL abierto"))!;
  const cifra = pnl.querySelector("span[class]") ?? pnl.querySelector(".valor span");
  expect(cifra?.className ?? "").not.toContain("po-bien");
  expect(pnl.textContent).not.toContain("+");
});
