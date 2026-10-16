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
vi.mock("@/lib/liga/avisos", () => ({
  avisosSoportados: () => false, estadoAvisos: vi.fn(), activarAvisos: vi.fn(), bajaAvisos: vi.fn(),
}));
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
      "Tú", "Seguridad", "Avisos", "Datos y ayuda",
    ]);
    expect([...el.querySelectorAll(".ajustes-nombre")].map(n => n.textContent)).toEqual([
      "Tu nombre en la liga", "Correo", "Verificación en dos pasos", "Contraseña",
      "Avisos", "Descargar mis datos", "Cómo funciona la liga", "Legal", "Borrar mi cuenta",
    ]);
    expect([...el.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual([
      "/cuenta/nombre", "/cuenta/verificacion?next=/cuenta", "/cuenta/clave",
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
    gratis,
    { ...gratis, plan: "pro", plan_pago: "mensual", plan_pago_hasta: "2026-11-10T12:00:00Z" },
    { ...gratis, plan: "pro", plan_pago: null },
  ] as Yo[])("oculta el plan para cualquier cuenta %#", yo => {
    const el = montar(yo);
    expect(el.querySelector('a[href="/cuenta/plan"]')).toBeNull();
    expect(el.textContent).not.toContain("Pro");
  });
  it.each([false, true])("solo muestra Activada con aal2=%s", aal2 => {
    const fila = montar({ ...gratis, aal2 }).querySelector('a[href^="/cuenta/verificacion"]')!;
    expect(fila.querySelector(".ajustes-valor")?.textContent ?? null).toBe(aal2 ? "Activada" : null);
  });
  it.each([[false, "Desactivados"], [true, "Correo"]])("resume los avisos con correo=%s", (avisos_correo, valor) => {
    const fila = montar({ ...gratis, avisos_correo }).querySelector('a[href="/cuenta/avisos"]')!;
    expect(fila.querySelector(".ajustes-valor")?.textContent).toBe(valor);
  });
});
