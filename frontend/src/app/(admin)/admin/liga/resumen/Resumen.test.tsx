// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
import ResumenAdmin from "../page";
import { destinoDe, nombreProceso, type Pendiente } from "./logica";
import type { ResumenAdminOut } from "./Resumen";

vi.mock("@/lib/api", () => ({ get: vi.fn() }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | undefined;
let contenedor: HTMLDivElement | undefined;
const pendientes: Pendiente[] = [
  { tipo: "proceso_fallido", seccion: "jornadas", cuantos: 1, datos: { proceso: "foto", cuando: "2026-01-01T10:00:00Z" } },
  { tipo: "revisar", seccion: "revisar", cuantos: 12, datos: { errores: 7, reportes: 5, desde: null } },
  { tipo: "premio", seccion: "premio", cuantos: 1, datos: { temporada: "Invierno" } },
  { tipo: "tope_ia", seccion: "coste", cuantos: 1, datos: { usado_pct: 85, aviso_pct: 80 } },
  { tipo: "altas_sin_estrategia", seccion: "consultas", cuantos: 4, datos: { dias: 3 } },
];
const respuesta = (filas: Pendiente[]): ResumenAdminOut => ({
  pendientes: filas, proximo: null,
  vistazo: { cuentas: 20, activas_7d: 8, en_juego: 3, tope_ia_pct: null },
});

async function pintar() {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  await act(async () => {
    raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}><ResumenAdmin /></NextIntlClientProvider>);
  });
  return contenedor;
}

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined;
  contenedor?.remove();
  vi.resetAllMocks();
});

describe("Resumen", () => {
  it.each([[0, "Nada pendiente"], [1, "Una cosa para hoy"], [3, "3 cosas para hoy"]] as const)("cuenta %i filas pendientes", async (cuantos, titulo) => {
    vi.mocked(get).mockResolvedValue(respuesta(pendientes.slice(0, cuantos)));
    const vista = await pintar();
    expect(vista.querySelector("h1")?.textContent).toBe(titulo);
    expect(get).toHaveBeenCalledWith("/liga/admin/panel/resumen");
    if (cuantos === 0) expect(vista.querySelector("ul")).toBeNull();
  });
  it("enlaza cada pendiente con su sección", async () => {
    vi.mocked(get).mockResolvedValue(respuesta(pendientes));
    const vista = await pintar();
    const enlaces = vista.querySelectorAll("li a");
    expect(enlaces.length).toBe(pendientes.length);
    pendientes.forEach((p, i) => expect(enlaces[i].getAttribute("href")).toBe(destinoDe(p.seccion)));
    expect(destinoDe("desconocida")).toBe("/admin/liga");
    expect(nombreProceso("desconocido")).toBe("desconocido");
  });
  it("omite Lo próximo cuando no hay siguiente paso", async () => {
    vi.mocked(get).mockResolvedValue(respuesta([]));
    expect((await pintar()).textContent).not.toContain("Lo próximo");
  });
  it("muestra el error cuando falla la petición", async () => {
    vi.mocked(get).mockRejectedValue(new Error("fallo"));
    const vista = await pintar();
    expect(vista.querySelector('[role="alert"]')?.textContent).toBe(mensajes.admin_generic_error);
    expect(vista.querySelector("h1")).toBeNull();
  });
});
