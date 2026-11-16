// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import sistema from "../../../../../../messages/es/panelSistema.json";
import { get } from "@/lib/api";
vi.mock("@/lib/api", () => ({ get: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root | undefined;
let contenedor: HTMLDivElement;
afterEach(() => { if (raiz) act(() => raiz!.unmount()); raiz = undefined; contenedor?.remove(); vi.clearAllMocks(); });
async function montar(children: ReactNode) {
  contenedor = document.createElement("div"); document.body.append(contenedor); raiz = createRoot(contenedor);
  await act(async () => { raiz!.render(<NextIntlClientProvider locale="es" messages={{ ...admin, ...sistema }}>{children}</NextIntlClientProvider>); });
}
import Auditoria from "./page";
const entrada = (id: number, accion = "copia.descargar", objeto: string | null = null) => ({ id, accion, objeto, detalle: {}, creada: "2026-10-20T12:00:00Z" });
const boton = (texto: string) => [...contenedor.querySelectorAll("button")].find(b => b.textContent === texto);

describe("Auditoría", () => {
  it("pide acciones sin IA por defecto, presenta frases y cambia a IA", async () => {
    vi.mocked(get).mockResolvedValue({ total: 1, filas: [entrada(1)] });
    await montar(<Auditoria />);
    expect(vi.mocked(get).mock.calls[0][0]).toContain("sin_ia=true");
    expect(contenedor.querySelector("pre")).toBeNull();
    expect(contenedor.textContent).toContain("Copia de la liga descargada");
    await act(async () => { boton("IA")!.click(); });
    expect(vi.mocked(get).mock.calls.at(-1)![0]).toContain("accion_prefix=ia.");
    expect(vi.mocked(get).mock.calls.at(-1)![0]).toContain("sin_ia=false");
  });

  it("aplica el prefijo al enviar el formulario", async () => {
    vi.mocked(get).mockResolvedValue({ total: 1, filas: [entrada(1)] });
    await montar(<Auditoria />);
    const input = contenedor.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " admin. ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { contenedor.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(vi.mocked(get).mock.calls.at(-1)![0]).toContain("accion_prefix=admin.");
  });

  it("muestra el objeto legible y oculta los internos", async () => {
    vi.mocked(get).mockResolvedValue({ total: 3, filas: [entrada(1, "proceso.foto", "jornada:2"), entrada(2, "copia.descargar", "liga"), entrada(3, "copia.descargar", "123e4567-e89b-12d3-a456-426614174000")] });
    await montar(<Auditoria />);
    expect(contenedor.textContent).toContain("Jornada 2");
    expect(contenedor.textContent).not.toContain("jornada:2");
    expect(contenedor.textContent).not.toContain("123e4567");
    expect(contenedor.textContent).toContain("Se ven 3 de 3");
  });

  it.each([[1, false], [50, true]])("«Cargar más» solo si quedan filas: total %s", async (total, hay) => {
    vi.mocked(get).mockResolvedValue({ total, filas: [entrada(1)] });
    await montar(<Auditoria />);
    expect(Boolean(boton("Cargar más") ?? [...contenedor.querySelectorAll("a, button")].find(b => b.textContent === "Cargar más"))).toBe(hay);
  });

  it("«Cargar más» añade la página siguiente sin repetir", async () => {
    vi.mocked(get).mockResolvedValueOnce({ total: 2, filas: [entrada(1)] }).mockResolvedValueOnce({ total: 2, filas: [entrada(2, "cuenta.baja")] });
    await montar(<Auditoria />);
    await act(async () => { boton("Cargar más")!.click(); });
    expect(vi.mocked(get).mock.calls.at(-1)![0]).toContain("desde=1");
    expect(contenedor.textContent).toContain("Cuenta dada de baja");
    expect(contenedor.textContent).toContain("Copia de la liga descargada");
    expect(boton("Cargar más")).toBeUndefined();
  });

  it("sin entradas enseña el estado vacío", async () => {
    vi.mocked(get).mockResolvedValue({ total: 0, filas: [] });
    await montar(<Auditoria />);
    expect(contenedor.textContent).toContain("Sin entradas.");
  });
});
