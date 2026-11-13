// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  yo: { alias: "ejemplo" }, cambiarAlias: vi.fn(), fijar: vi.fn(),
}));
vi.mock("@/lib/liga/api", () => ({ cambiarAlias: mocks.cambiarAlias }));
vi.mock("@/lib/liga/cache", () => ({ fijar: mocks.fijar }));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: mocks.yo }) }));
vi.mock("../_sesion/Sesion", () => ({ Sesion: () => null }));
vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
vi.mock("next/link", () => ({ default: (props: object) => createElement("a", props) }));
vi.mock("next-intl", async (importOriginal) => {
  const es = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  return { ...await importOriginal<object>(), useTranslations: () => (key: string, values?: Record<string, string>) =>
    (es[key] ?? key).replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? `{${n}}`)) };
});
import { NombreCuenta } from "./NombreCuenta";
import { desmontarCuenta, montarEnCuenta, navFalsa } from "./pruebas";

const entrada = (el: HTMLElement) => el.querySelector<HTMLInputElement>("input")!;
const guardar = (el: HTMLElement) => el.querySelector<HTMLButtonElement>("button.cu-accion")!;
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

beforeEach(() => { mocks.yo.alias = "ejemplo"; });
afterEach(() => { desmontarCuenta(); vi.resetAllMocks(); });

describe("NombreCuenta", () => {
  it("empieza con el alias, Guardar apagado y el pie con el tope de cambios", () => {
    const { el } = montarEnCuenta(createElement(NombreCuenta));
    expect(entrada(el).value).toBe("ejemplo");
    expect(guardar(el).disabled).toBe(true);
    expect(pie(el).textContent).toBe("Lo ven los demás y sirve para entrar. Puedes cambiarlo 3 veces cada 30 días.");
  });

  it("Guardar se activa con otro nombre y se apaga con el mismo o vacío", async () => {
    const { el } = montarEnCuenta(createElement(NombreCuenta));
    await escribir(entrada(el), "Nuevo");
    expect(guardar(el).disabled).toBe(false);
    await escribir(entrada(el), " EJEMPLO ");
    expect(guardar(el).disabled).toBe(true);
    await escribir(entrada(el), "  ");
    expect(guardar(el).disabled).toBe(true);
  });

  it("guarda: manda lo escrito (lo normaliza el servidor), fija la caché, vuelve y avisa", async () => {
    mocks.cambiarAlias.mockResolvedValue({ alias: "nuevo" });
    const { el, nav } = montarEnCuenta(createElement(NombreCuenta));
    await escribir(entrada(el), " Nuevo ");
    await pulsar(guardar(el));
    expect(mocks.cambiarAlias).toHaveBeenCalledWith(" Nuevo ");
    expect(mocks.fijar).toHaveBeenCalledWith("yo", { alias: "nuevo" });
    expect(nav.volver).toHaveBeenCalled();
    expect(nav.avisar).toHaveBeenCalledWith("Guardado. Ya sales con este nombre.");
  });

  it("el error de la API sale en el pie en rojo y no vuelve", async () => {
    mocks.cambiarAlias.mockResolvedValue("Ese nombre ya lo usa otra persona.");
    const { el, nav } = montarEnCuenta(createElement(NombreCuenta));
    await escribir(entrada(el), "alpha");
    await pulsar(guardar(el));
    expect(pie(el).textContent).toBe("Ese nombre ya lo usa otra persona.");
    expect(pie(el).classList.contains("mal")).toBe(true);
    expect(mocks.fijar).not.toHaveBeenCalled();
    expect(nav.volver).not.toHaveBeenCalled();
  });

  it("Enter guarda si se puede y no hace nada si no", async () => {
    mocks.cambiarAlias.mockResolvedValue({ alias: "nuevo" });
    const { el, nav } = montarEnCuenta(createElement(NombreCuenta));
    await enter(entrada(el));
    expect(mocks.cambiarAlias).not.toHaveBeenCalled();
    await escribir(entrada(el), "nuevo");
    await enter(entrada(el));
    expect(mocks.cambiarAlias).toHaveBeenCalledWith("nuevo");
    expect(nav.volver).toHaveBeenCalled();
  });

  it("la x vacía el campo y se oculta sin texto", async () => {
    const { el } = montarEnCuenta(createElement(NombreCuenta));
    const x = el.querySelector<HTMLButtonElement>("button.cu-x")!;
    expect(x.hidden).toBe(false);
    await pulsar(x);
    expect(entrada(el).value).toBe("");
    expect(x.hidden).toBe(true);
  });

  it("marca cambios sin guardar y no pisa lo escrito cuando la sesión se revalida", async () => {
    const nav = navFalsa();
    const { el } = montarEnCuenta(createElement(NombreCuenta), nav);
    expect(nav.marcarCambios).toHaveBeenLastCalledWith(false);
    await escribir(entrada(el), "otro");
    expect(nav.marcarCambios).toHaveBeenLastCalledWith(true);
    mocks.yo = { alias: "revalidado" };
    await escribir(entrada(el), "otro2");
    expect(entrada(el).value).toBe("otro2");
  });
});
