// @vitest-environment jsdom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ cliente: undefined as object | null | undefined }));
const registro = vi.hoisted(() => ({ confirmarAlta: vi.fn() }));
const avisos = vi.hoisted(() => ({ destinoConAvisos: vi.fn() }));
vi.mock("@/lib/liga/supabase", () => ({ useSupabase: () => supabase.cliente }));
vi.mock("@/lib/liga/registro", () => registro);
vi.mock("@/lib/liga/avisos", () => avisos);
vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => createElement("a", props) }));
vi.mock("next-intl", async () => {
  const es = (await import("../../../../messages/es/auth.json")).default as Record<string, string>;
  const t = (key: string) => es[key] ?? key;
  return { useTranslations: () => t, useLocale: () => "es" };
});
import Confirmar from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const navegacion = { assign: vi.fn(), replace: vi.fn() };
let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function montar() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(StrictMode, null, createElement(Confirmar))));
  return host;
}
const botones = (el: HTMLElement) => [...el.querySelectorAll("button")].map((b) => b.textContent);

beforeEach(() => {
  supabase.cliente = {};
  avisos.destinoConAvisos.mockImplementation(async (_origen: string, destino: string) => destino);
  vi.stubGlobal("location", navegacion);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("confirmar", () => {
  it("espera al cliente de Supabase sin tocar el enlace", async () => {
    supabase.cliente = undefined;
    const el = await montar();
    expect(el.textContent).toContain("Comprobando el enlace…");
    expect(registro.confirmarAlta).not.toHaveBeenCalled();
  });

  it("mientras comprueba el enlace no ofrece entrar", async () => {
    registro.confirmarAlta.mockReturnValue(new Promise(() => {}));
    const el = await montar();
    expect(el.querySelector("h1")?.textContent).toBe("Confirmar correo");
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Comprobando el enlace…");
    expect(botones(el)).toEqual([]);
  });

  it("procesa el enlace una sola vez, aunque el efecto se repita", async () => {
    registro.confirmarAlta.mockResolvedValue("confirmada");
    await montar();
    expect(registro.confirmarAlta).toHaveBeenCalledOnce();
    expect(registro.confirmarAlta).toHaveBeenCalledWith(supabase.cliente);
  });

  it("con el alta confirmada dice «Cuenta confirmada» y deja entrar", async () => {
    registro.confirmarAlta.mockResolvedValue("confirmada");
    const el = await montar();
    expect(el.querySelector("h1")?.textContent).toBe("Cuenta confirmada");
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Correo confirmado. Tu cuenta está lista.");
    expect(botones(el)).toEqual(["Entrar"]);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(navegacion.replace).not.toHaveBeenCalled();
  });

  it("anuncia el cambio desde una misma región de estado, para que lo lea el lector de pantalla", async () => {
    let resolver!: (resultado: string) => void;
    registro.confirmarAlta.mockReturnValue(new Promise((resolve) => { resolver = resolve; }));
    const el = await montar();
    const region = el.querySelector('[role="status"]');
    await act(async () => resolver("confirmada"));
    expect(el.querySelector('[role="status"]')).toBe(region);
    expect(region?.textContent).toBe("Correo confirmado. Tu cuenta está lista.");
  });

  it("Entrar lleva a la liga pasando por el aviso de notificaciones si toca", async () => {
    registro.confirmarAlta.mockResolvedValue("confirmada");
    avisos.destinoConAvisos.mockResolvedValue("/avisos-alta?next=%2Fliga");
    const el = await montar();
    await act(async () => el.querySelector<HTMLButtonElement>("button")!.click());
    expect(avisos.destinoConAvisos).toHaveBeenCalledWith("confirmar", "/liga");
    expect(navegacion.assign).toHaveBeenCalledExactlyOnceWith("/avisos-alta?next=%2Fliga");
  });

  it("un enlace que no vale, sin sesión, lo explica y deja ir a entrar", async () => {
    registro.confirmarAlta.mockResolvedValue("invalido");
    const el = await montar();
    expect(el.querySelector("h1")?.textContent).toBe("Confirmar correo");
    expect(el.querySelector('[role="alert"]')?.textContent)
      .toBe("El enlace ha caducado, ya se ha utilizado o no es válido.");
    const entrar = [...el.querySelectorAll("a")].find((a) => a.textContent === "Entrar");
    expect(entrar?.getAttribute("href")).toBe("/entrar");
    expect(el.textContent).not.toContain("Cuenta confirmada");
  });

  it("con-sesion muestra Cuenta confirmada y no redirige", async () => {
    registro.confirmarAlta.mockResolvedValue("con-sesion");
    avisos.destinoConAvisos.mockResolvedValue("/liga");
    const el = await montar();
    expect(el.querySelector("h1")?.textContent).toBe("Cuenta confirmada");
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Correo confirmado. Tu cuenta está lista.");
    expect(botones(el)).toEqual(["Entrar"]);
    expect(navegacion.replace).not.toHaveBeenCalled();
    expect(navegacion.assign).not.toHaveBeenCalled();
    expect(avisos.destinoConAvisos).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it("sin cuentas disponibles no intenta confirmar y avisa del enlace", async () => {
    supabase.cliente = null;
    const el = await montar();
    expect(registro.confirmarAlta).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')?.textContent)
      .toBe("El enlace ha caducado, ya se ha utilizado o no es válido.");
  });
});
