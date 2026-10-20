// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
import { MarcoAdmin } from "./MarcoAdmin";
import { salaDe, seccionDe } from "./secciones";

const estado = vi.hoisted(() => ({ ruta: "/admin/liga" }));
vi.mock("next/navigation", () => ({ usePathname: () => estado.ruta }));
vi.mock("@/lib/api", () => ({ get: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | undefined;
let contenedor: HTMLDivElement;

async function pintar() {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  await act(async () => {
    raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}>
      <MarcoAdmin><div /></MarcoAdmin>
    </NextIntlClientProvider>);
  });
  return contenedor;
}

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined;
  contenedor?.remove();
  estado.ruta = "/admin/liga";
  vi.resetAllMocks();
});

describe("MarcoAdmin", () => {
  it("identifica las secciones y salas por ruta", () => {
    expect(seccionDe("/admin/liga")).toBe("resumen");
    expect(seccionDe("/admin/liga/usuarios/123")).toBe("usuarios");
    expect(seccionDe("/admin/alpha")).toBeNull();
    expect(salaDe("/admin/omega/x")).toBe("omega");
    expect(salaDe("/admin/blog")).toBe("vennett");
  });

  it("marca Jornadas y suma los pendientes por sección", async () => {
    estado.ruta = "/admin/liga/jornadas";
    vi.mocked(get).mockResolvedValue({ pendientes: [
      { seccion: "jornadas", cuantos: 1 },
      { seccion: "revisar", cuantos: 2 },
      { seccion: "revisar", cuantos: 1 },
    ] });
    const vista = await pintar();
    expect(get).toHaveBeenCalledWith("/liga/admin/panel/resumen");
    expect(vista.querySelector(".adm-tabs")).not.toBeNull();
    for (const menu of [".adm-tabs", ".adm-rail .sub"]) {
      const jornadas = vista.querySelector(`${menu} a[href="/admin/liga/jornadas"]`);
      expect(jornadas?.getAttribute("aria-current")).toBe("page");
      expect(jornadas?.querySelector(".cuenta")?.textContent).toBe("1");
      expect(vista.querySelector(`${menu} a[href="/admin/liga/revisar"] .cuenta`)?.textContent).toBe("3");
    }
  });

  it("activa Alpha en el selector móvil sin pestañas de Vennett", async () => {
    estado.ruta = "/admin/alpha";
    vi.mocked(get).mockResolvedValue({ pendientes: [] });
    const vista = await pintar();
    expect(vista.querySelector(".adm-tabs")).toBeNull();
    expect(vista.querySelector('.adm-salas-m a[href="/admin/alpha"]')?.classList.contains("on")).toBe(true);
  });

  it("conserva el marco sin cuentas cuando falla el resumen", async () => {
    vi.mocked(get).mockRejectedValue(new Error("fallo"));
    const vista = await pintar();
    expect(vista.querySelector(".adm")).not.toBeNull();
    expect(vista.querySelector(".cuenta")).toBeNull();
  });
});
