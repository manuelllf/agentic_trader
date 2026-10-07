// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const sesion = vi.hoisted(() => ({ estado: "dentro" as string, yo: { alias: "manuel", admin: false, aal2: false } as null | { alias: string; admin: boolean; aal2: boolean }, cerrarSesion: vi.fn() }));
vi.mock("./SesionContext", () => ({ useSesion: () => sesion }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: (p: { href: string; className?: string; role?: string; onClick?: () => void; children?: React.ReactNode }) =>
    React.createElement("a", { href: p.href, className: p.className, role: p.role, onClick: p.onClick }, p.children) };
});
vi.mock("next-intl", async () => {
  const es = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (es[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  return { useTranslations: () => t };
});
import { Sesion } from "./Sesion";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
function montar() {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Sesion)));
  return host;
}
function abrir(contenedor: HTMLElement) { act(() => contenedor.querySelector("button")!.click()); }
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove(); root = undefined; host = undefined;
  sesion.estado = "dentro"; sesion.yo = { alias: "manuel", admin: false, aal2: false };
  sesion.cerrarSesion.mockReset();
});

describe("Sesion", () => {
  it("abre el menú de una sesión sin privilegios", () => {
    const el = montar();
    expect(el.querySelector('[role="menu"]')).toBeNull();
    abrir(el);
    expect(el.textContent).toContain("Sesión de manuel");
    expect(el.textContent).toContain("Tu cuenta"); expect(el.textContent).toContain("Salir");
    expect(el.textContent).not.toContain("Panel de control");
    for (const texto of ["Aviso legal", "Privacidad", "Términos", "Cookies"]) expect(el.textContent).toContain(texto);
  });
  it("usa el destino de admin según aal2", () => {
    sesion.yo = { alias: "manuel", admin: true, aal2: true };
    let el = montar(); abrir(el); expect(el.querySelector('a[href="/admin"]')?.textContent).toBe("Panel de control");
    act(() => root!.unmount()); root = undefined; host?.remove(); host = undefined;
    sesion.yo = { alias: "manuel", admin: true, aal2: false };
    el = montar(); abrir(el); expect(el.querySelector('a[href="/cuenta/verificacion?next=/admin"]')).not.toBeNull();
  });
  it("cierra al salir, con Escape o al tocar fuera", async () => {
    const el = montar(); abrir(el);
    await act(async () => { el.querySelector(".salir")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(sesion.cerrarSesion).toHaveBeenCalledTimes(1); expect(el.querySelector('[role="menu"]')).toBeNull();
    abrir(el); act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(el.querySelector('[role="menu"]')).toBeNull();
    abrir(el); act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });
  it("muestra entrar y legal sin sesión", () => {
    sesion.estado = "fuera"; sesion.yo = null;
    const el = montar(); abrir(el);
    expect(el.querySelector('a[href="/entrar"]')?.textContent).toBe("Entrar");
    expect(el.textContent).not.toContain("Salir"); expect(el.textContent).not.toContain("Sesión de");
    expect(el.querySelectorAll(".legal a")).toHaveLength(4);
  });
  it("deja solo un hueco mientras carga", () => {
    sesion.estado = "cargando";
    const el = montar(); expect(el.querySelector("button")).toBeNull();
    expect(el.querySelector(".cuenta-hueco")).not.toBeNull();
  });
});
