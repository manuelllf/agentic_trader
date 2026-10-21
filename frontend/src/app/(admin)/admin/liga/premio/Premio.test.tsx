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
import Premio from "./page";
describe("Premio", () => {
 it.each([true, false])("chip visible=%s y tabla en euros", async visible => {
  vi.mocked(get).mockResolvedValue({ visible, temporada_id: 1, umbral_basico: 50, umbral_completo: 100, temporadas: [{ id: 1, nombre: "2026", estado: "cerrada", calculado: true, elegibles: 80 }], filas: [{ cuenta: "1", alias: "ana", puesto: 1, rentabilidad: "12.4", jornadas_jugadas: 20, importe: "1250", email: "ana@example.com" }] });
  await montar(<Premio />); expect(contenedor.querySelector(".adm-chip")?.textContent).toBe(visible ? "Se ense\u00f1a en la liga" : "No se ense\u00f1a"); expect(contenedor.querySelector(".adm-chip-bien") !== null).toBe(visible); expect(contenedor.querySelector(".adm-tabla")?.textContent).toContain("1250,00\u00a0\u20ac"); expect(contenedor.textContent).toContain("+12,4");
 });
});
