// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";
import type { Suscripcion } from "@/lib/liga/pagos";

const pagos = vi.hoisted(() => ({
  abrirPago: vi.fn(async () => ({ error: "planes_pago_error" })),
  cambiarPlan: vi.fn(async () => ({ ok: true })),
  leerSuscripcion: vi.fn(async (): Promise<Suscripcion | { error: string }> =>
    ({ error: "planes_suscripcion_error" })),
  cancelarSuscripcion: vi.fn(async () => ({ ok: true })),
  reanudarSuscripcion: vi.fn(async () => ({ ok: true })),
  refrescarYo: vi.fn(),
}));
vi.mock("@/lib/liga/pagos", () => pagos);
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ refrescarYo: pagos.refrescarYo }) }));
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

let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function montar(yo: Yo): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(PlanCuenta, { yo })));
  return host;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.clearAllMocks();
});

describe("PlanCuenta", () => {
  it("con Pro mensual enseña el plan, cuándo se renueva y solo las otras duraciones", async () => {
    const el = await montar(proMensual);
    expect(el.querySelector("h2")?.textContent).toBe("Pro · Mensual");
    expect(el.textContent).toContain("Se renueva el 10 de noviembre.");
    const valores = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.value);
    expect(valores).toEqual(["media_temporada", "temporada"]);
  });

  it("no cambia hasta elegir una duración, y entonces lo pide a Lemon", async () => {
    const el = await montar(proMensual);
    const boton = el.querySelector<HTMLButtonElement>("button.btn.pri")!;
    expect(boton.disabled).toBe(true);
    const temporada = el.querySelector<HTMLInputElement>('input[value="temporada"]')!;
    await act(async () => { temporada.click(); });
    expect(boton.disabled).toBe(false);
    expect(boton.textContent).toBe("Cambiar a Temporada");
    await act(async () => { boton.click(); });
    expect(pagos.cambiarPlan).toHaveBeenCalledWith("temporada");
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

  it("carga Lemon y recarga la suscripción y la cuenta al cancelar y reanudar", async () => {
    const activa: Suscripcion = {
      estado: "activa", producto: "mensual", renueva_en: proMensual.plan_pago_hasta ?? null,
      termina_en: null, tarjeta_marca: null, tarjeta_ultimos4: null,
      portal_url: null, tarjeta_url: null,
    };
    pagos.leerSuscripcion.mockResolvedValueOnce(activa)
      .mockResolvedValueOnce({ ...activa, estado: "cancelada",
        termina_en: proMensual.plan_pago_hasta ?? null })
      .mockResolvedValueOnce(activa);
    const el = await montar(proMensual);
    const pulsar = async (texto: string) => {
      const boton = [...el.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent === texto)!;
      await act(async () => { boton.click(); });
    };
    await pulsar("Cancelar suscripción");
    await pulsar("Confirmar cancelación");
    expect(pagos.cancelarSuscripcion).toHaveBeenCalledOnce();
    expect(el.textContent).toContain("Cancelada: sigues con Pro");
    await pulsar("Reanudar suscripción");
    expect(pagos.reanudarSuscripcion).toHaveBeenCalledOnce();
    expect(pagos.leerSuscripcion).toHaveBeenCalledTimes(3);
    expect(pagos.refrescarYo).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain("Se renueva el 10 de noviembre.");
  });
});
