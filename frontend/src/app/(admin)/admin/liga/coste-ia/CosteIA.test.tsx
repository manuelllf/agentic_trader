// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let contenedor: HTMLDivElement;
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });
async function montar(children: ReactNode) {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => { raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}>{children}</NextIntlClientProvider>); });
}
import CosteIA from "./page";
function datos(total = "3.90", cap: string | null = "5.00") { return { mes: "2026-10", total_pagado_usd: total, tope_mensual_usd: cap, por_dia: [], filas: [{ finalidad: "pregunta", llamadas: 12, cache_hits: 2, pagado_usd: total }], desglose: [{ parte: "escaneo", detalle: "deep / deepseek-v4-flash", llamadas: 1, pagado_usd: "1.20" }] }; }
function simular(total?: string, cap?: string | null) { vi.mocked(get).mockImplementation(async ruta => ruta === "/liga/admin/ajustes" ? [{ clave: "panel.aviso_tope_ia_pct", efectivo: 80 }] : datos(total, cap)); }
describe("Coste de IA", () => {
 it("muestra dos decimales y solo gasto", async () => { simular(); await montar(<CosteIA />); expect(contenedor.textContent).toContain("3,90"); expect(contenedor.textContent).toContain("5,00"); expect(contenedor.textContent).toContain("78"); expect(contenedor.textContent).not.toMatch(/Cobrado|bajo objetivo/); expect(contenedor.textContent).toContain("Escaneo \u00b7 deep \u00b7 deepseek-v4-flash"); expect(contenedor.querySelector(".adm-barra-aviso")).toBeNull(); });
 it("avisa al llegar al umbral configurado", async () => { simular("4.00"); await montar(<CosteIA />); expect(contenedor.querySelector(".adm-barra-aviso")).not.toBeNull(); expect(contenedor.querySelector(".adm-chip-aviso")?.textContent).toBe("Pasa del 80 %"); });
 it("muestra sin tope", async () => { simular("1.00", null); await montar(<CosteIA />); expect(contenedor.textContent).toContain("sin tope"); expect(contenedor.querySelector(".adm-barra")).toBeNull(); });
});
