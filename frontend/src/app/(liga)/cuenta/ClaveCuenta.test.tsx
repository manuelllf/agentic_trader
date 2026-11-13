// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateUser: vi.fn() }));
vi.mock("@/lib/liga/supabase", () => ({ useSupabase: () => ({ auth: { updateUser: mocks.updateUser } }) }));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: { alias: "ejemplo" } }) }));
vi.mock("../_sesion/Sesion", () => ({ Sesion: () => null }));
vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
vi.mock("next/link", () => ({ default: (props: object) => createElement("a", props) }));
vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  const acceso = (await import("../../../../messages/es/auth.json")).default as Record<string, string>;
  const es = { ...acceso, ...cuenta };
  return { ...await importOriginal<object>(), useTranslations: () => (key: string) => es[key] ?? key };
});
import { ClaveCuenta } from "./ClaveCuenta";
import { desmontarCuenta, montarEnCuenta, navFalsa } from "./pruebas";

const campos = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLInputElement>("input"));
const cambiar = (el: HTMLElement) => el.querySelector<HTMLButtonElement>("button.cu-accion")!;
const pie = (el: HTMLElement) => el.querySelector<HTMLElement>(".cu-pie")!;
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const enter = (input: HTMLInputElement) => act(async () => {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
});
const pulsar = (b: HTMLElement) => act(async () => { b.click(); });
async function rellenar(el: HTMLElement, nueva: string, repite: string) {
  await escribir(campos(el)[0], nueva);
  await escribir(campos(el)[1], repite);
}

afterEach(() => { desmontarCuenta(); vi.resetAllMocks(); });

describe("ClaveCuenta", () => {
  it("Cambiar se activa solo con 8 caracteres y la repetición escrita", async () => {
    const { el } = montarEnCuenta(createElement(ClaveCuenta));
    expect(cambiar(el).disabled).toBe(true);
    expect(pie(el).textContent).toBe("Al menos 8 caracteres, una mayúscula y un símbolo.");
    await rellenar(el, "Abc!", "Abc!");
    expect(cambiar(el).disabled).toBe(true);
    await rellenar(el, "Abcdefg!", "");
    expect(cambiar(el).disabled).toBe(true);
    await rellenar(el, "Abcdefg!", "x");
    expect(cambiar(el).disabled).toBe(false);
  });

  it("cambia la contraseña, limpia, vuelve y avisa", async () => {
    mocks.updateUser.mockResolvedValue({ error: null });
    const { el, nav } = montarEnCuenta(createElement(ClaveCuenta));
    await rellenar(el, "Abcdefg!", "Abcdefg!");
    await pulsar(cambiar(el));
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "Abcdefg!" });
    expect(campos(el).map(i => i.value)).toEqual(["", ""]);
    expect(nav.volver).toHaveBeenCalled();
    expect(nav.avisar).toHaveBeenCalledWith("Contraseña cambiada.");
  });

  it("requisitos incumplidos: error en rojo y sin llamar a Supabase", async () => {
    const { el } = montarEnCuenta(createElement(ClaveCuenta));
    await rellenar(el, "abcdefgh", "abcdefgh");
    await pulsar(cambiar(el));
    expect(pie(el).textContent).toBe("Revisa los requisitos de la contraseña.");
    expect(pie(el).classList.contains("mal")).toBe(true);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("contraseñas distintas: error y sin llamar a Supabase", async () => {
    const { el } = montarEnCuenta(createElement(ClaveCuenta));
    await rellenar(el, "Abcdefg!", "Otra clave!");
    await pulsar(cambiar(el));
    expect(pie(el).textContent).toBe("Las contraseñas no coinciden.");
    expect(pie(el).classList.contains("mal")).toBe(true);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each([[422, "account_clave_invalida"], [500, "account_cambio_fallo"]])("error %i de Supabase en el pie", async (status, clave) => {
    mocks.updateUser.mockResolvedValue({ error: { status } });
    const { el, nav } = montarEnCuenta(createElement(ClaveCuenta));
    await rellenar(el, "Abcdefg!", "Abcdefg!");
    await pulsar(cambiar(el));
    const es = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
    expect(pie(el).textContent).toBe(es[clave]);
    expect(pie(el).classList.contains("mal")).toBe(true);
    expect(nav.volver).not.toHaveBeenCalled();
    expect(campos(el)[0].value).toBe("Abcdefg!");
  });

  it("el ojo cambia el tipo del campo y su etiqueta", async () => {
    const { el } = montarEnCuenta(createElement(ClaveCuenta));
    const ojo = el.querySelector<HTMLButtonElement>("button.cu-x")!;
    expect(campos(el)[0].type).toBe("password");
    expect(ojo.getAttribute("aria-label")).toBe("Mostrar contraseña");
    await pulsar(ojo);
    expect(campos(el)[0].type).toBe("text");
    expect(campos(el)[1].type).toBe("password");
    expect(ojo.getAttribute("aria-label")).toBe("Ocultar contraseña");
    expect(ojo.getAttribute("aria-pressed")).toBe("true");
  });

  it("Enter en el primero pasa al segundo; en el segundo cambia", async () => {
    mocks.updateUser.mockResolvedValue({ error: null });
    const { el, nav } = montarEnCuenta(createElement(ClaveCuenta));
    await rellenar(el, "Abcdefg!", "Abcdefg!");
    await enter(campos(el)[0]);
    expect(document.activeElement).toBe(campos(el)[1]);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    await enter(campos(el)[1]);
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "Abcdefg!" });
    expect(nav.volver).toHaveBeenCalled();
  });

  it("marca cambios sin guardar mientras haya algo escrito", async () => {
    const nav = navFalsa();
    const { el } = montarEnCuenta(createElement(ClaveCuenta), nav);
    expect(nav.marcarCambios).toHaveBeenLastCalledWith(false);
    await escribir(campos(el)[0], "a");
    expect(nav.marcarCambios).toHaveBeenLastCalledWith(true);
  });
});
