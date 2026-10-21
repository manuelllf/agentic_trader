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
import Revisar from "./page";
const nav = vi.hoisted(() => ({ vista: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.vista), useRouter: () => ({ replace: nav.replace }) }));
async function abrir(vista = "") { nav.vista = vista; vi.mocked(get).mockImplementation(async ruta => ({ total: ruta.includes("reportes") ? 7 : 12, filas: [] })); await montar(<Revisar />); }
describe("Revisar", () => {
 it("abre errores y carga las dos cuentas", async () => { await abrir(); const tabs = contenedor.querySelectorAll('[role="tab"]'); expect(tabs).toHaveLength(3); expect(tabs[0].getAttribute("aria-selected")).toBe("true"); expect(tabs[0].textContent).toBe("Errores12"); expect(tabs[1].textContent).toBe("Reportes7"); });
 it("cambia de segmento conservando vista en URL", async () => { await abrir(); const tabs = contenedor.querySelectorAll('[role="tab"]'); await act(async () => { (tabs[1] as HTMLButtonElement).click(); }); expect(nav.replace).toHaveBeenCalledWith("/admin/liga/revisar?vista=reportes", { scroll: false }); });
 it("acepta y redirige moderacion a reportes", async () => { await abrir("vista=moderacion"); expect(contenedor.querySelectorAll('[role="tab"]')[1].getAttribute("aria-selected")).toBe("true"); expect(nav.replace).toHaveBeenCalledWith("/admin/liga/revisar?vista=reportes", { scroll: false }); });
 it("abre resueltos", async () => { await abrir("vista=resueltos"); expect(get).toHaveBeenCalledWith("/liga/admin/errores?estado=resuelto&cuantos=50"); expect(contenedor.querySelectorAll('[role="tab"]')[2].getAttribute("aria-selected")).toBe("true"); });
});
