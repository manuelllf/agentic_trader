// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import system from "../../../messages/es/system.json";

const reportar = vi.hoisted(() => vi.fn());
vi.mock("next-intl", async (original) => ({
  ...(await original<typeof import("next-intl")>()),
  useTranslations: () => createTranslator({ locale: "es", messages: system }),
}));
vi.mock("@/lib/liga/errores", () => ({ reportarError: reportar }));
vi.mock("./_sesion/Sesion", () => ({ Sesion: () => <button data-testid="sesion" /> }));
vi.mock("./_avisos/Campana", () => ({ Campana: () => <button data-testid="campana" /> }));
vi.mock("./_ui/BarraPestanas", () => ({ BarraPestanas: () => <nav data-testid="barra" /> }));
vi.mock("./liga/ranking.css", () => ({}));
vi.mock("./_ui/grupos.css", () => ({}));
vi.mock("./_ui/paginas.css", () => ({}));

import ErrorDePantalla from "./error";

let root: Root;
let container: HTMLDivElement;
const reset = vi.fn();
const fallo = Object.assign(new Error("boom"), { digest: "abc123" });
beforeEach(() => {
  reportar.mockReset();
  reset.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); });

const pintar = () => act(async () => { root.render(<ErrorDePantalla error={fallo} reset={reset} />); });
const q = <T extends Element>(s: string) => container.querySelector<T>(s);

it("pinta el vacío con cabecera, acciones y barra, y registra el error", async () => {
  await pintar();
  expect(q("h1")?.textContent).toBe(system.system_error_titulo);
  expect(q(".pg-vacio p")?.textContent).toBe(system.system_error_pantalla);
  expect(q('header.cab [data-testid="sesion"]')).not.toBeNull();
  expect(q('header.cab [data-testid="campana"]')).not.toBeNull();
  expect(container.querySelectorAll("h1")).toHaveLength(1);
  expect(q('[data-testid="barra"]')).not.toBeNull();
  expect(q("a.cu-boton.tintado")?.getAttribute("href")).toBe("/liga");
  expect(console.error).toHaveBeenCalledWith(fallo);
});

it("reintentar llama a reset", async () => {
  await pintar();
  await act(async () => { q<HTMLButtonElement>("button.cu-boton")!.click(); });
  expect(reset).toHaveBeenCalledTimes(1);
});

it("reportar pasa por enviando y termina en gracias", async () => {
  let resolver!: (ok: boolean) => void;
  reportar.mockReturnValue(new Promise<boolean>((r) => { resolver = r; }));
  await pintar();
  await act(async () => { q<HTMLButtonElement>("button.pg-enlace")!.click(); });
  expect(reportar).toHaveBeenCalledWith(expect.objectContaining({
    codigo: "abc123", mensaje: "La pantalla no se pudo mostrar: boom",
  }));
  expect(q<HTMLButtonElement>("button.pg-enlace")?.disabled).toBe(true);
  expect(q("button.pg-enlace")?.textContent).toBe(system.system_error_enviando);
  await act(async () => { resolver(true); });
  expect(q('p.estado[role="status"]')?.textContent).toBe(system.system_error_gracias);
  expect(q("button.pg-enlace")).toBeNull();
});

it("si el envío falla avisa y deja volver a intentarlo", async () => {
  reportar.mockResolvedValue(false);
  await pintar();
  await act(async () => { q<HTMLButtonElement>("button.pg-enlace")!.click(); });
  expect(q('p.estado[role="status"]')?.textContent).toBe(system.system_error_envio_fallo);
  expect(q<HTMLButtonElement>("button.pg-enlace")?.disabled).toBe(false);
});
