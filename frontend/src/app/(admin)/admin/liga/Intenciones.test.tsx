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

it("consulta 90 días y muestra las columnas, la última vez y las reglas en ambas vistas", async () => {
  const ultima = "2026-01-02T12:00:00Z";
  const primera = "2026-01-01T12:00:00Z";
  const div = await montar([
    { intencion: "empresas sostenibles", recuento: 1234, tipo: "no_disponible", regla: null, ultima, primera },
    { intencion: "vacas lecheras", recuento: 12, tipo: "aproximada", regla: "fcf", ultima, primera },
    { intencion: "rentabilidad", recuento: 3, tipo: "exacta", regla: "roe", ultima, primera },
  ]);
  expect(get).toHaveBeenCalledWith("/liga/admin/intenciones?dias=90");
  const escritorio = div.querySelector(".adm-intenciones-escritorio")!;
  expect(Array.from(escritorio.querySelectorAll("th"), celda => celda.textContent))
    .toEqual(["Lo que piden", "Veces", "Última vez", "Regla"]);
  const filas = escritorio.querySelectorAll("tbody tr");
  expect(filas).toHaveLength(3);
  for (const [i, valores] of [["empresas sostenibles", "1234", "Sin regla"], ["vacas lecheras", "12", "Parecida a fcf"], ["rentabilidad", "3", "roe"]].entries()) {
    const celdas = filas[i].querySelectorAll("td");
    expect([celdas[0].textContent, celdas[1].textContent, celdas[3].textContent]).toEqual(valores);
    expect(celdas[2].querySelector("time")?.getAttribute("dateTime")).toBe(ultima);
  }
  expect(filas[0].querySelectorAll("td")[1].classList.contains("tabular-nums")).toBe(true);
  expect(filas[0].querySelector(".adm-nota")?.textContent).toBe("Sin regla");
  expect(filas[1].querySelector(".adm-chip")?.textContent).toBe("Parecida a fcf");
  expect(filas[2].querySelector(".adm-chip")).toBeNull();
  const movil = div.querySelector(".adm-intenciones-movil")!;
  const lista = movil.querySelectorAll(".adm-fila");
  expect(lista).toHaveLength(3);
  for (const [i, texto] of ["empresas sostenibles", "vacas lecheras", "rentabilidad"].entries()) {
    expect(lista[i].firstElementChild?.textContent).toContain(texto);
    expect(lista[i].querySelector(".adm-nota time")?.getAttribute("dateTime")).toBe(ultima);
  }
  expect(Array.from(movil.querySelectorAll(".num"), cuenta => cuenta.textContent)).toEqual(["1234", "12", "3"]);
  expect(lista[0].querySelector(".adm-fila-extra .adm-nota")?.textContent).toBe("Sin regla");
  expect(lista[1].querySelector(".adm-chip")?.textContent).toBe("Parecida a fcf");
  expect(lista[2].querySelector(".adm-fila-extra")?.textContent).toBe("3roe");
  expect(lista[2].querySelector(".adm-chip")).toBeNull();
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

it("despliega las ocho intenciones y vuelve a cinco", async () => {
  const div = await montar(Array.from({ length: 8 }, (_, i) => ({ intencion: `Intención ${i}`, recuento: i, tipo: "no_disponible", regla: null, ultima: "2026-01-02T12:00:00Z", primera: "2026-01-01T12:00:00Z" })));
  expect(div.querySelectorAll(".adm-intenciones-escritorio tbody tr")).toHaveLength(5);
  expect(div.querySelectorAll(".adm-intenciones-movil .adm-fila")).toHaveLength(5);
  const boton = div.querySelector("button")!;
  expect(boton.textContent).toBe("Ver 3 más");
  await act(async () => boton.click());
  expect(div.querySelectorAll(".adm-intenciones-escritorio tbody tr")).toHaveLength(8);
  expect(div.querySelectorAll(".adm-intenciones-movil .adm-fila")).toHaveLength(8);
  expect(boton.textContent).toBe("Ver menos");
  await act(async () => boton.click());
  expect(div.querySelectorAll(".adm-intenciones-escritorio tbody tr")).toHaveLength(5);
  expect(div.querySelectorAll(".adm-intenciones-movil .adm-fila")).toHaveLength(5);
});
