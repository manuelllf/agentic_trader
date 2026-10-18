// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import type { Posicion } from "@/lib/liga/api";
import { fecha, porcentaje } from "@/lib/liga/format";
import mensajes from "../../../../../messages/es/strategies.json";
import { CarteraOmega } from "./CarteraOmega";
import { NotasEmpresa } from "./NotasEmpresa";

vi.mock("./NotasEmpresa", () => ({ NotasEmpresa: vi.fn(() => null) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function () { this.open = false; };
}
const t = createTranslator({ locale: "es", messages: mensajes });
const posiciones: Posicion[] = [
  { ticker: "ABIERTA", peso: 20, numero: 1, entrada_dia: "2026-09-01", entrada_precio: 9.57, precio: 9.1, retorno: -4.9 },
  { ticker: "CERRADA", peso: 20, numero: 2, entrada_dia: "2026-09-02", entrada_precio: 10, salida_dia: "2026-09-10", salida_precio: 10.2, precio: 10.2, retorno: 2 },
];
let raiz: Root | undefined;
let contenedor: HTMLDivElement | undefined;

afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined;
  contenedor?.remove();
  contenedor = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function cartera() {
  return <NextIntlClientProvider locale="es" messages={mensajes}>
    <CarteraOmega posiciones={posiciones} />
  </NextIntlClientProvider>;
}

it("muestra la cabecera desde la entrada y los dos huecos con sus precios y retornos", () => {
  const salida = renderToStaticMarkup(cartera());
  expect(salida).toContain(t("strategies_col_since_entry"));
  for (const posicion of posiciones) {
    expect(salida).toContain(posicion.ticker);
    expect(salida).toContain(posicion.precio!.toLocaleString("es"));
    expect(salida).toContain(porcentaje(posicion.retorno!, 1, "es"));
  }
});

it("abre el hueco cerrado con su salida y sin notas de empresa", () => {
  // jsdom no reproduce la capa modal nativa; estas funciones simulan su apertura y cierre.
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz!.render(cartera()));
  const fila = Array.from(contenedor.querySelectorAll<HTMLButtonElement>(".cartera-fila"))
    .find(boton => boton.textContent?.includes("CERRADA"));
  expect(fila).toBeDefined();
  act(() => fila!.click());
  const dialogo = contenedor.querySelector("dialog")!;
  expect(dialogo.open).toBe(true);
  expect(dialogo.querySelector("h2")?.textContent).toBe("CERRADA");
  expect(dialogo.textContent).toContain(t("strategies_omega_exit_line", {
    date: fecha("2026-09-10", undefined, "es"), price: (10.2).toLocaleString("es"),
  }));
  expect(dialogo.querySelector(`[aria-label="${t("strategies_company_notes")}"]`)).toBeNull();
  expect(NotasEmpresa).not.toHaveBeenCalled();
  act(() => dialogo.querySelector<HTMLButtonElement>(".lecturas-cerrar")!.click());
  expect(dialogo.open).toBe(false);
});
