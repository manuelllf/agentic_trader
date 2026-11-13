// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";

const mocks = vi.hoisted(() => ({
  yo: { alias: "ejemplo", plan_pago: null } as Partial<Yo>,
  borrarMiCuenta: vi.fn(), exportarMisDatos: vi.fn(), signOut: vi.fn(),
}));
vi.mock("@/lib/liga/cuenta", () => ({ borrarMiCuenta: mocks.borrarMiCuenta, exportarMisDatos: mocks.exportarMisDatos }));
vi.mock("@/lib/liga/supabase", () => ({ useSupabase: () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: mocks.yo }) }));
vi.mock("../_sesion/Sesion", () => ({ Sesion: () => null }));
vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  return { ...await importOriginal<object>(), useTranslations: () => (key: string, values?: Record<string, string>) =>
    (cuenta[key] ?? key).replace(/\{(\w+)\}/g, (_, n: string) => values?.[n] ?? `{${n}}`) };
});
import { BorrarCuenta } from "./BorrarCuenta";
import { desmontarCuenta, montarEnCuenta, navFalsa } from "./pruebas";

const reemplazo = vi.fn();
const original = window.location;
async function montar() {
  let r!: ReturnType<typeof montarEnCuenta>;
  await act(async () => { r = montarEnCuenta(createElement(BorrarCuenta), navFalsa()); });
  return r;
}
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const boton = (el: HTMLElement, texto: string) => [...el.querySelectorAll("button")].find(b => b.textContent === texto)!;

beforeEach(() => {
  mocks.yo = { alias: "ejemplo", plan_pago: null };
  mocks.borrarMiCuenta.mockReset();
  mocks.borrarMiCuenta.mockResolvedValue(null);
  mocks.exportarMisDatos.mockReset();
  mocks.signOut.mockReset();
  reemplazo.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { replace: reemplazo } });
});
afterEach(() => {
  desmontarCuenta();
  Object.defineProperty(window, "location", { configurable: true, value: original });
});

describe("BorrarCuenta", () => {
  it("pinta las filas de lo que se borra y de lo que se queda", async () => {
    const { el } = await montar();
    const texto = el.textContent ?? "";
    for (const s of ["Borrar cuenta", "Se borra al momento", "Tu perfil y tu nombre", "Tus créditos", "Tus datos personales",
      "No se puede deshacer.", "Se queda", "Tus estrategias en la clasificación, sin tu nombre", "Para confirmar, escribe ELIMINAR"]) {
      expect(texto).toContain(s);
    }
    expect(el.querySelectorAll(".cu-celda.texto")).toHaveLength(4);
  });
  it("la nota de suscripción solo sale con plan de pago", async () => {
    let r = await montar();
    expect(r.el.textContent).not.toContain("se cancela tu suscripción");
    desmontarCuenta();
    mocks.yo = { alias: "ejemplo", plan_pago: { plan: "pro" } as unknown as Yo["plan_pago"] };
    r = await montar();
    expect(r.el.textContent).toContain("se cancela tu suscripción");
  });
  it("el botón queda desactivado hasta escribir la palabra, también en minúsculas", async () => {
    const { el } = await montar();
    const campo = el.querySelector<HTMLInputElement>("input")!;
    const borrar = boton(el, "Borrar mi cuenta");
    expect(borrar.disabled).toBe(true);
    await escribir(campo, "elimin");
    expect(borrar.disabled).toBe(true);
    await escribir(campo, "eliminar");
    expect(borrar.disabled).toBe(false);
  });
  it("borra, cierra la sesión y vuelve a la portada", async () => {
    const { el } = await montar();
    await escribir(el.querySelector("input")!, "eliminar");
    await act(async () => { boton(el, "Borrar mi cuenta").click(); });
    expect(mocks.borrarMiCuenta).toHaveBeenCalledWith("eliminar");
    expect(mocks.signOut).toHaveBeenCalled();
    expect(reemplazo).toHaveBeenCalledWith("/");
  });
  it("enseña el error en rojo y no cierra la sesión", async () => {
    mocks.borrarMiCuenta.mockResolvedValue("No se pudo borrar");
    const { el } = await montar();
    await escribir(el.querySelector("input")!, "ELIMINAR");
    await act(async () => { boton(el, "Borrar mi cuenta").click(); });
    const aviso = el.querySelector(".cu-pie.mal")!;
    expect(aviso.textContent).toBe("No se pudo borrar");
    expect(aviso.getAttribute("role")).toBe("alert");
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(reemplazo).not.toHaveBeenCalled();
  });
  it("Descargar antes mis datos llama a exportarMisDatos", async () => {
    mocks.exportarMisDatos.mockResolvedValue({ error: "Sin conexión" });
    const { el } = await montar();
    await act(async () => { boton(el, "Descargar antes mis datos").click(); });
    expect(mocks.exportarMisDatos).toHaveBeenCalled();
    expect(el.querySelector(".cu-pie.mal")?.textContent).toBe("Sin conexión");
  });
});
