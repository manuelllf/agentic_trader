// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import mensajes from "../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
import { Campana } from "./Campana";
import { Marco } from "./Marco";

const estado = vi.hoisted(() => ({ ruta: "/admin/liga/jornadas" }));
vi.mock("next/navigation", () => ({ usePathname: () => estado.ruta, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | undefined;
let contenedor: HTMLDivElement;

async function pintar(nodo: React.ReactNode) {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  await act(async () => {
    raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}>{nodo}</NextIntlClientProvider>);
  });
  return contenedor;
}

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined;
  contenedor?.remove();
  estado.ruta = "/admin/liga/jornadas";
  vi.resetAllMocks();
});

const RESUMEN = {
  pendientes: [
    { seccion: "jornadas", cuantos: 1, tipo: "proceso_fallido", datos: { proceso: "foto", cuando: "2026-11-13T18:00:00Z" } },
    { seccion: "revisar", cuantos: 2, tipo: "revisar", datos: { errores: 2, reportes: 0, desde: null } },
    { seccion: "revisar", cuantos: 1, tipo: "revisar", datos: { errores: 0, reportes: 1, desde: null } },
  ],
  proximo: null,
  vistazo: { cuentas: 3, activas_7d: 2, en_juego: 1, tope_ia_pct: null },
};

describe("Marco", () => {
  it("marca la sala activa y enseña atrás solo en subrutas de Vennett", async () => {
    vi.mocked(get).mockResolvedValue(RESUMEN);
    const vista = await pintar(<Marco><div>contenido</div></Marco>);
    const activas = vista.querySelectorAll('.pnl-barra .pnl-sala[aria-current="page"]');
    expect(activas).toHaveLength(1);
    expect(activas[0].getAttribute("href")).toBe("/admin");
    const atras = vista.querySelector<HTMLAnchorElement>(".pnl-atras");
    expect(atras?.getAttribute("href")).toBe("/admin");
    expect(vista.querySelector(".pnl-cab-titulo")?.textContent).toBe("Jornadas");
    expect(vista.textContent).toContain("contenido");
  });

  it("no enseña atrás en el inicio ni en otras salas, y marca la sala de la ruta", async () => {
    vi.mocked(get).mockResolvedValue(RESUMEN);
    estado.ruta = "/admin";
    let vista = await pintar(<Marco><div /></Marco>);
    expect(vista.querySelector(".pnl-atras")).toBeNull();
    expect(vista.querySelector(".pnl-cab-titulo")?.textContent).toBe("Vennett");
    act(() => raiz!.unmount());
    vista.remove();

    estado.ruta = "/admin/alpha/diario";
    vista = await pintar(<Marco><div>sala de Alpha</div></Marco>);
    expect(vista.querySelector(".pnl-atras")).toBeNull();
    expect(vista.querySelector('.pnl-barra .pnl-sala[aria-current="page"]')?.getAttribute("href")).toBe("/admin/alpha");
    expect(vista.querySelector(".pnl-secciones")).toBeNull();
    expect(vista.querySelector(".pnl-cab-titulo")?.textContent).toBe("Alpha");
    // Todas las salas llevan el diseño nuevo: no queda ninguna con el aspecto antiguo.
    expect(vista.querySelector(".pnl-viejo, .pnl-vieja")).toBeNull();
    expect(vista.querySelectorAll(".pnl-barra .pnl-sala")).toHaveLength(3);
  });

  it("suma los pendientes por sección en el raíl y marca la sección activa", async () => {
    vi.mocked(get).mockResolvedValue(RESUMEN);
    const vista = await pintar(<Marco><div /></Marco>);
    expect(get).toHaveBeenCalledWith("/liga/admin/panel/resumen");
    const jornadas = vista.querySelector('.pnl-secciones a[href="/admin/liga/jornadas"]');
    expect(jornadas?.getAttribute("aria-current")).toBe("page");
    expect(jornadas?.querySelector(".pnl-cuenta")?.textContent).toBe("1");
    expect(vista.querySelector('.pnl-secciones a[href="/admin/liga/revisar"] .pnl-cuenta')?.textContent).toBe("3");
    expect(vista.querySelector('.pnl-secciones a[href="/admin/datos"]')).not.toBeNull();
    expect(vista.querySelector('.pnl-secciones [aria-disabled="true"]')).not.toBeNull();
  });

  it("conserva el marco sin cuentas cuando falla el resumen", async () => {
    vi.mocked(get).mockRejectedValue(new Error("fallo"));
    const vista = await pintar(<Marco><div /></Marco>);
    expect(vista.querySelector(".pnl-barra")).not.toBeNull();
    expect(vista.querySelector(".pnl-cuenta")).toBeNull();
  });
});

describe("Campana", () => {
  const aviso = (leido: boolean) => ({ id: 1, tipo: "omega_nuevas", sala: "omega", datos: {}, creado: "2026-11-16T10:00:00Z", leido });

  it("muestra el punto solo con avisos sin leer", async () => {
    vi.mocked(get).mockResolvedValue({ sin_leer: 1, avisos: [aviso(false)] });
    let vista = await pintar(<Campana />);
    expect(vista.querySelector(".pnl-campana-punto")).not.toBeNull();
    act(() => raiz!.unmount());
    vista.remove();

    vi.mocked(get).mockResolvedValue({ sin_leer: 0, avisos: [aviso(true)] });
    vista = await pintar(<Campana />);
    expect(vista.querySelector(".pnl-campana-punto")).toBeNull();
  });

  it("sin avisos, la hoja enseña el estado vacío real", async () => {
    vi.mocked(get).mockResolvedValue({ sin_leer: 0, avisos: [] });
    const vista = await pintar(<Campana />);
    expect(vista.querySelector(".pnl-campana-punto")).toBeNull();
    expect(vista.querySelector(".pnl-vacio h2")?.textContent).toBe("Sin avisos");
  });
});
