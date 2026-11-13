// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ficha } from "@/lib/liga/api";
import { ResultadosFicha } from "./ResultadosFicha";

vi.mock("next-intl", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-intl")>();
  const [strategies, league] = await Promise.all([
    import("../../../../../messages/es/strategies.json"), import("../../../../../messages/es/league.json"),
  ]);
  const t = original.createTranslator({ locale: "es", messages: { ...league.default, ...strategies.default } });
  return { ...original, useTranslations: () => t, useLocale: () => "es" };
});
vi.mock("next/link", () => ({ default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });

const serie = Array.from({ length: 30 }, (_, k) => ({
  dia: `2026-10-${String(k + 1).padStart(2, "0")}`, estrategia: k * 0.5, sp500: k * 0.2, provisional: false,
}));

const base = {
  id: "e1", nombre: "Foso", casa: null, autor: "Ana", estado: "jugando", visibilidad: "publicada", es_dueno: false,
  escudo: { forma: "escudo", dibujo: "liso", color1: "#0B6E68" },
  receta: null, posiciones: [{ ticker: "AAA", peso: 40 }, { ticker: "BBB", peso: 35 }],
  jornadas: [
    { numero: 1, jornada_total: 4, rentabilidad: 2, puntos: 1, sp500: 1 },
    { numero: 2, jornada_total: 4, rentabilidad: -1, puntos: 0, sp500: 0.9 },
    { numero: 3, jornada_total: 4, rentabilidad: 1.1, puntos: 1, sp500: 1 },
    { numero: 4, jornada_total: 4, rentabilidad: null, puntos: null, sp500: null },
  ],
  mercado: { desde: "2026-11-09", dia: "2026-11-10", consultado: null, en_vivo: false, rentabilidad: 0.5, sp500: 0.1, diferencia: 0.4, empresas: {} },
  rendimiento: {
    estado: "disponible", metodologia: "Metodología de prueba.", oficial_hasta: null, provisional_hasta: null, serie,
    metricas: { sharpe: 1.234, sortino: 2.5, volatilidad: 0.123, max_drawdown: -0.05, observaciones: 29 },
  },
} as unknown as Ficha;

let root: Root;
let div: HTMLDivElement;
beforeEach(() => { div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div); });
afterEach(() => { act(() => root.unmount()); div.remove(); });

const pintar = (cambios: Partial<Ficha> = {}) => act(() => root.render(<ResultadosFicha ficha={{ ...base, ...cambios }} />));
const filas = () => Array.from(div.querySelectorAll(".lv-lista .lv-fila"));
const pildoras = () => filas().map((f) => f.querySelector(".lv-pildora") as HTMLButtonElement);
const nbsp = " ";

describe("ResultadosFicha", () => {
  it("enseña los datos clave con sus valores", () => {
    pintar();
    const datos = Array.from(div.querySelectorAll(".fi-datos > div"), (d) => [d.querySelector("span")!.textContent, d.querySelector("b")!.textContent]);
    expect(datos).toEqual([
      ["Total", `+14,5${nbsp}%`], ["S&P", `+5,8${nbsp}%`], ["Volatilidad", `12,3${nbsp}%`], ["Caída máx.", `−5,0${nbsp}%`],
      ["Sharpe", "1,23"], ["Sortino", "2,50"], ["Posiciones", "2"], ["Mayor peso", `40,0${nbsp}%`],
    ]);
    expect(div.textContent).toContain("Con dividendos. Efectivo 25,0 %.");
    expect(div.textContent).toContain("Metodología de prueba.");
  });

  it("avisa de las pocas observaciones y no cuando hay suficientes", () => {
    pintar();
    expect(div.textContent).toContain("Sharpe y Sortino con 29 cierres; son fiables desde 60.");
    pintar({ rendimiento: { ...base.rendimiento!, metricas: { ...base.rendimiento!.metricas!, observaciones: 80 } } });
    expect(div.textContent).not.toContain("son fiables desde");
  });

  it("lista las jornadas de la más reciente a la más antigua con la en juego arriba", () => {
    pintar();
    expect(filas().map((f) => f.querySelector("b")!.textContent)).toEqual(["Jornada 4", "Jornada 3", "Jornada 2", "Jornada 1"]);
    expect(filas()[0].querySelector("small")!.textContent).toBe("En juego · cierra el viernes");
    expect(div.querySelector(".lv-lista-cab")!.textContent).toContain("3 jornadas · 2 puntos");
  });

  it("cambia el dato de toda la lista al tocar una píldora, con color por la banda de 0,2", () => {
    pintar();
    expect(pildoras().map((p) => [p.textContent, p.className])).toEqual([
      ["+0,4", "lv-pildora bien"], ["+0,1", "lv-pildora"], ["−1,9", "lv-pildora mal"], ["+1,0", "lv-pildora bien"],
    ]);
    act(() => pildoras()[1].click());
    expect(div.querySelector(".lv-lista-cab b")!.textContent).toBe("Rentabilidad");
    expect(pildoras().map((p) => [p.textContent, p.className])).toEqual([
      [`+0,5${nbsp}%`, "lv-pildora bien"], [`+1,1${nbsp}%`, "lv-pildora"], [`−1,0${nbsp}%`, "lv-pildora mal"], [`+2,0${nbsp}%`, "lv-pildora bien"],
    ]);
    act(() => pildoras()[0].click());
    expect(div.querySelector(".lv-lista-cab b")!.textContent).toBe("Puntos");
    expect(pildoras().map((p) => [p.textContent, p.className])).toEqual([
      ["–", "lv-pildora"], ["1 pts", "lv-pildora"], ["0 pts", "lv-pildora"], ["1 pts", "lv-pildora"],
    ]);
  });

  it("sin S&P de la jornada la píldora vs no lleva color", () => {
    pintar({ jornadas: [{ numero: 1, jornada_total: 4, rentabilidad: 2, puntos: 1, sp500: null }], mercado: null });
    expect(pildoras()[0].textContent).toBe("-");
    expect(pildoras()[0].className).toBe("lv-pildora");
  });

  it("privado: avisa y mantiene las jornadas", () => {
    pintar({ rendimiento: { ...base.rendimiento!, estado: "privado", serie: [] } });
    expect(div.textContent).toContain("La serie diaria es para su dueño");
    expect(div.querySelector(".fi-datos")).toBeNull();
    expect(filas().length).toBe(4);
  });

  it("sin datos: avisa y mantiene las jornadas", () => {
    pintar({ rendimiento: { ...base.rendimiento!, estado: "sin_datos", serie: [], metricas: null } });
    expect(div.textContent).toContain("Aún no hay una base de cierres completa");
    expect(filas().length).toBe(4);
  });

  it("enlaza a la clasificación y avisa si no es de la casa", () => {
    pintar();
    expect(div.querySelector("a.fi-celda")!.getAttribute("href")).toBe("/liga?vista=tabla");
    expect(div.querySelector("p.lv-pie:last-of-type")!.textContent).toContain("No es una recomendación");
    pintar({ casa: "alpha" });
    expect(div.textContent).not.toContain("No es una recomendación");
  });
});
