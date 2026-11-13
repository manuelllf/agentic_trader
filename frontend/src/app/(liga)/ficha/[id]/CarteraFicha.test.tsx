// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import type { Ficha } from "@/lib/liga/api";
import type { EvidenciaFormacion } from "@/lib/liga/evidencia";
import builder from "../../../../../messages/es/builder.json";
import league from "../../../../../messages/es/league.json";
import strategies from "../../../../../messages/es/strategies.json";
import { CarteraFicha } from "./CarteraFicha";

vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/lib/liga/cache", () => ({ useCache: () => ({ datos: undefined, cargando: false, fallo: false, refrescar: vi.fn() }) }));
vi.mock("@/lib/liga/api", async (importOriginal) => ({ ...(await importOriginal<object>()), getNotasEmpresa: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };

const mensajes = { ...strategies, ...league, ...builder };
let raiz: Root | undefined;
let contenedor: HTMLDivElement | undefined;
afterEach(() => {
  if (raiz) act(() => raiz!.unmount());
  raiz = undefined; contenedor?.remove(); contenedor = undefined;
});

function pintar(ficha: Ficha, nuevas: string[] = []): HTMLDivElement {
  contenedor = document.createElement("div");
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz!.render(<NextIntlClientProvider locale="es" messages={mensajes}><CarteraFicha ficha={ficha} nuevas={nuevas} /></NextIntlClientProvider>));
  return contenedor;
}

const rend = (diff: number | null) => ({
  estado: "disponible" as const, desde: "2026-10-31", hasta: "2026-11-13", rentabilidad_pct: 4, sp500_pct: 2,
  diferencia_pp: diff, incompleta: false,
});
const regla = (cumple: boolean | null) => [{ clave: "deuda", titulo: "Deuda baja", cumple, motivo: null }];

function evidencia(extra: Partial<EvidenciaFormacion> = {}): EvidenciaFormacion {
  return {
    formacion: {
      inscripcion_id: 1, jornada_id: 1, jornada_numero: 7, jornada_total: 12, desde: "2026-10-31", hasta: "2026-11-27",
      metodo: "seleccion", receta_id: 1, receta_vigente: true, estado_foto: "disponible", estado_reglas: "disponible",
      idea: "Empresas sólidas", pregunta: null, pesos: { negocio: 3, precio: 1 }, reglas: [{ clave: "deuda", titulo: "Deuda baja", detalle: "máx. 2" }],
      n_empresas: 5, reparto: "igual", max_por_sector: null,
    },
    posiciones: [
      { ticker: "AAA", peso: 60, origen: "seleccion", reglas: regla(true), rendimiento: rend(2) },
      { ticker: "BBB", peso: 40, origen: "mantenida", reglas: regla(true), rendimiento: rend(-1) },
    ],
    cambios: null,
    ...extra,
  };
}

function base(extra: Partial<Ficha> = {}): Ficha {
  return {
    id: "e1", nombre: "Foso", escudo: { forma: "escudo", dibujo: "liso", color1: "#0B6E68", color2: null, iniciales: null },
    casa: null, autor: "Ana", estado: "jugando", visibilidad: "publicada", es_dueno: false, jornadas: [], receta: null,
    posiciones: [
      { ticker: "AAA", peso: 60 }, { ticker: "BBB", peso: 40 },
    ],
    rendimiento: {
      estado: "disponible", metodologia: "x", oficial_hasta: null, provisional_hasta: null, serie: [], metricas: null,
      evidencia: evidencia(),
    },
    mercado: {
      desde: "2026-10-31", dia: "2026-11-13", consultado: "2026-11-13T15:05:00Z", en_vivo: true, rentabilidad: 1.5, sp500: 1, diferencia: 0.5,
      empresas: { AAA: { precio: 498.12, rentabilidad: 3, dia: "2026-11-13" }, BBB: { precio: 10, rentabilidad: 0.5, dia: "2026-11-13" } },
    },
    ...extra,
  };
}

it("cambia el dato de toda la lista con la píldora y conserva la clase por resultado", () => {
  const c = pintar(base());
  const pildoras = () => Array.from(c.querySelectorAll<HTMLButtonElement>(".lv-pildora"));
  expect(c.querySelector(".lv-lista-cab")?.textContent).toContain("1 por encima del S&P");
  expect(c.querySelector(".lv-lista-cab b")?.textContent).toBe("Semana");
  expect(pildoras().map((p) => p.className)).toEqual(["lv-pildora bien", "lv-pildora mal"]);
  expect(pildoras()[0].getAttribute("aria-label")).toBe(`${pildoras()[0].textContent}, Cambiar dato`);
  expect(c.querySelector(".lv-nombre small")?.textContent).toBe("60,0 % · 498,12 $");
  act(() => pildoras()[0].click());
  expect(c.querySelector(".lv-lista-cab b")?.textContent).toBe("Peso");
  expect(pildoras().map((p) => p.textContent)).toEqual(["60,0 %", "40,0 %"]);
  expect(pildoras().every((p) => p.className === "lv-pildora")).toBe(true);
  act(() => pildoras()[0].click());
  expect(c.querySelector(".lv-lista-cab b")?.textContent).toBe("vs S&P");
  expect(pildoras().map((p) => p.textContent)).toEqual(["+2,0", "−1,0"]);
  expect(pildoras().map((p) => p.className)).toEqual(["lv-pildora bien", "lv-pildora mal"]);
  act(() => pildoras()[0].click());
  expect(c.querySelector(".lv-lista-cab b")?.textContent).toBe("Semana");
});

it("marca la empresa nueva en lugar de su subtítulo", () => {
  const c = pintar(base(), ["BBB"]);
  const filas = c.querySelectorAll(".lv-fila");
  expect(filas[1].querySelector("small")?.className).toBe("nuevo");
  expect(filas[1].querySelector("small")?.textContent).toBe("Nueva en tu cartera");
  expect(filas[0].querySelector("small")?.className).toBe("");
});

it("enseña el estado vacío cuando la cartera es privada", () => {
  const c = pintar(base({ posiciones: [], rendimiento: { estado: "privado", metodologia: "x", oficial_hasta: null, provisional_hasta: null, serie: [], metricas: null } }));
  expect(c.querySelector(".fi-vacio h2")?.textContent).toBe("Su cartera es privada");
  expect(c.querySelector(".fi-vacio svg")).not.toBeNull();
  expect(c.querySelector(".lv-lista")).toBeNull();
});

it("en Omega el tercer dato es desde la entrada y no lleva color", () => {
  const c = pintar(base({
    casa: "omega", rendimiento: null,
    posiciones: [{ ticker: "AAA", peso: 20, precio: 11, retorno: 12.5, entrada_dia: "2026-11-04", entrada_precio: 9.8 }],
  }));
  expect(c.querySelector(".lv-lista-cab")?.textContent).toContain("cambia durante el mes");
  const pildora = c.querySelector<HTMLButtonElement>(".lv-pildora")!;
  act(() => pildora.click());
  act(() => pildora.click());
  expect(c.querySelector(".lv-lista-cab b")?.textContent).toBe("Desde la entrada");
  expect(pildora.textContent).toBe("+12,5 %");
  expect(pildora.className).toBe("lv-pildora");
  expect(c.querySelector(".lv-pie")?.textContent).not.toContain("recomendación");
});

it("lista los cambios con el motivo de la primera regla que falla", () => {
  const c = pintar(base({
    rendimiento: {
      estado: "disponible", metodologia: "x", oficial_hasta: null, provisional_hasta: null, serie: [], metricas: null,
      evidencia: evidencia({ cambios: {
        desde_inscripcion_id: 0, metodologia_cambio: false, entradas: ["CCC"],
        salidas: [
          { ticker: "DDD", causa: "regla_no_cumplida", reglas: regla(false) },
          { ticker: "EEE", causa: "sigue_elegible_sin_entrar", reglas: [] },
        ],
      } }),
    },
  }));
  expect(c.querySelector(".fi-cab-grupo")?.textContent).toMatch(/^Cambios del 31 oct/);
  const celdas = Array.from(c.querySelectorAll(".fi-grupo .fi-celda .t")).map((x) => x.textContent);
  expect(celdas).toEqual(["CCCEntra", "DDDSale · No cumple «Deuda baja»", "EEESale · Sigue siendo elegible, pero no entra en la nueva cartera."]);
  expect(c.querySelector(".lv-pie")?.textContent).toContain("Estrategia de un usuario");
});

it("con la receta no vigente avisa y abre el método histórico en una hoja", () => {
  const ev = evidencia();
  ev.formacion.receta_vigente = false;
  ev.formacion.estado_foto = "sin_datos";
  const c = pintar(base({ rendimiento: { estado: "disponible", metodologia: "x", oficial_hasta: null, provisional_hasta: null, serie: [], metricas: null, evidencia: ev } }));
  expect(Array.from(c.querySelectorAll(".fi-pie-grupo")).map((x) => x.textContent).join("|"))
    .toContain("La metodología guardada cambió después");
  const boton = Array.from(c.querySelectorAll<HTMLButtonElement>("button.fi-celda")).find((b) => b.textContent === "Método con el que se formó")!;
  act(() => boton.click());
  const dialogo = Array.from(c.querySelectorAll("dialog")).find((d) => d.open)!;
  expect(dialogo.textContent).toContain("Empresas sólidas");
  expect(dialogo.textContent).toContain("máx. 2");
  expect(dialogo.textContent).toContain("El negocio");
  expect(dialogo.textContent).toContain("75");
});

it("abre la hoja de la empresa al tocar su fila", () => {
  const c = pintar(base());
  act(() => c.querySelector<HTMLButtonElement>(".lv-fila-abre")!.click());
  const dialogo = Array.from(c.querySelectorAll("dialog")).find((d) => d.open)!;
  expect(dialogo.querySelector("h2")?.textContent).toBe("AAA");
});
