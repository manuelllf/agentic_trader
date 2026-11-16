// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import personas from "../../../../../../messages/es/panelPersonas.json";
import estrategias from "../../../../../../messages/es/strategies.json";
import { get } from "@/lib/api";
import { getCatalogo } from "@/lib/liga/api";
import ConsultasAdmin from "./page";

vi.mock("@/lib/liga/api", () => ({ getCatalogo: vi.fn() }));
vi.mock("@/lib/api", () => ({ get: vi.fn() }));
vi.mock("@/lib/liga/supabase", () => ({ tokenSesion: vi.fn() }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const proto = HTMLElement.prototype as unknown as { showModal?: () => void; close?: () => void };
proto.showModal ??= function (this: HTMLElement) { this.setAttribute("open", ""); };
proto.close ??= function (this: HTMLElement) { this.removeAttribute("open"); };

let raiz: Root | undefined;
let contenedor: HTMLDivElement;

async function pintar(respuestas: Record<string, unknown>) {
  vi.mocked(getCatalogo).mockResolvedValue({ reglas: [{ clave: "regla_prueba", titulo: "Regla visible" }] } as never);
  vi.mocked(get).mockImplementation(async (url: string) => {
    const r = respuestas[url.split("/").pop()!];
    if (r instanceof Error) throw r;
    return r as never;
  });
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  await act(async () => {
    raiz!.render(<NextIntlClientProvider locale="es" messages={{ ...admin, ...personas, ...estrategias }}><ConsultasAdmin /></NextIntlClientProvider>);
  });
  return contenedor;
}
const abrir = async (vista: HTMLElement, titulo: string) => {
  const b = Array.from(vista.querySelectorAll("button")).find(x => x.textContent?.startsWith(titulo))!;
  await act(async () => b.click());
};

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined;
  contenedor?.remove();
  vi.resetAllMocks();
});

const vacias = {
  sin_estrategia: { clave: "sin_estrategia", columnas: ["alias", "creado", "visitas", "ultima_visita", "borrador"], filas: [["Ana", "2026-01-02", 3, null, true], ["Luis", "2026-01-03", 0, null, false]], umbral_dias: 7 },
  inactivas: { clave: "inactivas", columnas: ["alias"], filas: [], umbral_dias: 14 },
  nunca_apuntadas: { clave: "nunca_apuntadas", columnas: ["nombre", "alias", "estado", "creada"], filas: [["Mi cartera", "ana", "jugando", "2026-01-02"]], umbral_dias: null },
  reglas_usadas: { clave: "reglas_usadas", columnas: ["clave", "estrategias"], filas: [["regla_prueba", 2], ["desconocida", 1]], umbral_dias: null },
};

describe("Consultas", () => {
  it("lista las cuatro consultas con su recuento", async () => {
    const vista = await pintar(vacias);
    expect(get).toHaveBeenCalledWith("/liga/admin/panel/consultas/sin_estrategia");
    const celdas = Array.from(vista.querySelectorAll(".pnl-celda"), c => c.textContent);
    expect(celdas).toHaveLength(4);
    expect(celdas[0]).toContain("7 días o más desde el alta");
    expect(celdas[0]).toContain("2");
  });

  it("abre la hoja con todas las columnas, con nombre y traducidas", async () => {
    const vista = await pintar(vacias);
    await abrir(vista, personas.pnl_personas_cons_sin_estrategia);
    const hoja = vista.querySelector("dialog")!;
    expect(hoja.textContent).toContain("Ana");
    expect(hoja.textContent).toContain("Borrador: sí");
    expect(hoja.textContent).toContain("Última visita: sin dato");
    expect(hoja.textContent).toContain(personas.pnl_personas_cons_csv);
  });

  it("traduce el estado y usa el nombre de la regla del catálogo", async () => {
    const vista = await pintar(vacias);
    await abrir(vista, personas.pnl_personas_cons_nunca_apuntadas);
    expect(vista.querySelector("dialog")!.textContent).toContain(estrategias.strategies_state_playing);
    act(() => vista.querySelector("dialog button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await abrir(vista, personas.pnl_personas_cons_reglas_usadas);
    const texto = vista.querySelector("dialog")!.textContent!;
    expect(texto).toContain("Regla visible");
    expect(texto).toContain("desconocida");
  });

  it("indica el error de una consulta que falla y la reintenta al tocarla", async () => {
    const vista = await pintar({ ...vacias, inactivas: new Error("fallo") });
    const fila = Array.from(vista.querySelectorAll("button")).find(b => b.textContent?.startsWith(personas.pnl_personas_cons_inactivas))!;
    expect(fila.textContent).toContain(admin.admin_generic_error);
    await act(async () => fila.click());
    expect(vi.mocked(get).mock.calls.filter(c => String(c[0]).endsWith("/inactivas"))).toHaveLength(2);
  });
});
