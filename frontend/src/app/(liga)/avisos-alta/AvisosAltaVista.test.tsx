// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import es from "../../../../messages/es/account.json";

vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => createElement("a", props) }));
vi.mock("next-intl", async () => {
  const textos = (await import("../../../../messages/es/account.json")).default as Record<string, string>;
  return { useTranslations: () => (key: string) => textos[key] ?? key };
});
import { AvisosAltaVista } from "./AvisosAltaVista";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
function montar(props: Partial<ComponentProps<typeof AvisosAltaVista>> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<AvisosAltaVista variante="avisos" ocupado={false} error={null}
    onActivar={() => {}} onSeguir={() => {}} {...props} />));
  return host;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.clearAllMocks();
});

it("pide el permiso con un solo botón y ejecuta la acción", () => {
  const onActivar = vi.fn(), onSeguir = vi.fn();
  const el = montar({ onActivar, onSeguir });
  const botones = el.querySelectorAll<HTMLButtonElement>("button");
  expect([...botones].map(b => b.textContent)).toEqual([es.account_avisos_alta_activar]);
  expect(el.querySelector("h1")?.textContent).toBe(es.account_avisos_alta_titulo);
  expect(el.textContent).toContain(es.account_avisos_alta_texto);
  act(() => botones[0].click());
  expect(onActivar).toHaveBeenCalledOnce();
  expect(onSeguir).not.toHaveBeenCalled();
});

it("explica la instalación en iOS y permite continuar", () => {
  const onSeguir = vi.fn();
  const el = montar({ variante: "ios", onSeguir });
  expect(el.textContent).toContain(es.account_avisos_no_disponibles);
  const botones = el.querySelectorAll<HTMLButtonElement>("button");
  expect(botones.length).toBe(1);
  expect(botones[0].textContent).toBe(es.account_avisos_alta_continuar);
  act(() => botones[0].click());
  expect(onSeguir).toHaveBeenCalledOnce();
});

it("muestra el error como alerta", () => {
  expect(montar({ error: es.account_avisos_error }).querySelector('[role="alert"]')?.textContent)
    .toBe(es.account_avisos_error);
});

it.each(["avisos", "ios"] as const)("deshabilita los botones de %s mientras está ocupado", variante => {
  const onActivar = vi.fn(), onSeguir = vi.fn();
  const botones = montar({ variante, ocupado: true, onActivar, onSeguir }).querySelectorAll<HTMLButtonElement>("button");
  expect([...botones].every(b => b.disabled)).toBe(true);
  act(() => botones.forEach(b => b.click()));
  expect(onActivar).not.toHaveBeenCalled();
  expect(onSeguir).not.toHaveBeenCalled();
});
