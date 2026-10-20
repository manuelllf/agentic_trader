import { describe, expect, it } from "vitest";
import { altura, porcentaje, ritmo } from "./analitica";

describe("funciones de analítica", () => {
  it("evita dividir entre cero y redondea porcentajes", () => {
    expect(porcentaje(0, 0)).toBeNull();
    expect(porcentaje(1, 3)).toBe(33);
  });
  it("mantiene las barras positivas visibles y limita su altura", () => {
    expect(altura(0, 10)).toBe(0);
    expect(altura(1, 1000)).toBe(1.5);
    expect(altura(20, 10)).toBe(100);
    expect(altura(1, 0)).toBe(0);
  });
  it("compara el ritmo con el periodo anterior", () => {
    expect(ritmo(3, 5)).toBe("bajando");
    expect(ritmo(5, 3)).toBe("subiendo");
    expect(ritmo(3, 3)).toBe("igual");
  });
});
