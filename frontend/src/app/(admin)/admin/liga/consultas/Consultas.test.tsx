// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
import ConsultasAdmin from "./page";

vi.mock("@/lib/api", () => ({ get: vi.fn() }));
vi.mock("@/lib/liga/supabase", () => ({ tokenSesion: vi.fn() }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | undefined;
let contenedor: HTMLDivElement;

async function pintar() {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  await act(async () => {
    raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}><ConsultasAdmin /></NextIntlClientProvider>);
  });
  return contenedor;
}

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined;
  contenedor?.remove();
  vi.resetAllMocks();
});

describe("Consultas", () => {
  it("muestra las columnas y filas y marca la consulta inicial", async () => {
    vi.mocked(get).mockResolvedValue({ clave: "sin_estrategia", columnas: ["alias", "activo"], filas: [["Ana", true], ["Luis", false]], umbral_dias: 7 });
    const vista = await pintar();
    expect(get).toHaveBeenCalledWith("/liga/admin/panel/consultas/sin_estrategia");
    expect(Array.from(vista.querySelectorAll("th"), (th) => th.textContent)).toEqual(["alias", "activo"]);
    expect(vista.querySelectorAll("tbody tr").length).toBe(2);
    expect(vista.querySelector("tbody")?.textContent).toContain("sí");
    expect(vista.querySelector("tbody")?.textContent).toContain("no");
    const seleccionado = Array.from(vista.querySelectorAll("button")).find((b) => b.textContent === mensajes.admin_consultas_sin_estrategia);
    expect(seleccionado?.getAttribute("aria-current")).toBe("true");
  });

  it("muestra el error cuando falla la consulta", async () => {
    vi.mocked(get).mockRejectedValue(new Error("fallo"));
    const vista = await pintar();
    expect(vista.querySelector('[role="alert"]')?.textContent).toBe(mensajes.admin_generic_error);
    expect(vista.querySelector("h1")?.textContent).toBe(mensajes.admin_consultas_titulo);
  });
});
