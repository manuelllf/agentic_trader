import { describe, expect, it } from "vitest";
import { EJEMPLO, MESES, SP, puntos, puntosTotales, tablaDe } from "./ideas";

describe("portada: ejemplo", () => {
  it("la regla de puntos es la de la liga: más de 0,2 puntos gana, menos de 0,2 pierde", () => {
    expect(puntos(3.2, 3.0)).toBe(1); // justo 0,2: empate
    expect(puntos(3.3, 3.0)).toBe(3);
    expect(puntos(2.8, 3.0)).toBe(1);
    expect(puntos(2.7, 3.0)).toBe(0);
  });

  it("tiene seis meses, cinco empresas y sus pesos suman 100", () => {
    expect(EJEMPLO.tu).toHaveLength(MESES.length);
    expect(SP).toHaveLength(MESES.length);
    expect(EJEMPLO.empresas).toHaveLength(5);
    expect(EJEMPLO.empresas.reduce((s, e) => s + e.peso, 0)).toBe(100);
  });

  it("mezcla meses ganados, empatados y perdidos, y su puesto sale de los puntos", () => {
    const meses = EJEMPLO.tu.map((v, i) => puntos(v, SP[i]));
    expect(new Set(meses)).toEqual(new Set([3, 1, 0]));
    expect(puntosTotales(EJEMPLO)).toBe(10);
    expect(tablaDe(EJEMPLO).findIndex((f) => f.mia) + 1).toBe(4);
  });
});
