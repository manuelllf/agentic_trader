import { describe, expect, it } from "vitest";
import { IDEAS, MESES, SP, puntos, puntosTotales, tablaDe } from "./ideas";

describe("portada: ideas de ejemplo", () => {
  it("la regla de puntos es la de la liga: más de medio punto gana, menos de medio pierde", () => {
    expect(puntos(3.5, 3.0)).toBe(1); // justo medio punto: empate
    expect(puntos(3.6, 3.0)).toBe(3);
    expect(puntos(2.5, 3.0)).toBe(1);
    expect(puntos(2.4, 3.0)).toBe(0);
  });

  it("cada idea tiene seis meses, cinco empresas y sus pesos suman 100", () => {
    for (const idea of IDEAS) {
      expect(idea.tu).toHaveLength(MESES.length);
      expect(SP).toHaveLength(MESES.length);
      expect(idea.empresas).toHaveLength(5);
      expect(idea.empresas.reduce((s, e) => s + e.peso, 0)).toBe(100);
    }
  });

  it("las tres ideas dan resultados distintos, una de ellas sin ventaja", () => {
    expect(IDEAS.map(puntosTotales)).toEqual([10, 7, 12]);
  });

  it("la tabla de ejemplo coloca tu estrategia por puntos", () => {
    const puesto = (i: number) => tablaDe(IDEAS[i]).findIndex((f) => f.mia) + 1;
    expect([0, 1, 2].map(puesto)).toEqual([4, 5, 3]);
  });
});
