// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";

const { guardar, refrescarYo, sesion } = vi.hoisted(() => ({
  guardar: vi.fn(), refrescarYo: vi.fn(), sesion: { yo: {} as Partial<Yo> },
}));
vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  return { ...await importOriginal<object>(), useTranslations: () => (key: string) => cuenta[key] };
});
vi.mock("@/lib/liga/avisos", () => ({
  avisosSoportados: () => false, estadoAvisos: vi.fn(), activarAvisos: vi.fn(), bajaAvisos: vi.fn(),
  guardarAvisosCorreo: (...args: unknown[]) => guardar(...args),
}));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: sesion.yo, refrescarYo }) }));
import { AvisosCuenta } from "./AvisosCuenta";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
function montar(yo: Partial<Yo>) {
  sesion.yo = yo;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AvisosCuenta, { email: "ana@ejemplo.com" })));
  return host;
}
const interruptor = (el: HTMLElement, nombre: string) =>
  el.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${nombre}"]`)!;
const campo = (el: HTMLElement) => el.querySelector<HTMLInputElement>("#avisos-direccion");
async function escribirYSalir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}
beforeEach(() => { guardar.mockReset(); guardar.mockResolvedValue({ activo: true, correo: null }); });
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("AvisosCuenta", () => {
  it("activar el correo lo guarda con la dirección de la cuenta y enseña el campo", async () => {
    const el = montar({ avisos_correo: false, correo_avisos: null });
    expect(campo(el)).toBeNull();
    await act(async () => interruptor(el, "Correo").click());
    expect(guardar).toHaveBeenCalledWith(true, null);
    expect(interruptor(el, "Correo").getAttribute("aria-checked")).toBe("true");
    expect(campo(el)?.value).toBe("ana@ejemplo.com");
    expect(refrescarYo).toHaveBeenCalled();
  });
  it("otra dirección se guarda al salir del campo", async () => {
    const el = montar({ avisos_correo: true, correo_avisos: null });
    await escribirYSalir(campo(el)!, "otra@ejemplo.com");
    expect(guardar).toHaveBeenCalledWith(true, "otra@ejemplo.com");
    expect(el.textContent).toContain("Guardado");
  });
  it("una dirección mala no se guarda", async () => {
    const el = montar({ avisos_correo: true, correo_avisos: null });
    await escribirYSalir(campo(el)!, "ana@");
    expect(guardar).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("Revisa la dirección de correo.");
  });
  it("vaciar el campo vuelve a la dirección de la cuenta", async () => {
    const el = montar({ avisos_correo: true, correo_avisos: "otra@ejemplo.com" });
    expect(campo(el)?.value).toBe("otra@ejemplo.com");
    await escribirYSalir(campo(el)!, "");
    expect(guardar).toHaveBeenCalledWith(true, null);
    expect(campo(el)?.value).toBe("ana@ejemplo.com");
  });
  it("si el servidor no lo guarda, el interruptor vuelve atrás y lo dice", async () => {
    guardar.mockResolvedValue("No se pudo guardar.");
    const el = montar({ avisos_correo: false, correo_avisos: null });
    await act(async () => interruptor(el, "Correo").click());
    expect(interruptor(el, "Correo").getAttribute("aria-checked")).toBe("false");
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("No se pudo guardar.");
  });
  it("sin push en el navegador, su interruptor queda fijo y explica por qué", () => {
    const el = montar({ avisos_correo: false, correo_avisos: null });
    expect(interruptor(el, "Notificaciones push").disabled).toBe(true);
    expect(el.textContent).toContain("Este navegador no admite avisos.");
  });
});
