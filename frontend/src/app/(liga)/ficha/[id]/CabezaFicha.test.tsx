// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ficha, JornadaFicha } from "@/lib/liga/api";
import { CabezaFicha } from "./CabezaFicha";

vi.mock("next-intl", async (importOriginal) => {
  const real = await importOriginal<typeof import("next-intl")>();
  const estrategias = await import("../../../../../messages/es/strategies.json");
  const catalogo = estrategias.default as Record<string, string>;
  const t = Object.assign(
    (key: string, values?: Record<string, string | number>) =>
      (catalogo[key] ?? key).replace(/\{(\w+)\}/g, (_, nombre: string) => String(values?.[nombre] ?? `{${nombre}}`)),
    {
      rich: (key: string, values: Record<string, unknown>) => {
        const [antes, resto] = (catalogo[key] ?? key).split("<dif>");
        const [dentro, despues] = resto.split("</dif>");
        const sub = (s: string) => s.replace(/\{(\w+)\}/g, (_, n: string) => String(values[n]));
        return <>{sub(antes)}{(values.dif as (c: ReactNode) => ReactNode)(sub(dentro))}{sub(despues)}</>;
      },
    },
  );
  return { ...real, useTranslations: () => t, useLocale: () => "es" };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let div: HTMLDivElement;
beforeEach(() => { div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div); });
afterEach(() => { act(() => root.unmount()); div.remove(); });

const jornada = (numero: number, rentabilidad: number | null, sp500: number | null): JornadaFicha =>
  ({ numero, jornada_total: 12, rentabilidad, puntos: null, sp500 });
const base = {
  id: "e1", nombre: "Dividendo", escudo: { forma: "escudo", dibujo: "liso", color1: "#0B6E68" }, casa: null, autor: "ana",
  estado: "jugando", visibilidad: "publicada", es_dueno: false, jornadas: [], receta: null, posiciones: [],
} as unknown as Ficha;
const mercado = (rentabilidad: number | null, sp500: number | null, diferencia: number | null) =>
  ({ desde: "", dia: "", consultado: null, en_vivo: true, rentabilidad, sp500, diferencia, empresas: {} });

function pintar(cambios: Partial<Ficha>) {
  act(() => root.render(<CabezaFicha ficha={{ ...base, ...cambios }} />));
}
const sub = () => div.querySelector(".fi-cabeza p")?.textContent;
const marca = () => div.querySelector(".fi-cifra p span");

describe("CabezaFicha", () => {
  it("el subtítulo depende de casa, dueño y autor", () => {
    pintar({ casa: "alpha" });
    expect(sub()).toBe("De la casa");
    pintar({ casa: null, es_dueno: true });
    expect(sub()).toBe("La tuya");
    pintar({ es_dueno: false });
    expect(sub()).toBe("De ana");
    pintar({ autor: null });
    expect(sub()).toBe("Estrategia retirada");
  });

  it("la semana en curso enseña la cifra y pinta de bien la ventaja sobre el S&P", () => {
    pintar({ jornadas: [jornada(2, 1, 0.5), jornada(3, null, null)], mercado: mercado(2.5, 1, 1.5) });
    expect(div.querySelector(".fi-cifra small")?.textContent).toBe("Esta semana · jornada 3 de 12");
    expect(div.querySelector(".fi-cifra b")?.textContent).toBe("+2,5 %");
    expect(marca()?.className).toBe("bien-t");
    expect(marca()?.textContent).toBe("+1,5 pp");
    expect(div.querySelector(".fi-cifra p")?.textContent).toContain("que va +1,0 %");
  });

  it("detrás del S&P sale mal-t y dentro de la banda igual-t", () => {
    pintar({ jornadas: [jornada(1, null, null)], mercado: mercado(0, 1, -1) });
    expect(marca()?.className).toBe("mal-t");
    pintar({ jornadas: [jornada(1, null, null)], mercado: mercado(1.1, 1, 0.1) });
    expect(marca()?.className).toBe("igual-t");
  });

  it("sin diferencia en el mercado la calcula con el S&P", () => {
    pintar({ jornadas: [jornada(1, null, null)], mercado: mercado(3, 1, null) });
    expect(marca()?.textContent).toBe("+2,0 pp");
  });

  it("sin mercado cae a la última jornada con rentabilidad", () => {
    pintar({ jornadas: [jornada(1, 4, 1), jornada(2, -2, 1), jornada(3, null, null)] });
    expect(div.querySelector(".fi-cifra small")?.textContent).toBe("Última jornada · jornada 2 de 12");
    expect(div.querySelector(".fi-cifra b")?.textContent).toBe("−2,0 %");
    expect(marca()?.className).toBe("mal-t");
    expect(marca()?.textContent).toBe("−3,0 pp");
  });

  it("sin S&P no pinta la línea de comparación", () => {
    pintar({ jornadas: [jornada(1, 4, null)] });
    expect(div.querySelector(".fi-cifra b")).not.toBeNull();
    expect(div.querySelector(".fi-cifra p")).toBeNull();
  });

  it("sin nada que enseñar no pinta la cifra", () => {
    pintar({ jornadas: [jornada(1, null, null)] });
    expect(div.querySelector(".fi-cifra")).toBeNull();
    expect(div.querySelector(".fi-cabeza h1")?.textContent).toBe("Dividendo");
  });
});
