// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Yo } from "@/lib/liga/api";
import { desmontarCuenta, montarEnCuenta, navFalsa } from "./pruebas";

const { guardar, refrescarYo, sesion, push, estadoResumen, cambiarResumen, probar } = vi.hoisted(() => ({
  push: { estado: "no-disponible", ocupado: false, error: null as string | null, activar: vi.fn(), desactivar: vi.fn() },
  estadoResumen: vi.fn(),
  cambiarResumen: vi.fn(),
  probar: vi.fn(),
  guardar: vi.fn(), refrescarYo: vi.fn(), sesion: { yo: {} as Partial<Yo> },
}));
vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  return {
    ...await importOriginal<object>(),
    useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
      (cuenta[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vals?.[k])),
  };
});
vi.mock("@/lib/liga/avisos", () => ({
  avisosSoportados: () => false, estadoAvisos: (...args: unknown[]) => estadoResumen(...args),
  cambiarResumenCorreo: (...args: unknown[]) => cambiarResumen(...args), activarAvisos: vi.fn(), bajaAvisos: vi.fn(),
  probarAvisoCuenta: (...args: unknown[]) => probar(...args),
  guardarAvisosCorreo: (...args: unknown[]) => guardar(...args),
}));
vi.mock("./usePushDispositivo", () => ({ usePushDispositivo: () => push }));
vi.mock("../_sesion/SesionContext", () => ({
  useSesion: () => ({ yo: sesion.yo, email: "ana@ejemplo.com", refrescarYo }),
}));
vi.mock("../_sesion/Sesion", () => ({ Sesion: () => null }));
vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
import { AvisosCuenta } from "./AvisosCuenta";

function montar(yo: Partial<Yo>) {
  sesion.yo = yo;
  return montarEnCuenta(<AvisosCuenta />, navFalsa()).el;
}
const interruptor = (el: HTMLElement, nombre: string) =>
  el.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${nombre}"]`)!;
const campo = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[type="email"]');
const botonProbar = (el: HTMLElement) =>
  [...el.querySelectorAll("button")].find(b => b.classList.contains("accion"));
async function escribirYSalir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}
beforeEach(() => {
  push.estado = "no-disponible"; push.error = null; push.ocupado = false;
  guardar.mockReset(); guardar.mockResolvedValue({ activo: true, correo: null });
  estadoResumen.mockReset(); estadoResumen.mockResolvedValue({ dispositivos: [], maximo: 3 });
  cambiarResumen.mockReset(); cambiarResumen.mockResolvedValue({});
  probar.mockReset(); probar.mockResolvedValue({ ok: 1, dispositivos: 2 });
  refrescarYo.mockReset();
});
afterEach(() => desmontarCuenta());

describe("AvisosCuenta", () => {
  it("pinta la barra, los tres grupos y sus textos", () => {
    const el = montar({ avisos_correo: true, correo_avisos: null });
    expect(el.querySelector("h1")?.textContent).toBe("Avisos");
    expect(el.querySelectorAll("ul.cu-grupo")).toHaveLength(3);
    const texto = el.textContent!;
    for (const s of ["En este dispositivo", "Notificaciones push", "Por correo", "Avisos por correo", "Enviar a",
      "Resumen del sábado", "Cada sábado, un correo"]) expect(texto).toContain(s);
  });
  it("muestra el resumen con el valor del estado", async () => {
    estadoResumen.mockResolvedValueOnce({ dispositivos: [], maximo: 3, resumen_correo: false });
    let el!: HTMLElement;
    await act(async () => { el = montar({}); });
    const resumen = interruptor(el, "Resumen del sábado");
    expect(resumen.getAttribute("aria-checked")).toBe("false");
    expect(resumen.disabled).toBe(false);
  });
  it("el interruptor del resumen revierte y avisa si falla", async () => {
    cambiarResumen.mockResolvedValue("fallo");
    let el!: HTMLElement;
    await act(async () => { el = montar({}); });
    expect(interruptor(el, "Resumen del sábado").getAttribute("aria-checked")).toBe("true");
    await act(async () => interruptor(el, "Resumen del sábado").click());
    expect(cambiarResumen).toHaveBeenCalledWith(false);
    expect(interruptor(el, "Resumen del sábado").getAttribute("aria-checked")).toBe("true");
    expect(el.querySelector('.mal[role="alert"]')?.textContent).toBe("No se pudo cambiar el resumen. Inténtalo de nuevo.");
  });
  it("el resumen queda desactivado mientras carga", () => {
    estadoResumen.mockReturnValue(new Promise(() => {}));
    const el = montar({});
    expect(interruptor(el, "Resumen del sábado").disabled).toBe(true);
  });
  it("muestra la prueba solo con avisos activos en este dispositivo", () => {
    push.estado = "activo";
    const el = montar({});
    expect(botonProbar(el)?.textContent).toBe("Enviar un aviso de prueba");
    expect(el.textContent).toContain("Te avisamos cuando empieza la jornada");
    desmontarCuenta();
    push.estado = "apagado";
    expect(botonProbar(montar({}))).toBeUndefined();
  });
  it("probar aviso enseña el resultado en el pie", async () => {
    push.estado = "activo";
    const el = montar({});
    await act(async () => botonProbar(el)!.click());
    expect(probar).toHaveBeenCalled();
    expect(el.textContent).toContain("Enviado a 1 de 2 dispositivos.");
    expect(el.textContent).not.toContain("Te avisamos cuando empieza la jornada");
  });
  it("si la prueba falla, el pie lo dice", async () => {
    push.estado = "activo";
    probar.mockResolvedValue("error");
    const el = montar({});
    await act(async () => botonProbar(el)!.click());
    expect(el.textContent).toContain("No se pudo enviar la prueba.");
  });
  it("activar el correo lo guarda con la dirección de la cuenta y enseña el campo", async () => {
    const el = montar({ avisos_correo: false, correo_avisos: null });
    expect(campo(el)).toBeNull();
    await act(async () => interruptor(el, "Avisos por correo").click());
    expect(guardar).toHaveBeenCalledWith(true, null);
    expect(interruptor(el, "Avisos por correo").getAttribute("aria-checked")).toBe("true");
    expect(campo(el)?.value).toBe("ana@ejemplo.com");
    expect(refrescarYo).toHaveBeenCalled();
  });
  it("otra dirección se guarda al salir del campo", async () => {
    const el = montar({ avisos_correo: true, correo_avisos: null });
    expect(el.textContent).toContain("Por defecto, el correo de tu cuenta.");
    await escribirYSalir(campo(el)!, "otra@ejemplo.com");
    expect(guardar).toHaveBeenCalledWith(true, "otra@ejemplo.com");
    expect(el.textContent).toContain("Guardado");
  });
  it("una dirección mala no se guarda y sale en rojo", async () => {
    const el = montar({ avisos_correo: true, correo_avisos: null });
    await escribirYSalir(campo(el)!, "ana@");
    expect(guardar).not.toHaveBeenCalled();
    const alerta = el.querySelector('.mal[role="alert"]');
    expect(alerta?.textContent).toBe("Revisa la dirección de correo.");
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
    await act(async () => interruptor(el, "Avisos por correo").click());
    expect(interruptor(el, "Avisos por correo").getAttribute("aria-checked")).toBe("false");
    expect(el.querySelector('.mal[role="alert"]')?.textContent).toBe("No se pudo guardar.");
  });
  it("sin push en el navegador, su interruptor queda fijo y explica por qué", () => {
    const el = montar({ avisos_correo: false, correo_avisos: null });
    expect(interruptor(el, "Notificaciones push").disabled).toBe(true);
    expect(el.textContent).toContain("Este navegador no admite avisos.");
  });
  it("con los avisos bloqueados, el pie lo explica", () => {
    push.estado = "bloqueado";
    const el = montar({});
    expect(interruptor(el, "Notificaciones push").disabled).toBe(true);
    expect(el.textContent).toContain("tiene bloqueados los avisos");
  });
  it("el error del push sale en rojo", () => {
    push.estado = "apagado";
    push.error = "No se pudo activar.";
    const el = montar({});
    expect(el.querySelector('.mal[role="alert"]')?.textContent).toBe("No se pudo activar.");
  });
  it("activar y desactivar el push llama al hook", async () => {
    push.estado = "apagado";
    const el = montar({});
    await act(async () => interruptor(el, "Notificaciones push").click());
    expect(push.activar).toHaveBeenCalled();
  });
});
