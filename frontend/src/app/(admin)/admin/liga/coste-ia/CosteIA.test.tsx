// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import sistema from "../../../../../../messages/es/panelSistema.json";
import { get } from "@/lib/api";
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let contenedor: HTMLDivElement;
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });
async function montar(children: ReactNode) {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => { raiz!.render(<NextIntlClientProvider locale="es" messages={{ ...admin, ...sistema }}>{children}</NextIntlClientProvider>); });
}
import CosteIA from "./page";
const mesPedido = () => new Date().toISOString().slice(0, 7);
function datos(total = "3.90", cap: string | null = "5.00") {
  return { mes: mesPedido(), total_pagado_usd: total, tope_mensual_usd: cap, por_dia: [{ dia: `${mesPedido()}-02`, pagado_usd: total }],
    filas: [{ finalidad: "pregunta", llamadas: 12, cache_hits: 2, pagado_usd: total }],
    desglose: [{ parte: "escaneo", detalle: "deep / deepseek-v4-flash", llamadas: 1, pagado_usd: "1.20" }] };
}
function simular(total?: string, cap?: string | null) {
  vi.mocked(get).mockImplementation(async ruta => ruta === "/liga/admin/ajustes" ? [{ clave: "panel.aviso_tope_ia_pct", efectivo: 80 }] : datos(total, cap));
}
describe("Coste de IA", () => {
  it("muestra el total, el tope, la finalidad y el desglose", async () => {
    simular(); await montar(<CosteIA />);
    const texto = contenedor.textContent!;
    expect(texto).toContain("3,90"); expect(texto).toContain("5,00"); expect(texto).toContain("78");
    expect(texto).toContain("12 llamadas · 2 desde caché");
    expect(texto).toContain("Escaneo · deep · deepseek-v4-flash");
    expect(texto).not.toContain("Pasa del");
    expect(contenedor.querySelector(".pnl-barras svg")).not.toBeNull();
  });
  it("avisa al llegar al umbral configurado", async () => {
    simular("4.00"); await montar(<CosteIA />);
    expect(contenedor.querySelector(".ps-uso.alto")?.textContent).toContain("Pasa del 80 %");
  });
  it("sin tope no hay barra de uso", async () => {
    simular("1.00", null); await montar(<CosteIA />);
    expect(contenedor.textContent).toContain("sin tope"); expect(contenedor.querySelector(".ps-uso")).toBeNull();
  });
  it("cambia de mes con los botones y no pasa del mes actual", async () => {
    simular(); await montar(<CosteIA />);
    const siguiente = contenedor.querySelector<HTMLButtonElement>('button[aria-label="Mes siguiente"]')!;
    expect(siguiente.disabled).toBe(true);
    await act(async () => { contenedor.querySelector<HTMLButtonElement>('button[aria-label="Mes anterior"]')!.click(); });
    const llamadas = vi.mocked(get).mock.calls.map(c => c[0]);
    expect(llamadas.at(-1)).toMatch(/coste-ia\?mes=\d{4}-\d{2}$/);
    expect(llamadas.at(-1)).not.toContain(mesPedido());
    expect(contenedor.querySelector<HTMLButtonElement>('button[aria-label="Mes siguiente"]')!.disabled).toBe(false);
  });
});
