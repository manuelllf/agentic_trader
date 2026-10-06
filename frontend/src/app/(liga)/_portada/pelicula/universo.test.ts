import { describe, expect, it } from "vitest";
import { PER_MAX, PER_MIN, UNIVERSO, crearUniverso, evaluar } from "./universo";
import { DIAS, OTRAS, caminar, crearSeries } from "./series";

const emp = crearUniverso();

describe("universo del ejemplo", () => {
  it("tiene el tamaño anunciado y es siempre el mismo", () => {
    expect(emp).toHaveLength(UNIVERSO);
    expect(crearUniverso()[2000].cap).toBe(emp[2000].cap);
  });

  it("el embudo solo baja y las que cumplen son las de la última regla", () => {
    const ev = evaluar(emp, 18);
    expect(ev.cuenta).toEqual([2987, 876, 438, 268, 87]);
    expect(ev.vivas).toHaveLength(ev.cuenta[4]);
  });

  it("con cualquier PER de la escena, la cartera son cinco empresas con nombre y como mucho dos por sector", () => {
    for (let per = PER_MIN; per <= PER_MAX; per++) {
      const { cartera } = evaluar(emp, per);
      expect(cartera).toHaveLength(5);
      expect(cartera.every((e) => e.ticker)).toBe(true);
      const porSector = new Map<number, number>();
      cartera.forEach((e) => porSector.set(e.sector, (porSector.get(e.sector) ?? 0) + 1));
      expect(Math.max(...porSector.values())).toBeLessThanOrEqual(2);
    }
  });
});

describe("curvas del ejemplo", () => {
  it("salen de cero y llegan justo al objetivo", () => {
    const s = caminar(3, 12.5, 0, 0.007, true, null);
    expect(s).toHaveLength(DIAS + 1);
    expect(s[0]).toBeCloseTo(0, 9);
    expect(s[DIAS]).toBeCloseTo(12.5, 9);
  });

  it("los puestos de la liga son únicos y cuentan a todas", () => {
    const series = crearSeries(evaluar(emp, 18).cartera);
    const puestos = series.todas.map((s) => s.puesto).sort((a, b) => a - b);
    expect(puestos).toEqual(Array.from({ length: OTRAS.length + 1 }, (_, i) => i + 1));
    expect(series.ranking[0].puesto).toBe(1);
  });
});
