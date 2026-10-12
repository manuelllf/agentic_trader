// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";
import type { Suscripcion } from "@/lib/liga/pagos";

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
let root: Root | undefined;
let host: HTMLDivElement | undefined;

function montar(suscripcion: Suscripcion | null, cuenta: Yo = yo): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(PlanCuentaVista, { yo: cuenta, suscripcion })));
  expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  expect([...host.querySelectorAll("button")].map((b) => b.textContent))
    .not.toContain("Cancelar suscripción");
  expect([...host.querySelectorAll("button")].map((b) => b.textContent))
    .not.toContain("Reanudar suscripción");
  return host;
}

function enlace(el: HTMLDivElement, texto: string): HTMLAnchorElement | undefined {
  return [...el.querySelectorAll<HTMLAnchorElement>("a")]
    .find((a) => a.textContent === texto);
}

function comprobarPortal(el: HTMLDivElement) {
  const portal = enlace(el, "Gestionar suscripción")!;
  expect(portal.href).toBe(activa.portal_url);
  expect(portal.target).toBe("_blank");
  expect(portal.rel).toBe("noopener noreferrer");
  expect(portal.className).toBe("btn pri");
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.clearAllMocks();
});

describe("PlanCuentaVista", () => {
  it("activa muestra renovación, tarjeta y portal", () => {
    const el = montar(activa);
    expect(el.textContent).toContain("Se renueva el 10 de noviembre.");
    expect(el.querySelector("h2")?.textContent).toBe("Pro · Mensual");
    expect(el.textContent).toContain("Puedes crear dos ligas con Pro.");
    expect(el.textContent).toContain("Visa · últimos cuatro dígitos: 4242");
    expect(el.querySelector(".cuenta-plan-pago h3")?.textContent).toBe("Suscripción");
    expect(el.textContent).toContain("se gestionan en Lemon, nuestro proveedor de pagos.");
    comprobarPortal(el);
    expect(enlace(el, "Actualizar tarjeta")).toBeUndefined();
  });

  it("cancelada conserva el pase y remite al portal para continuar", () => {
    const el = montar({ ...activa, estado: "cancelada", renueva_en: null,
      termina_en: "2026-11-12T12:00:00Z" });
    expect(el.textContent).toContain("Cancelada: sigues con Pro hasta el 12 de noviembre.");
    expect(el.textContent).not.toContain("Se renueva");
    expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(el.textContent).toContain("Tienes un pase activo.");
    expect(el.querySelector(".cuenta-plan-pago")).not.toBeNull();
    expect(el.textContent).toContain("Si quieres seguir, reanúdala desde «Gestionar suscripción».");
    comprobarPortal(el);
    expect(enlace(el, "Actualizar tarjeta")).toBeUndefined();
  });

  it.each(["atrasada", "impagada", "pausada", "caducada"] as const)(
    "%s pide actualizar la tarjeta sin cambios de plan ni fecha", (estado) => {
      const el = montar({ ...activa, estado });
      expect(el.textContent).toContain("No hemos podido cobrar tu suscripción.");
      expect(el.textContent).not.toContain("10 de noviembre");
      expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(0);
      const tarjeta = enlace(el, "Actualizar tarjeta")!;
      expect(tarjeta.href).toBe(activa.tarjeta_url);
      expect(tarjeta.target).toBe("_blank");
      expect(tarjeta.rel).toBe("noopener noreferrer");
      expect(tarjeta.className).toBe("btn pri");
      comprobarPortal(el);
      expect(el.querySelectorAll("a")).toHaveLength(2);
    });

  it("sin datos conserva cabecera y renovación sin bloque Suscripción", () => {
    const el = montar(null);
    expect(el.textContent).toContain("Se renueva el 10 de noviembre.");
    expect(el.querySelector("h2")?.textContent).toBe("Pro · Mensual");
    expect(el.querySelector(".cuenta-plan-pago")).toBeNull();
  });

  it("sin tarjeta ni urls omite esos detalles", () => {
    const el = montar({ ...activa, tarjeta_marca: null, tarjeta_ultimos4: null,
      portal_url: null, tarjeta_url: null });
    expect(el.querySelectorAll("a")).toHaveLength(0);
    expect(el.textContent).not.toContain("últimos cuatro");
  });

  it("atrasada sin URL de tarjeta conserva el aviso y el portal", () => {
    const el = montar({ ...activa, estado: "atrasada", tarjeta_url: null });
    expect(el.querySelector('[role="status"]')?.textContent)
      .toContain("No hemos podido cobrar tu suscripción.");
    expect(enlace(el, "Actualizar tarjeta")).toBeUndefined();
    comprobarPortal(el);
  });

  it("sin plan conserva las cuatro opciones de compra", () => {
    const el = montar(null, { ...yo, plan: "gratis", plan_pago: null,
      plan_pago_hasta: null, puede_crear_liga: false, pase_liga: false });
    expect(el.querySelector("h2")?.textContent).toBe("Gratis");
    expect([...el.querySelectorAll("button")].map((b) => b.textContent))
      .toEqual(["Elegir", "Elegir", "Elegir", "Elegir"]);
    expect(el.querySelector(".cuenta-plan-pago")).toBeNull();
    expect(el.querySelectorAll("a")).toHaveLength(0);
  });
});
