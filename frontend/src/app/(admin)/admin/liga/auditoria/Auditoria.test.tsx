// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import mensajes from "../../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
vi.mock("@/lib/api", () => ({ get: vi.fn(), put: vi.fn(), del: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ confirmar: vi.fn().mockResolvedValue(true), dialogo: null }) }));
vi.mock("@/lib/liga/supabase", () => ({ tokenSesion: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let contenedor: HTMLDivElement;
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });
async function montar(children: ReactNode) {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => { raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}>{children}</NextIntlClientProvider>); });
}
import Auditoria from "./page";
it("pide acciones sin IA por defecto y presenta frases sin pre", async () => {
  vi.mocked(get).mockResolvedValue({ total: 1, filas: [{ id: 1, accion: "copia.descargar", objeto: null, detalle: {}, creada: "2026-10-20T12:00:00Z" }] });
  await montar(<Auditoria />);
  expect(vi.mocked(get).mock.calls[0][0]).toContain("sin_ia=true");
  expect(contenedor.querySelector("pre")).toBeNull();
  expect(contenedor.textContent).toContain("Copia de la liga descargada");
  await act(async () => { [...contenedor.querySelectorAll("button")].find(b => b.textContent === "IA")!.click(); });
  expect(vi.mocked(get).mock.calls.at(-1)![0]).toContain("accion_prefix=ia.");
});

it.each([0, 9, 50, 51])("muestra controles solo con varias p?ginas: %s", async total => {
 vi.mocked(get).mockResolvedValue({ total, filas: [{ id: 1, accion: "proceso.foto", objeto: "jornada:2", detalle: {}, creada: "2026-10-20T12:00:00Z" }] });
 await montar(<Auditoria />);
 expect(contenedor.textContent).toContain("Jornada 2");
 expect(contenedor.textContent).not.toContain("jornada:2");
 for (const texto of ["Anterior", "Siguiente"]) expect([...contenedor.querySelectorAll("button")].some(b => b.textContent === texto)).toBe(total > 50);
 expect(contenedor.querySelector(".adm-audit-paginacion .adm-nota")).not.toBeNull();
});
it.each(["liga", "123e4567-e89b-12d3-a456-426614174000"])("oculta objeto %s", async objeto => {
 vi.mocked(get).mockResolvedValue({ total: 1, filas: [{ id: 1, accion: "copia.descargar", objeto, detalle: {}, creada: "2026-10-20T12:00:00Z" }] });
 await montar(<Auditoria />);
 expect(contenedor.querySelector(".adm-fila p.adm-nota")).toBeNull();
});
