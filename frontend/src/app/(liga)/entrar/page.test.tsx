// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import mensajes from "../../../../messages/es/auth.json";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(), entrarConAlias: vi.fn(), solicitarCorreo: vi.fn(),
}));
vi.mock("@/lib/liga/supabase", () => ({
  useSupabase: () => ({ auth: { signInWithPassword: mocks.signInWithPassword } }),
  destinoSeguro: () => "/liga",
}));
vi.mock("@/lib/liga/api", () => ({ entrarConAlias: mocks.entrarConAlias }));
vi.mock("@/lib/liga/registro", () => ({ solicitarCorreo: mocks.solicitarCorreo }));
vi.mock("../_ui/MarcoAcceso", () => ({ MarcoAcceso: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../_ui/AccesoProveedor", () => ({ BotonGoogle: () => null, Separador: () => null }));
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslations: () => (key: string) => mensajes[key as keyof typeof mensajes] ?? key,
}));
import Entrar from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.resetAllMocks();
});
async function montar(email: string) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Entrar)));
  const inputs = host.querySelectorAll("input");
  await act(async () => {
    for (const [input, valor] of [[inputs[0], email], [inputs[1], "UnaClave!"]] as const) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
const reenviar = () => [...host.querySelectorAll("button")].find(b => b.textContent === mensajes.auth_reenviar_confirmacion);

it("tras el error de confirmacion ofrece reenviar al correo y reutiliza el aviso", async () => {
  mocks.signInWithPassword.mockResolvedValue({ error: { code: "email_not_confirmed" } });
  mocks.solicitarCorreo.mockResolvedValue(null);
  await montar("persona@example.com");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(mensajes.auth_correo_sin_confirmar);
  expect(reenviar()).toBeDefined();
  await act(async () => reenviar()!.click());
  expect(mocks.solicitarCorreo).toHaveBeenCalledWith("/reenviar", { email: "persona@example.com", turnstile: "" });
  expect(host.querySelector('[role="status"]')?.textContent).toBe(mensajes.auth_correo_enviado_generico);
});
it("no ofrece reenviar con un alias aunque haya un error", async () => {
  mocks.entrarConAlias.mockResolvedValue(mensajes.auth_credenciales_incorrectas);
  await montar("persona");
  expect(reenviar()).toBeUndefined();
  expect(mocks.signInWithPassword).not.toHaveBeenCalled();
});
it("con credenciales incorrectas conserva el aviso sin ofrecer reenvio", async () => {
  mocks.signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials" } });
  await montar("persona@example.com");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(mensajes.auth_credenciales_incorrectas);
  expect(reenviar()).toBeUndefined();
});
