// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import mensajes from "../../../../../messages/es/admin.json";
import { get } from "@/lib/api";
import { Intenciones } from "./Intenciones";

vi.mock("@/lib/api", () => ({ get: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { if (root) act(() => root?.unmount()); root = undefined; vi.clearAllMocks(); });

async function montar(filas: unknown[]) {
  vi.mocked(get).mockResolvedValue(filas);
  const div = document.createElement("div");
  root = createRoot(div);
  await act(async () => root?.render(
    <NextIntlClientProvider locale="es" messages={mensajes}>
      <Intenciones />
    </NextIntlClientProvider>,
  ));
  return div;
}

it("consulta 90 días y muestra intención, recuento, tipo y regla", async () => {
  const div = await montar([
    { intencion: "empresas sostenibles", recuento: 1234, tipo: "no_disponible", regla: null },
    { intencion: "vacas lecheras", recuento: 12, tipo: "aproximada", regla: "fcf" },
  ]);
  expect(get).toHaveBeenCalledWith("/liga/admin/intenciones?dias=90");
  const filas = div.querySelectorAll("tbody tr");
  expect(filas).toHaveLength(2);
  expect(Array.from(filas[0].querySelectorAll("td"), celda => celda.textContent))
    .toEqual(["empresas sostenibles", "1.234", "No disponible", "Sin regla"]);
  expect(Array.from(filas[1].querySelectorAll("td"), celda => celda.textContent))
    .toEqual(["vacas lecheras", "12", "Aproximada", "fcf"]);
  expect(filas[0].querySelectorAll("td")[1].classList.contains("tabular-nums")).toBe(true);
});

it("muestra el estado vacío sin filas", async () => {
  const div = await montar([]);
  expect(div.textContent).toContain(mensajes.admin_intenciones_vacio);
  expect(div.querySelector("table")).toBeNull();
});

it("muestra un error traducido si falla la consulta", async () => {
  vi.mocked(get).mockRejectedValueOnce(new Error("fallo"));
  const div = await montar([]);
  expect(div.querySelector('[role="alert"]')?.textContent).toBe(mensajes.admin_intenciones_error);
  expect(div.textContent).not.toContain(mensajes.admin_intenciones_vacio);
});
