// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";
import type { Suscripcion } from "@/lib/liga/pagos";

vi.mock("@/lib/liga/pagos", () => ({
  abrirPago: vi.fn(async () => ({ error: "planes_pago_error" })),
  cambiarPlan: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next-intl", async () => {
  const es = (await import("../../../../messages/es/planes.json")).default as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (es[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});
import { PlanCuentaVista } from "./PlanCuentaVista";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const yo: Yo = {
  pendiente: false, alias: "ejemplo", plan: "pro", puede_crear_liga: true, pase_liga: true,
  roles: ["usuario"], admin: false, aal2: false, idioma: null,
  plan_pago: "mensual", plan_pago_hasta: "2026-11-10T12:00:00Z",
};
const activa: Suscripcion = {
  estado: "activa", producto: "mensual", renueva_en: yo.plan_pago_hasta ?? null,
  termina_en: null, tarjeta_marca: "Visa", tarjeta_ultimos4: "4242",
  portal_url: "https://ejemplo.test/portal", tarjeta_url: "https://ejemplo.test/tarjeta",
};
const cancelar = vi.fn(async (): Promise<{ ok: true } | { error: string }> => ({ ok: true }));
const reanudar = vi.fn(async (): Promise<{ ok: true } | { error: string }> => ({ ok: true }));
let root: Root | undefined;
let host: HTMLDivElement | undefined;

function montar(suscripcion: Suscripcion | null): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(PlanCuentaVista, { yo, suscripcion, cancelar, reanudar })));
  return host;
}

function boton(el: HTMLDivElement, texto: string): HTMLButtonElement {
  return [...el.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => b.textContent === texto)!;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.clearAllMocks();
});

describe("PlanCuentaVista", () => {
  it("activa muestra renovación, radios, tarjeta y enlaces protegidos", () => {
    const el = montar(activa);
    expect(el.textContent).toContain("Se renueva el 10 de noviembre.");
    expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(el.textContent).toContain("Visa · últimos cuatro dígitos: 4242");
    const enlaces = [...el.querySelectorAll<HTMLAnchorElement>("a")];
    expect(enlaces.map((a) => a.href)).toEqual([activa.portal_url, activa.tarjeta_url]);
    for (const enlace of enlaces) {
      expect(enlace.target).toBe("_blank");
      expect(enlace.rel).toBe("noopener noreferrer");
    }
  });

  it("cancelar requiere confirmación y permite mantener", async () => {
    const el = montar(activa);
    await act(async () => { boton(el, "Cancelar suscripción").click(); });
    expect(el.textContent).toContain("Se cancela hoy y sigues con Pro hasta el 10 de noviembre. No hay devolución.");
    expect(cancelar).not.toHaveBeenCalled();
    await act(async () => { boton(el, "Mantener").click(); });
    expect(boton(el, "Confirmar cancelación")).toBeUndefined();
    await act(async () => { boton(el, "Cancelar suscripción").click(); });
    await act(async () => { boton(el, "Confirmar cancelación").click(); });
    expect(cancelar).toHaveBeenCalledOnce();
  });

  it("cancelada conserva pase y pago y permite reanudar", async () => {
    const el = montar({ ...activa, estado: "cancelada", renueva_en: null,
      termina_en: "2026-11-12T12:00:00Z" });
    expect(el.textContent).toContain("Cancelada: sigues con Pro hasta el 12 de noviembre.");
    expect(el.textContent).not.toContain("Se renueva");
    expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(el.textContent).toContain("Tienes un pase activo.");
    expect(el.querySelector(".cuenta-plan-pago")).not.toBeNull();
    await act(async () => { boton(el, "Reanudar suscripción").click(); });
    expect(reanudar).toHaveBeenCalledOnce();
  });

  it.each(["atrasada", "impagada", "pausada", "caducada"] as const)(
    "%s pide actualizar la tarjeta sin cambios de plan ni fecha", (estado) => {
      const el = montar({ ...activa, estado });
      expect(el.textContent).toContain("No hemos podido cobrar tu suscripción.");
      expect(el.textContent).not.toContain("10 de noviembre");
      expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(0);
      expect(el.querySelector<HTMLAnchorElement>("a.btn.pri")?.href).toBe(activa.tarjeta_url);
      expect(boton(el, "Cancelar suscripción")).toBeUndefined();
    });

  it("sin datos conserva la sección anterior sin bloque Pago", () => {
    const el = montar(null);
    expect(el.textContent).toContain("Se renueva el 10 de noviembre.");
    expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(el.querySelector(".cuenta-plan-pago")).toBeNull();
  });

  it("sin tarjeta ni urls omite esos detalles", () => {
    const el = montar({ ...activa, tarjeta_marca: null, tarjeta_ultimos4: null,
      portal_url: null, tarjeta_url: null });
    expect(el.querySelectorAll("a")).toHaveLength(0);
    expect(el.textContent).not.toContain("últimos cuatro");
  });

  it("muestra un error al reanudar", async () => {
    reanudar.mockResolvedValueOnce({ error: "planes_reanudar_no_disponible" });
    const el = montar({ ...activa, estado: "cancelada" });
    await act(async () => { boton(el, "Reanudar suscripción").click(); });
    expect(el.querySelector('[role="alert"]')?.textContent)
      .toBe("Esta suscripción ya no se puede reanudar.");
  });
});
