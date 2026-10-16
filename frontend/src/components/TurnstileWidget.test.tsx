// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TurnstileWidget from "./TurnstileWidget";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("no renderiza ni carga el script sin clave publica", () => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
  const append = vi.spyOn(document.head, "appendChild");
  act(() => root.render(createElement(TurnstileWidget, { onToken: vi.fn() })));
  expect(host.innerHTML).toBe("");
  expect(append).not.toHaveBeenCalled();
});

it("renderiza el contenedor con clave sin cargar el script real", () => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  const append = vi.spyOn(document.head, "appendChild").mockImplementation(node => node);
  act(() => root.render(createElement(TurnstileWidget, { onToken: vi.fn() })));
  expect(host.querySelector("[data-turnstile-widget]")).not.toBeNull();
  expect(append).toHaveBeenCalledTimes(1);
  const script = append.mock.calls[0][0] as HTMLScriptElement;
  expect(script.src).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js");
  expect(script.async).toBe(true);
  expect(script.defer).toBe(true);
});
