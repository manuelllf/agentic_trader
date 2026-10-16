// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const cliente = vi.hoisted(() => {
  const mfa = {
    getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: "aal1" } })),
    listFactors: vi.fn(async () => ({ data: {
      totp: [], all: [{ id: "pendiente", status: "unverified" }],
    } })),
    unenroll: vi.fn(async () => ({ error: null })),
    enroll: vi.fn(async () => ({ data: {
      id: "nuevo", totp: { qr_code: "data:image/png;base64,AA==", secret: "secreto" },
    }, error: null })),
  };
  const crear = () => ({ auth: {
    getSession: vi.fn(async () => ({ data: { session: {} } })), mfa,
  } });
  return { crear, sb: crear(), mfa };
});
vi.mock("@/lib/liga/supabase", () => ({
  useSupabase: () => cliente.sb,
  destinoSeguro: () => "/liga",
}));
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslations: () => (clave: string) => clave,
}));
vi.mock("../../_ui/MarcoAcceso", () => ({
  MarcoAcceso: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
import Verificacion from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  vi.clearAllMocks();
});

it("da de alta una sola vez al repetir el efecto en StrictMode y reinicia al cambiar sb", async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<StrictMode><Verificacion /></StrictMode>));

  expect(cliente.sb.auth.getSession).toHaveBeenCalledOnce();
  expect(cliente.mfa.enroll).toHaveBeenCalledOnce();
  expect(cliente.mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: "pendiente" });
  expect(cliente.mfa.enroll).toHaveBeenCalledWith({
    factorType: "totp", friendlyName: expect.stringMatching(/^Vennett [\da-f-]{36}$/),
  });
  expect(host.querySelector(".secreto")?.textContent).toContain("secreto");
  expect(host.querySelector('[role="alert"]')).toBeNull();

  await act(async () => root!.render(<StrictMode><Verificacion /></StrictMode>));
  expect(cliente.mfa.enroll).toHaveBeenCalledOnce();

  cliente.sb = cliente.crear();
  await act(async () => root!.render(<StrictMode><Verificacion /></StrictMode>));
  expect(cliente.mfa.enroll).toHaveBeenCalledTimes(2);
  expect(cliente.mfa.enroll.mock.calls[0]).not.toEqual(cliente.mfa.enroll.mock.calls[1]);
});
