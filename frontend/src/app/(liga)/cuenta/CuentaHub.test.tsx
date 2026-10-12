// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";

vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default;
  const planes = (await import("../../../../messages/es/planes.json")).default;
  const es: Record<string, string> = { ...cuenta, ...planes };
  return { ...await importOriginal<object>(), useLocale: () => "es", useTranslations: () =>
    (key: string, values?: Record<string, string>) => es[key].replace(/\{(\w+)\}/g,
      (_, name: string) => values?.[name] ?? `{${name}}`) };
});
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => createElement("a", props) }));
vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: vi.fn() }));
import { CuentaHub } from "./CuentaHub";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const gratis: Yo = {
  pendiente: false, alias: "ejemplo", plan: "gratis", puede_crear_liga: false,
  roles: ["usuario"], admin: false, aal2: false,
};
let root: Root | undefined;
let host: HTMLDivElement | undefined;
function montar(yo: Yo = gratis) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(CuentaHub, { yo, email: "manuel@gmail.com" })));
  return host;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("CuentaHub", () => {
  it("ordena los grupos y todas las filas con sus destinos", () => {
    const el = montar();
    expect([...el.querySelectorAll("h2")].map(n => n.textContent)).toEqual([
      "Tú", "Plan", "Seguridad", "Avisos", "Datos y ayuda",
    ]);
    expect([...el.querySelectorAll(".ajustes-nombre")].map(n => n.textContent)).toEqual([
      "Tu nombre en la liga", "Correo", "Gratis", "Verificación en dos pasos", "Contraseña",
      "Avisos en este dispositivo", "Descargar mis datos", "Cómo funciona la liga", "Legal", "Borrar mi cuenta",
    ]);
    expect([...el.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual([
      "/cuenta/nombre", "/cuenta/plan", "/cuenta/verificacion?next=/cuenta", "/cuenta/clave",
      "/cuenta/avisos", "/cuenta/datos", "/como-funciona", "/cuenta/legal", "/cuenta/borrar",
    ]);
    const correo = el.querySelectorAll("li")[1];
    expect(correo.querySelector("a")).toBeNull();
    expect(correo.textContent).toContain("m•••••@gmail.com");
    expect(el.textContent).not.toContain("manuel@gmail.com");
    expect(el.textContent).toContain("Nadie ve tu correo en la liga.");
    const ultima = [...el.querySelectorAll(".ajustes-fila")].at(-1)!;
    expect(ultima.textContent).toBe("Borrar mi cuenta");
    expect(ultima.classList.contains("ajustes-peligro")).toBe(true);
  });
  it.each([
    [gratis, "Gratis", "Elige un plan para crear ligas"],
    [{ ...gratis, plan: "pro", plan_pago: "mensual", plan_pago_hasta: "2026-11-10T12:00:00Z" },
      "Pro · Mensual", "Vigente hasta el 10 de noviembre"],
    [{ ...gratis, plan: "pro", plan_pago: null }, "Pro", "Concedido por Vennett"],
  ] as const)("muestra título y subtítulo del plan %#", (yo, titulo, sub) => {
    const fila = montar(yo as Yo).querySelector('a[href="/cuenta/plan"]')!;
    expect(fila.querySelector(".ajustes-nombre")?.textContent).toBe(titulo);
    expect(fila.querySelector(".ajustes-sub")?.textContent).toBe(sub);
  });
  it.each([false, true])("solo muestra Activada con aal2=%s", aal2 => {
    const fila = montar({ ...gratis, aal2 }).querySelector('a[href^="/cuenta/verificacion"]')!;
    expect(fila.querySelector(".ajustes-valor")?.textContent ?? null).toBe(aal2 ? "Activada" : null);
  });
});
