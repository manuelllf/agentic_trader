// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import mensajes from "../../../../messages/es/league.json";
import type { ActividadItem } from "@/lib/liga/api";
import { Actividad } from "./Actividad";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let contenedor: HTMLDivElement;

afterEach(() => {
  if (root) act(() => root.unmount());
  contenedor?.remove();
});

function montar(items: ActividadItem[]) {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  root = createRoot(contenedor);
  act(() => root.render(<NextIntlClientProvider locale="es" messages={mensajes}>
    <Actividad items={items} />
  </NextIntlClientProvider>));
}

const cambio: ActividadItem = {
  tipo: "cambio", dia: "2026-10-30", equipo: "Mi estrategia", autor: "ana",
  entradas: ["NVDA"], salidas: ["XOM"], saltos: null,
};

describe("Actividad", () => {
  it("muestra el equipo y los tickers que salen y entran", () => {
    montar([cambio]);
    expect(contenedor.textContent).toContain("Mi estrategia cambió XOM por NVDA.");
    expect(contenedor.querySelector("li b")?.textContent).toBe("Mi estrategia");
  });

  it("muestra los saltos con singular y plural", () => {
    montar([1, -2].map(saltos => ({ ...cambio, tipo: "puesto", entradas: [], salidas: [], saltos })));
    const filas = contenedor.querySelectorAll("li");
    expect(filas[0].textContent).toContain("sube 1 puesto");
    expect(filas[1].textContent).toContain("baja 2 puestos");
  });

  it("muestra el título del estado vacío", () => {
    montar([]);
    expect(contenedor.querySelector("h2")?.textContent).toBe(mensajes.actividad_vacia_titulo);
  });
});
