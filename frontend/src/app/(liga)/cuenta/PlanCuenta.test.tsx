// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";
import type { Suscripcion } from "@/lib/liga/pagos";

const pagos = vi.hoisted(() => ({
  abrirPago: vi.fn(async () => ({ error: "planes_pago_error" })),
  leerSuscripcion: vi.fn(async (): Promise<Suscripcion | { error: string }> =>
    ({ error: "planes_suscripcion_error" })),
}));
vi.mock("@/lib/liga/pagos", () => pagos);
vi.mock("next-intl", async () => {
  const cuenta = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  const planes = (await import("../../../../messages/es/planes.json")).default as Record<string, string>;
  const es = { ...cuenta, ...planes };
  const t = (key: string, values?: Record<string, string | number>) =>
    (es[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});
import { PlanCuenta } from "./PlanCuenta";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const proMensual: Yo = {
  pendiente: false, alias: "ejemplo", plan: "pro", puede_crear_liga: true, pase_liga: false,
  roles: ["usuario"], admin: false, aal2: false, idioma: null,
  plan_pago: "mensual", plan_pago_hasta: "2026-11-10T12:00:00+00:00",
};
const activa: Suscripcion = {
  estado: "activa", producto: "mensual", renueva_en: proMensual.plan_pago_hasta ?? null,
  termina_en: null, tarjeta_marca: "Visa", tarjeta_ultimos4: "4242",
  portal_url: "https://ejemplo.test/portal", tarjeta_url: "https://ejemplo.test/tarjeta",
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function montar(yo: Yo): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(PlanCuenta, { yo })));
  expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  const botones = [...host.querySelectorAll("button")].map((b) => b.textContent);
  expect(botones).not.toContain("Cancelar suscripción");
  expect(botones).not.toContain("Reanudar suscripción");
  return host;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.resetAllMocks();
  pagos.leerSuscripcion.mockResolvedValue({ error: "planes_suscripcion_error" });
  pagos.abrirPago.mockResolvedValue({ error: "planes_pago_error" });
});

describe("PlanCuenta", () => {
  it("si falla la lectura conserva cabecera y renovación sin bloque Suscripción", async () => {
    const el = await montar(proMensual);
    expect(el.querySelector("h2")?.textContent).toBe("Pro · Mensual");
    expect(el.textContent).toContain("Se renueva el 10 de noviembre.");
    expect(el.querySelector(".cuenta-plan-pago")).toBeNull();
    expect(pagos.leerSuscripcion).toHaveBeenCalledOnce();
  });

  it("mientras carga conserva cabecera y renovación", async () => {
    let resolver!: (res: Suscripcion) => void;
    pagos.leerSuscripcion.mockReturnValueOnce(new Promise((resolve) => { resolver = resolve; }));
    const el = await montar(proMensual);
    expect(el.querySelector("h2")?.textContent).toBe("Pro · Mensual");
    expect(el.textContent).toContain("Se renueva el 10 de noviembre.");
    expect(el.querySelector(".cuenta-plan-pago")).toBeNull();
    await act(async () => { resolver(activa); });
    expect(el.querySelector(".cuenta-plan-pago h3")?.textContent).toBe("Suscripción");
  });

  it("con un Pro que concedió el admin no ofrece cambiar ni pagar otro Pro", async () => {
    const el = await montar({ ...proMensual, plan_pago: null, plan_pago_hasta: null });
    expect(el.textContent).toContain("lo concedió Vennett");
    expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(pagos.leerSuscripcion).not.toHaveBeenCalled();
  });

  it("sin plan enseña las cuatro opciones y compra la que se elige", async () => {
    const el = await montar({ ...proMensual, plan: "gratis", plan_pago: null, plan_pago_hasta: null,
      puede_crear_liga: false });
    expect(el.querySelector("h2")?.textContent).toBe("Gratis");
    const botones = [...el.querySelectorAll<HTMLButtonElement>("button")];
    expect(botones.map((b) => b.textContent)).toEqual(["Elegir", "Elegir", "Elegir", "Elegir"]);
    expect(pagos.leerSuscripcion).not.toHaveBeenCalled();
    expect(el.querySelector(".cuenta-plan-pago")).toBeNull();
    await act(async () => { botones[0].click(); });
    expect(pagos.abrirPago).toHaveBeenCalledWith("mensual");
  });

  it("el pase se puede comprar también con Pro, porque se suma", async () => {
    const el = await montar(proMensual);
    const pase = [...el.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Comprar pase de liga")!;
    await act(async () => { pase.click(); });
    expect(pagos.abrirPago).toHaveBeenCalledWith("pack_liga");
  });

  it.each(["activa", "cancelada", "atrasada"] as const)(
    "carga el estado %s y enlaza al portal", async (estado) => {
      pagos.leerSuscripcion.mockResolvedValueOnce({ ...activa, estado,
        termina_en: estado === "cancelada" ? proMensual.plan_pago_hasta ?? null : null });
      const el = await montar(proMensual);
      expect(pagos.leerSuscripcion).toHaveBeenCalledOnce();
      const enlaces = [...el.querySelectorAll<HTMLAnchorElement>("a")];
      const portal = enlaces.find((a) => a.textContent === "Gestionar suscripción")!;
      expect(portal.href).toBe(activa.portal_url);
      expect(portal.target).toBe("_blank");
      expect(portal.rel).toBe("noopener noreferrer");
      expect(portal.className).toBe("btn pri");
      const tarjeta = enlaces.find((a) => a.textContent === "Actualizar tarjeta");
      if (estado === "atrasada") {
        expect(el.textContent).toContain("No hemos podido cobrar tu suscripción.");
        expect(tarjeta?.href).toBe(activa.tarjeta_url);
        expect(tarjeta?.target).toBe("_blank");
        expect(tarjeta?.rel).toBe("noopener noreferrer");
      } else {
        expect(tarjeta).toBeUndefined();
        expect(el.textContent).toContain(estado === "activa"
          ? "Se renueva el 10 de noviembre."
          : "Cancelada: sigues con Pro hasta el 10 de noviembre.");
      }
    });
});
