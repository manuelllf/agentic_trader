// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import panel from "../../../../../../messages/es/panelContenido.json";
import common from "../../../../../../messages/es/common.json";
import { get, post } from "@/lib/api";
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), ApiError: class extends Error {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mensajes = { ...admin, ...panel, ...common };
// jsdom no trae el diálogo modal.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
let raiz: Root | undefined;
let contenedor: HTMLDivElement;
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });
async function montar(children: ReactNode) {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => { raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}>{children}</NextIntlClientProvider>); });
}
import Revisar from "./page";
const nav = vi.hoisted(() => ({ vista: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.vista), useRouter: () => ({ replace: nav.replace }) }));
const error = { id: 5, codigo: "E-1", alias: null, pantalla: "liga", mensaje: "Se rompió", nota: null, contexto: {}, estado: "abierto", creado: "2026-11-10T10:00:00Z" };
async function abrir(vista = "", filas: unknown[] = []) {
  nav.vista = vista;
  vi.mocked(get).mockImplementation(async ruta => ({ total: ruta.includes("reportes") ? 7 : 12, filas: ruta.includes("reportes") ? [] : filas }));
  await montar(<Revisar />);
}
const segmentos = () => Array.from(contenedor.querySelectorAll(".lv-seg button"));
describe("Revisar", () => {
  it("abre errores y carga las dos cuentas", async () => {
    await abrir(); const s = segmentos(); expect(s).toHaveLength(3);
    expect(s[0].getAttribute("aria-pressed")).toBe("true"); expect(s[0].textContent).toBe("Errores (12)"); expect(s[1].textContent).toBe("Reportes (7)");
  });
  it("cambia de segmento conservando vista en URL", async () => {
    await abrir(); await act(async () => { (segmentos()[1] as HTMLButtonElement).click(); });
    expect(nav.replace).toHaveBeenCalledWith("/admin/liga/revisar?vista=reportes", { scroll: false });
  });
  it("acepta y redirige moderacion a reportes", async () => {
    await abrir("vista=moderacion"); expect(segmentos()[1].getAttribute("aria-pressed")).toBe("true");
    expect(nav.replace).toHaveBeenCalledWith("/admin/liga/revisar?vista=reportes", { scroll: false });
  });
  it("abre resueltos", async () => {
    await abrir("vista=resueltos"); expect(get).toHaveBeenCalledWith("/liga/admin/errores?estado=resuelto&cuantos=50");
    expect(segmentos()[2].getAttribute("aria-pressed")).toBe("true");
  });
  it("resuelve un error desde su hoja", async () => {
    await abrir("", [error]); vi.mocked(post).mockResolvedValue({});
    await act(async () => { (Array.from(contenedor.querySelectorAll("button.pnl-celda")).find(b => b.textContent?.includes("Se rompió")) as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(contenedor.querySelectorAll(".pc-botones button")).find(b => b.textContent === "Marcar resuelto") as HTMLButtonElement).click(); });
    expect(post).toHaveBeenCalledWith("/liga/admin/errores/5/resolver");
  });
});
