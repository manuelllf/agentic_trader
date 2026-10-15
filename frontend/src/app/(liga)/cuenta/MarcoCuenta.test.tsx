// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const sesion = vi.hoisted(() => ({ yo: {} as object | null, yoFallo: false, refrescarYo: vi.fn() }));
const navegacion = vi.hoisted(() => ({ prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/cuenta/nombre",
  useRouter: () => navegacion,
}));
vi.mock("@/lib/liga/api", () => ({
  getCatalogo: vi.fn(), getCreditos: vi.fn(), getPortada: vi.fn(),
  misEstrategias: vi.fn(), misLigas: vi.fn(),
}));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => sesion }));
vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => {
    void prefetch;
    return createElement("a", props);
  },
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("next-intl", async () => {
  const es = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  const common = (await import("../../../../messages/es/common.json")).default as Record<string, string>;
  return { useTranslations: () => (key: string) => es[key] ?? common[key] ?? key };
});
import { MarcoCuenta } from "./MarcoCuenta";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
function montar() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<MarcoCuenta titulo="Nombre">contenido</MarcoCuenta>));
  return host;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  sesion.yo = {};
  sesion.yoFallo = false;
  vi.clearAllMocks();
});
it("vuelve a /cuenta con un chevron oculto a lectores", () => {
  const el = montar();
  const volver = el.querySelector('.ajustes-volver')!;
  expect(volver.textContent).toBe("Cuenta");
  expect(volver.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(el.querySelector("h1")?.textContent).toBe("Nombre");
  expect(el.textContent).toContain("contenido");
});
it("muestra carga antes de recibir yo", () => {
  sesion.yo = null;
  const el = montar();
  expect(el.textContent).not.toContain("contenido");
  expect(el.querySelector(".esqueleto")).not.toBeNull();
});
it("permite reintentar tras un error", () => {
  sesion.yo = null;
  sesion.yoFallo = true;
  const el = montar();
  expect(el.textContent).toContain("No hemos podido cargar tu cuenta");
  act(() => el.querySelector<HTMLButtonElement>("button")!.click());
  expect(sesion.refrescarYo).toHaveBeenCalledOnce();
});

it("incluye la barra de pestañas con Cuenta marcada", () => {
  const el = montar();
  expect(el.querySelector("main")?.classList.contains("con-barra")).toBe(true);
  const barra = el.querySelector("nav.tabbar");
  expect(barra).not.toBeNull();
  expect(barra?.querySelector('a[href="/cuenta"]')?.getAttribute("aria-current")).toBe("page");
});
