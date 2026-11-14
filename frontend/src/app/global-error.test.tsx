// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../messages/en/system.json";

const reportar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/liga/errores", () => ({ reportarError: reportar }));

import ErrorGlobal from "./global-error";

let root: Root;
const reset = vi.fn();
const fallo = Object.assign(new Error("boom"), { digest: "xyz789" });
beforeEach(() => {
  reportar.mockReset();
  reset.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  root = createRoot(document);
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); });

it("pinta el aviso con reintentar e inicio, y reintentar llama a reset", async () => {
  await act(async () => { root.render(<ErrorGlobal error={fallo} reset={reset} />); });
  expect(document.querySelector("h1")?.textContent).toBe(en.system_error_titulo);
  expect(document.querySelector("a.bt.tin")?.getAttribute("href")).toBe("/");
  await act(async () => { document.querySelector<HTMLButtonElement>("button.bt")!.click(); });
  expect(reset).toHaveBeenCalledTimes(1);
});

it("reportar llama a reportarError y muestra el agradecimiento", async () => {
  reportar.mockResolvedValue(true);
  await act(async () => { root.render(<ErrorGlobal error={fallo} reset={reset} />); });
  await act(async () => { document.querySelector<HTMLButtonElement>("button.en")!.click(); });
  expect(reportar).toHaveBeenCalledWith(expect.objectContaining({
    codigo: "xyz789", mensaje: "La web no se pudo mostrar: boom",
  }));
  expect(document.querySelector('p[role="status"]')?.textContent).toBe(en.system_error_gracias);
});
