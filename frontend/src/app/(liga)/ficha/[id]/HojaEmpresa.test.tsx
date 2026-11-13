// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import type { Ficha } from "@/lib/liga/api";
import builder from "../../../../../messages/es/builder.json";
import league from "../../../../../messages/es/league.json";
import strategies from "../../../../../messages/es/strategies.json";
import { HojaEmpresa } from "./HojaEmpresa";

const estado = vi.hoisted(() => ({ notas: undefined as unknown }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/lib/liga/cache", () => ({
  useCache: (clave: string | null) => ({ datos: clave ? estado.notas : undefined, cargando: false, fallo: false, refrescar: vi.fn() }),
}));
vi.mock("@/lib/liga/api", async (importOriginal) => ({ ...(await importOriginal<object>()), getNotasEmpresa: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };

const mensajes = { ...strategies, ...league, ...builder };
let raiz: Root | undefined;
let contenedor: HTMLDivElement | undefined;
afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined; contenedor?.remove(); contenedor = undefined; estado.notas = undefined;
});

function pintar(ficha: Ficha, ticker: string | null = "AAA", onCerrar = vi.fn()): HTMLDivElement {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}><HojaEmpresa ficha={ficha} ticker={ticker} onCerrar={onCerrar} /></NextIntlClientProvider>));
  return contenedor;
}

const reglas = [
  { clave: "deuda", titulo: "Deuda baja", cumple: true, motivo: null },
  { clave: "roe", titulo: "ROE alto", cumple: false, motivo: null },
  { clave: "beta", titulo: "Beta", cumple: null, motivo: null },
];

function base(extra: Partial<Ficha> = {}): Ficha {
  return {
    id: "e1", nombre: "Foso", escudo: { forma: "escudo", dibujo: "liso", color1: "#0B6E68", color2: null, iniciales: null },
    casa: null, autor: "Ana", estado: "jugando", visibilidad: "publicada", es_dueno: false, jornadas: [], receta: null,
    posiciones: [{ ticker: "AAA", peso: 22 }],
    rendimiento: {
      estado: "disponible", metodologia: "x", oficial_hasta: null, provisional_hasta: null, serie: [], metricas: null,
      evidencia: {
        formacion: {
          inscripcion_id: 1, jornada_id: 1, jornada_numero: 7, jornada_total: 12, desde: "2026-10-31", hasta: "2026-11-27",
          metodo: "seleccion", receta_id: 1, receta_vigente: true, estado_foto: "disponible", estado_reglas: "disponible",
          idea: null, pregunta: null, pesos: null, reglas: [], n_empresas: 5, reparto: "igual", max_por_sector: null,
        },
        posiciones: [{
          ticker: "AAA", peso: 22, origen: "mantenida", reglas,
          rendimiento: { estado: "disponible", desde: "2026-10-31", hasta: "2026-11-13", rentabilidad_pct: 4, sp500_pct: 2, diferencia_pp: 2, incompleta: true },
        }],
        cambios: null,
      },
    },
    mercado: {
      desde: "2026-10-31", dia: "2026-11-13", consultado: null, en_vivo: true, rentabilidad: 1.5, sp500: 1, diferencia: 0.5,
      empresas: { AAA: { precio: 498.12, rentabilidad: 3, dia: "2026-11-13" } },
    },
    ...extra,
  };
}

it("enseña la semana, la fila Entró, las notas y las reglas de la posición", () => {
  estado.notas = { ticker: "AAA", jornada: 7, jornada_total: 12, dia: "2026-10-31", notas: { negocio: "8", precio: "5", deuda: "7", pronto: "4" } };
  const c = pintar(base());
  expect(c.querySelector("h2")?.textContent).toBe("AAA");
  expect(c.querySelector(".fi-cifra b")?.textContent).toBe("+3,0 %");
  expect(c.querySelector(".fi-cifra .bien-t")?.textContent).toBe("+2,0 pp");
  const celdas = Array.from(c.querySelectorAll(".fi-grupo")[0].querySelectorAll(".fi-celda")).map((x) => x.textContent);
  expect(celdas).toEqual(["Precio498,12 $", "Peso22,0 %", "Desde la formación+4,0 % · S&P +2,0 %", "EntróAntes de la jornada 7"]);
  const nota = c.querySelector(".fi-nota")!;
  expect(nota.textContent).toContain("El negocio");
  expect(nota.querySelector(".valor b")?.textContent).toBe("8");
  expect(nota.querySelectorAll(".esc i.on")).toHaveLength(8);
  expect(nota.querySelectorAll(".esc i")).toHaveLength(9);
  expect(c.querySelector("a.fi-celda.enlace")?.getAttribute("href")).toBe("/como-funciona");
  expect(c.textContent).toContain("Foto del 31 oct, jornada 7 de 12.");
  const textos = Array.from(c.querySelectorAll(".fi-grupo")).pop()!.textContent;
  expect(textos).toContain("Deuda bajaCumple");
  expect(textos).toContain("ROE altoNo cumple");
  expect(textos).toContain("BetaSin dato");
  expect(c.textContent).toContain("Se mantuvo de la cartera anterior. Cumple 1 de 3 reglas en la foto.");
  expect(c.textContent).toContain("Hay cierres intermedios ausentes");
});

it("sin notas guardadas dice que esa jornada no las guardó", () => {
  estado.notas = { ticker: "AAA", jornada: 7, jornada_total: 12, dia: "2026-10-31", notas: null };
  const c = pintar(base());
  expect(c.querySelector(".fi-nota")).toBeNull();
  expect(c.textContent).toContain("Esa jornada no guardó las notas de las empresas.");
});

it("en Omega muestra la entrada y la salida, sin notas ni reglas", () => {
  estado.notas = { ticker: "AAA", jornada: 7, jornada_total: 12, dia: "2026-10-31", notas: { negocio: "8" } };
  const c = pintar(base({
    casa: "omega", rendimiento: null,
    posiciones: [{ ticker: "AAA", peso: 20, precio: 11, retorno: 12.5, entrada_dia: "2026-11-04", entrada_precio: 9.8, salida_dia: "2026-11-10", salida_precio: 11.2 }],
  }));
  const celdas = Array.from(c.querySelectorAll(".fi-grupo")[0].querySelectorAll(".fi-celda")).map((x) => x.textContent);
  expect(celdas).toContain("Desde la entrada+12,5 %");
  expect(celdas).toContain("Entró4 nov a 9,80 $");
  expect(c.textContent).toContain("Salió el 10 nov a 11,20 $");
  expect(c.querySelector(".fi-nota")).toBeNull();
  expect(c.textContent).not.toContain("Reglas");
});

it("sin ticker la hoja está cerrada y Listo la cierra", () => {
  const cerrar = vi.fn();
  const c = pintar(base(), "AAA", cerrar);
  const listo = Array.from(c.querySelectorAll<HTMLButtonElement>(".hoja-liga-acc")).find((b) => b.textContent === "Listo")!;
  act(() => listo.click());
  expect(cerrar).toHaveBeenCalled();
});
