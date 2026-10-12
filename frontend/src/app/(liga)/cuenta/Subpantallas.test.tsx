// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";

const mocks = vi.hoisted(() => ({
  yo: {
    pendiente: false, alias: "ejemplo", plan: "gratis", puede_crear_liga: false,
    roles: ["usuario"], admin: false, aal2: false, plan_pago: null,
  } as Yo,
  cambiarAlias: vi.fn(), fijar: vi.fn(), borrarMiCuenta: vi.fn(),
  updateUser: vi.fn(), signOut: vi.fn(), requerida: vi.fn(),
}));
vi.mock("@/lib/liga/api", () => ({ cambiarAlias: mocks.cambiarAlias }));
vi.mock("@/lib/liga/cache", () => ({ fijar: mocks.fijar }));
vi.mock("@/lib/liga/cuenta", () => ({ borrarMiCuenta: mocks.borrarMiCuenta }));
vi.mock("@/lib/liga/supabase", () => ({ useSupabase: () => ({
  auth: { updateUser: mocks.updateUser, signOut: mocks.signOut },
}) }));
vi.mock("../_sesion/SesionContext", () => ({
  useSesion: () => ({ yo: mocks.yo }),
  useSesionRequerida: (ruta: string) => {
    mocks.requerida(ruta);
    return { yo: mocks.yo };
  },
}));
vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => createElement("a", props) }));
vi.mock("next-intl", async (importOriginal) => {
  const es = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  return { ...await importOriginal<object>(), useTranslations: () => (key: string, values?: Record<string, string>) =>
    (es[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? `{${name}}`) };
});
import Nombre from "./nombre/page";
import Clave from "./clave/page";
import Borrar from "./borrar/page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function montar(Pagina: ComponentType) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(Pagina)));
  return host;
}
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function enviar(el: HTMLDivElement) {
  await act(async () => {
    el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  mocks.yo.plan_pago = null;
  vi.resetAllMocks();
});

describe("Nombre", () => {
  it("guarda el alias y actualiza la caché", async () => {
    mocks.cambiarAlias.mockResolvedValue({ ...mocks.yo, alias: "nuevo" });
    const el = await montar(Nombre);
    expect(mocks.requerida).toHaveBeenCalledWith("/cuenta/nombre");
    expect(el.querySelector("input")?.value).toBe("ejemplo");
    await escribir(el.querySelector("input")!, "nuevo");
    await enviar(el);
    expect(mocks.cambiarAlias).toHaveBeenCalledWith("nuevo");
    expect(mocks.fijar).toHaveBeenCalledWith("yo", expect.objectContaining({ alias: "nuevo" }));
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Guardado. Ya sales con este nombre.");
  });
});
describe("Clave", () => {
  it("avisa si la contraseña es corta", async () => {
    const el = await montar(Clave);
    expect(mocks.requerida).toHaveBeenCalledWith("/cuenta/clave");
    await escribir(el.querySelectorAll("input")[0], "Ab!");
    await enviar(el);
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Al menos 8 caracteres, una mayúscula y un símbolo.");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it("avisa si las contraseñas no coinciden", async () => {
    const el = await montar(Clave);
    await escribir(el.querySelectorAll("input")[0], "Abcdefgh!");
    await escribir(el.querySelectorAll("input")[1], "OtraClave!");
    await enviar(el);
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Las contraseñas no coinciden.");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
describe("Borrar", () => {
  it("solo habilita el botón con la palabra de confirmación", async () => {
    const el = await montar(Borrar);
    expect(mocks.requerida).toHaveBeenCalledWith("/cuenta/borrar");
    const boton = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(boton.disabled).toBe(true);
    await escribir(el.querySelector("input")!, "ELIMINA");
    expect(boton.disabled).toBe(true);
    await escribir(el.querySelector("input")!, " eliminar ");
    expect(boton.disabled).toBe(false);
    await escribir(el.querySelector("input")!, "");
    expect(boton.disabled).toBe(true);
  });
  it.each([null, "mensual"] as const)("nota de cancelación con plan_pago=%s", async plan => {
    mocks.yo.plan_pago = plan;
    const el = await montar(Borrar);
    expect(el.textContent?.includes("Al borrar tu cuenta se cancela tu suscripción y no se te volverá a cobrar."))
      .toBe(plan !== null);
  });
  it("conserva la confirmación y muestra el fallo sin cerrar sesión", async () => {
    mocks.borrarMiCuenta.mockResolvedValue("No se pudo borrar");
    const el = await montar(Borrar);
    await escribir(el.querySelector("input")!, "ELIMINAR");
    await enviar(el);
    expect(mocks.borrarMiCuenta).toHaveBeenCalledWith("ELIMINAR");
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("No se pudo borrar");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
