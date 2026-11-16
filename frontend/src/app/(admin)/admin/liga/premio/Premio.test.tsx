// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import common from "../../../../../../messages/es/common.json";
import panel from "../../../../../../messages/es/panelLiga.json";
import { get } from "@/lib/api";
import Premio from "./page";

const mensajes = { ...admin, ...common, ...panel };
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), ApiError: class extends Error {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let contenedor: HTMLDivElement;
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });
async function montar(children: ReactNode) {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => { raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}>{children}</NextIntlClientProvider>); });
}
const estado = (visible: boolean, extra: Record<string, unknown> = {}) => ({
  visible, temporada_id: 1, umbral_basico: 100, umbral_completo: 250,
  temporadas: [{ id: 1, nombre: "2026", estado: "cerrada", calculado: true, elegibles: 64 }],
  filas: [{ cuenta: "1", alias: "ana", puesto: 1, rentabilidad: "12.4", jornadas_jugadas: 20, importe: "1250", email: "ana@example.com" }], ...extra,
});
describe("Premio", () => {
  it.each([true, false])("visible=%s, escalones y reparto en euros", async visible => {
    vi.mocked(get).mockResolvedValue(estado(visible));
    await montar(<Premio />);
    expect(contenedor.textContent).toContain(visible ? "Se enseña en la liga" : "No se enseña");
    expect(contenedor.textContent).toContain("64 / 100");
    expect(contenedor.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
    expect(contenedor.textContent).toContain("1.250,00"); expect(contenedor.textContent).toContain("+12,4");
    expect(contenedor.textContent).toContain("ana@example.com");
  });
  it("ofrece calcular cuando la temporada cerró sin reparto", async () => {
    vi.mocked(get).mockResolvedValue(estado(false, { temporadas: [{ id: 1, nombre: "2026", estado: "cerrada", calculado: false, elegibles: 64 }], filas: [] }));
    await montar(<Premio />);
    expect(contenedor.textContent).toContain("Todavía no hay reparto calculado");
    expect(contenedor.querySelector("button.pnl-celda.accion")?.textContent).toContain("Calcular");
  });
});
