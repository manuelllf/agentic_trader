// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { cliente, refrescarYo, destino } = vi.hoisted(() => {
  const mfa = {
    getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: "aal1" } })),
    listFactors: vi.fn(async (): Promise<unknown> => ({ data: {
      totp: [], all: [{ id: "pendiente", status: "unverified" }],
    } })),
    unenroll: vi.fn(async () => ({ error: null })),
    enroll: vi.fn(async (): Promise<unknown> => ({ data: {
      id: "nuevo",
      totp: { qr_code: "data:image/png;base64,AA==", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Vennett?secret=JBSWY3DPEHPK3PXP" },
    }, error: null })),
    challengeAndVerify: vi.fn(async (): Promise<unknown> => ({ error: null })),
  };
  const crear = () => ({ auth: {
    getSession: vi.fn(async () => ({ data: { session: {} } })), refreshSession: vi.fn(async () => ({})), mfa,
  } });
  return { cliente: { crear, sb: crear(), mfa }, refrescarYo: vi.fn(), destino: { valor: "/liga" } };
});
vi.mock("@/lib/liga/supabase", () => ({
  useSupabase: () => cliente.sb,
  destinoSeguro: () => destino.valor,
}));
vi.mock("next-intl", async (importOriginal) => {
  const cuenta = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  const auth = (await import("../../../../messages/es/auth.json")).default as Record<string, string>;
  const textos = { ...auth, ...cuenta };
  return {
    ...await importOriginal<object>(),
    useTranslations: () => (clave: string, vars?: Record<string, unknown>) =>
      (textos[clave] ?? clave).replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? "")),
  };
});
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: {}, refrescarYo }) }));
vi.mock("../_sesion/Sesion", () => ({ Sesion: () => null }));
vi.mock("../_avisos/Campana", () => ({ Campana: () => null }));
import { VerificacionCuenta } from "./VerificacionCuenta";
import { desmontarCuenta, montarEnCuenta, navFalsa } from "./pruebas";

const escribir = vi.fn();
let movil = false;

beforeEach(() => {
  movil = false;
  destino.valor = "/liga";
  window.history.replaceState(null, "", "/cuenta/verificacion");
  window.matchMedia = ((q: string) => ({ matches: movil && q === "(pointer: coarse)", media: q,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, "clipboard", { value: { writeText: escribir }, configurable: true });
  cliente.sb = cliente.crear();
});
afterEach(() => {
  desmontarCuenta();
  vi.clearAllMocks();
  cliente.mfa.getAuthenticatorAssuranceLevel.mockImplementation(async () => ({ data: { currentLevel: "aal1" } }));
});

async function montar(nav = navFalsa()) {
  let r!: ReturnType<typeof montarEnCuenta>;
  await act(async () => { r = montarEnCuenta(createElement(VerificacionCuenta), nav); });
  return r;
}
const cifras = (el: HTMLElement) => [...el.querySelectorAll<HTMLInputElement>(".cu-seis input")];
const boton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>("button.cu-boton")!;
async function pegar(el: HTMLElement, texto: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: () => texto } });
  await act(async () => { cifras(el)[0].dispatchEvent(ev); });
}

it("da de alta una sola vez al repetir el efecto en StrictMode y reinicia al cambiar sb", async () => {
  let r!: ReturnType<typeof montarEnCuenta>;
  await act(async () => { r = montarEnCuenta(createElement(StrictMode, null, createElement(VerificacionCuenta))); });
  expect(cliente.sb.auth.getSession).toHaveBeenCalledOnce();
  expect(cliente.mfa.enroll).toHaveBeenCalledOnce();
  expect(cliente.mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: "pendiente" });
  expect(cliente.mfa.enroll).toHaveBeenCalledWith({
    factorType: "totp", friendlyName: expect.stringMatching(/^Vennett [\da-f-]{36}$/),
  });
  expect(r.el.querySelector(".cu-clave b")?.textContent).toBe("JBSW Y3DP EHPK 3PXP");
  expect(r.el.querySelector('[role="alert"]')).toBeNull();
});

it("con un factor TOTP existente pide el código y no da de alta", async () => {
  cliente.mfa.listFactors.mockResolvedValueOnce({ data: { totp: [{ id: "f1" }], all: [] } });
  const { el } = await montar();
  expect(cliente.mfa.enroll).not.toHaveBeenCalled();
  expect(el.textContent).toContain("Escribe el código que marca ahora tu app");
  expect(el.querySelector(".cu-qr")).toBeNull();
  expect(cifras(el)).toHaveLength(6);
});

it("si falla preparar el alta, el pie sale en rojo como alerta", async () => {
  cliente.mfa.enroll.mockResolvedValueOnce({ data: null, error: { message: "x" } });
  const { el } = await montar();
  const pie = el.querySelector('.cu-pie.mal[role="alert"]');
  expect(pie?.textContent).toContain("No se pudo preparar la verificación");
});

it("en escritorio sale el QR y no el enlace a la app", async () => {
  const { el } = await montar();
  expect(el.querySelector(".cu-qr img")).not.toBeNull();
  expect(el.querySelector('a[href^="otpauth://"]')).toBeNull();
  expect(el.textContent).toContain("Si no puedes escanearlo, añade esta clave a mano");
});

it("en móvil sale Abrir en mi app con el enlace otpauth y el QR solo al pedirlo", async () => {
  movil = true;
  const { el } = await montar();
  const enlace = el.querySelector<HTMLAnchorElement>("a.cu-celda.accion")!;
  expect(enlace.textContent).toBe("Abrir en mi app de códigos");
  expect(enlace.getAttribute("href")).toBe("otpauth://totp/Vennett?secret=JBSWY3DPEHPK3PXP");
  expect(el.querySelector(".cu-qr")).toBeNull();
  const ver = [...el.querySelectorAll("button.cu-celda")].find(b => b.textContent === "Ver el código QR")!;
  await act(async () => { (ver as HTMLButtonElement).click(); });
  expect(el.querySelector(".cu-qr img")).not.toBeNull();
  expect(el.textContent).toContain("Ocultar el código QR");
});

it("copiar manda el secreto sin espacios al portapapeles y avisa", async () => {
  const { el, nav } = await montar();
  await act(async () => { el.querySelector<HTMLButtonElement>(".cu-copiar")!.click(); });
  expect(escribir).toHaveBeenCalledExactlyOnceWith("JBSWY3DPEHPK3PXP");
  expect(nav.avisar).toHaveBeenCalledWith("Clave copiada");
});

it("el botón se activa con seis cifras y pegar las reparte", async () => {
  const { el } = await montar();
  expect(boton(el).disabled).toBe(true);
  await pegar(el, "12 34 56");
  expect(cifras(el).map(i => i.value).join("")).toBe("123456");
  expect(boton(el).disabled).toBe(false);
  expect(cifras(el)[0].autocomplete).toBe("one-time-code");
  expect(cifras(el)[2].getAttribute("aria-label")).toBe("Cifra 3 de 6");
});

it("un código bueno refresca la sesión, avisa y muestra Activada", async () => {
  const { el, nav } = await montar();
  await pegar(el, "123456");
  await act(async () => { boton(el).click(); });
  expect(cliente.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "nuevo", code: "123456" });
  expect(cliente.sb.auth.refreshSession).toHaveBeenCalledOnce();
  expect(nav.avisar).toHaveBeenCalledWith("Verificación activada");
  expect(refrescarYo).toHaveBeenCalledOnce();
  expect(el.querySelector(".cu-celda.dato .valor")?.textContent).toBe("Activada");
  expect(el.textContent).toContain("Listo: esta sesión ya está verificada.");
});

it("un código malo deja el pie en rojo, borra las cifras y vuelve a la primera", async () => {
  cliente.mfa.challengeAndVerify.mockResolvedValueOnce({ error: { message: "mal" } });
  const { el, nav } = await montar();
  await pegar(el, "000000");
  await act(async () => { boton(el).click(); });
  expect(el.querySelector(".cu-seis.mal")).not.toBeNull();
  expect(el.querySelector('.cu-pie.mal[role="alert"]')?.textContent).toContain("Ese código no vale");
  expect(cifras(el).every(i => i.value === "")).toBe(true);
  expect(document.activeElement).toBe(cifras(el)[0]);
  expect(nav.avisar).not.toHaveBeenCalled();
  expect(cliente.sb.auth.refreshSession).not.toHaveBeenCalled();
});

it("si la sesión ya es aal2 sale hecho sin avisar; Seguir solo con next y en modo página", async () => {
  cliente.mfa.getAuthenticatorAssuranceLevel.mockImplementation(async () => ({ data: { currentLevel: "aal2" } }));
  const primera = await montar();
  const { nav } = primera;
  let el = primera.el;
  expect(el.querySelector(".cu-celda.dato .valor")?.textContent).toBe("Activada");
  expect(el.querySelector("a.cu-boton")).toBeNull();
  expect(nav.avisar).not.toHaveBeenCalled();
  expect(cliente.mfa.enroll).not.toHaveBeenCalled();
  desmontarCuenta();

  window.history.replaceState(null, "", "/cuenta/verificacion?next=%2Fadmin");
  destino.valor = "/admin";
  cliente.sb = cliente.crear();
  ({ el } = await montar());
  expect(el.querySelector<HTMLAnchorElement>("a.cu-boton")?.getAttribute("href")).toBe("/admin");
  desmontarCuenta();

  cliente.sb = cliente.crear();
  ({ el } = await montar(navFalsa({ modo: "hoja" })));
  expect(el.querySelector("a.cu-boton")).toBeNull();
});
