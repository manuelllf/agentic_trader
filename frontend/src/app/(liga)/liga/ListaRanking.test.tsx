// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListaRanking, type FilaRanking } from "./ListaRanking";

vi.mock("next-intl", async () => {
  const [common, league, strategies] = await Promise.all([
    import("../../../../messages/es/common.json"), import("../../../../messages/es/league.json"),
    import("../../../../messages/es/strategies.json"),
  ]);
  const catalogo = { ...common.default, ...league.default, ...strategies.default } as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (catalogo[key] ?? key).replace(/\{(\w+)\}/g, (_, nombre: string) => String(values?.[nombre] ?? `{${nombre}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});

const escudo = { forma: "circulo" as const, dibujo: "liso" as const, color1: "#0B6E68", color2: null, iniciales: null };
const fila = (clave: string, nombre: string, vs: number, rentabilidad: number, puntos: number): FilaRanking => ({
  clave, puesto: 1, nombre, sub: "Comunidad", escudo, serie: [0, 1, rentabilidad], vs, rentabilidad, puntos,
  onAbrir: () => {},
});
const modos = {
  vs: "vs S&P", rent: "Rentabilidad", pts: "Puntos",
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const pintar = (entradas: Parameters<typeof ListaRanking>[0]["entradas"], modosVisibles: ("vs" | "rent" | "pts")[]) => {
  act(() => {
    root.render(<ListaRanking cabecera="Temporada" modos={modosVisibles} etiquetas={modos} entradas={entradas} />);
  });
};
const pildoras = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button.lv-pildora"));
const cabecera = () => container.querySelector(".lv-lista-cab b")?.textContent;

describe("ListaRanking", () => {
  it("la píldora cambia el dato de toda la lista a la vez y la cabecera dice cuál es", () => {
    pintar([fila("a", "Alpha", 2.1, 6.2, 14), fila("b", "Lambda", -0.6, 2.9, 11)], ["vs", "rent"]);
    expect(pildoras().map((b) => b.textContent)).toEqual(["+2,1", "−0,6"]);
    expect(cabecera()).toBe("vs S&P");

    act(() => pildoras()[0].click());

    const rentabilidades = pildoras().map((b) => b.textContent ?? "");
    expect(rentabilidades[0]).toMatch(/^\+6,2\s%$/);
    expect(rentabilidades[1]).toMatch(/^\+2,9\s%$/);
    expect(cabecera()).toBe("Rentabilidad");
  });

  it("con puntos, la tercera vuelta enseña los puntos y vuelve a la diferencia", () => {
    pintar([fila("a", "Alpha", 2.1, 6.2, 14)], ["vs", "rent", "pts"]);
    act(() => pildoras()[0].click());
    act(() => pildoras()[0].click());
    expect(pildoras()[0].textContent).toBe("14 pts");
    expect(pildoras()[0].className).not.toContain("bien");
    expect(cabecera()).toBe("Puntos");

    act(() => pildoras()[0].click());
    expect(pildoras()[0].textContent).toBe("+2,1");
  });

  it("el color sigue el resultado: verde si gana, rojo si pierde, neutro dentro de la banda", () => {
    pintar([
      fila("g", "Gana", 0.3, 1, 0),
      fila("e", "Empata", 0.2, 1, 0),
      fila("p", "Pierde", -0.3, 1, 0),
    ], ["vs"]);
    expect(pildoras().map((b) => b.className)).toEqual(["lv-pildora bien", "lv-pildora", "lv-pildora mal"]);
  });

  it("los huecos entre filas se pintan como texto y no como botones", () => {
    pintar([fila("a", "Alpha", 2.1, 6.2, 14), { hueco: "y 103 más" }], ["vs", "rent"]);
    expect(container.querySelector("li.lv-hueco")?.textContent).toBe("y 103 más");
    expect(pildoras()).toHaveLength(1);
  });
});
