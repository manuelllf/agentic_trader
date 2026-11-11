// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import mensajes from "../../../../messages/es/auth.json";

const mocks = vi.hoisted(() => ({
  acceso: null as null | { registro_abierto: boolean; correo_disponible: boolean },
  solicitarCorreo: vi.fn(),
}));
vi.mock("@/lib/liga/supabase", () => ({
  useSupabase: () => ({ auth: { signInWithPassword: vi.fn() } }),
  destinoSeguro: () => "/liga",
}));
vi.mock("@/lib/liga/registro", () => ({
  useAccesoCorreo: () => mocks.acceso,
  claveValida: () => true,
  requisitosClave: () => ({ longitud: false, mayuscula: false, simbolo: false }),
  solicitarCorreo: mocks.solicitarCorreo,
}));
vi.mock("@/components/TurnstileWidget", () => ({ default: () => null }));
vi.mock("../_ui/MarcoAcceso", () => ({ MarcoAcceso: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../_ui/AccesoProveedor", () => ({ BotonGoogle: () => null, Separador: () => null }));
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslations: () => Object.assign(
    (key: string) => mensajes[key as keyof typeof mensajes] ?? key,
    { rich: (key: string) => mensajes[key as keyof typeof mensajes] ?? key },
  ),
}));
import Registrar from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.resetAllMocks();
});
async function montar() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Registrar)));
}

it("con el registro cerrado muestra el aviso y el paso a entrar, sin formulario", async () => {
  mocks.acceso = { registro_abierto: false, correo_disponible: false };
  await montar();
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toBe(mensajes.auth_registro_cerrado);
  expect(host.querySelector('a[href="/entrar"]')?.textContent).toBe(mensajes.auth_entrar);
});

it("con el registro abierto pide correo, usuario, edad y contraseña en cajas, sin avisos del navegador", async () => {
  mocks.acceso = { registro_abierto: true, correo_disponible: true };
  await montar();
  expect(host.querySelector("form")?.hasAttribute("novalidate")).toBe(true);
  const marcadores = [...host.querySelectorAll("input")].map(input => input.placeholder);
  for (const texto of [mensajes.auth_campo_correo, mensajes.auth_campo_usuario, mensajes.auth_campo_edad, mensajes.auth_contrasena]) {
    expect(marcadores).toContain(texto);
  }
});

it("no envía si falta algún campo y lo dice en el aviso", async () => {
  mocks.acceso = { registro_abierto: true, correo_disponible: true };
  await montar();
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(mocks.solicitarCorreo).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(mensajes.auth_completa_campos);
});
