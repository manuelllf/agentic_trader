// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodificarMapa, Globo, objetivoGiro } from "./motor";

describe("decodificarMapa", () => {
  it("lee cuatro bits por dígito, el más alto primero", () => {
    expect(Array.from(decodificarMapa("a5", 8))).toEqual([1, 0, 1, 0, 0, 1, 0, 1]);
  });
  it("rellena con ceros si el texto es corto", () => {
    expect(Array.from(decodificarMapa("f", 8))).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });
  it("respeta n aunque sobren dígitos", () => {
    expect(decodificarMapa("ff", 5).length).toBe(5);
  });
});

function puntos(dirs: [number, number, number][]) {
  return {
    px: new Float32Array(dirs.map((d) => d[0])),
    py: new Float32Array(dirs.map((d) => d[1])),
    pz: new Float32Array(dirs.map((d) => d[2])),
    rangos: dirs.map((_, i) => i),
  };
}

describe("objetivoGiro", () => {
  it("deja de cara un grupo alrededor de +x", () => {
    const p = puntos([[1, 0, 0.05], [1, 0, -0.05], [1, 0.05, 0], [1, -0.05, 0], [1, 0, 0]]);
    const o = objetivoGiro(p.px, p.py, p.pz, p.rangos, 0);
    expect(o.y).toBeCloseTo(-Math.PI / 2, 1);
    expect(o.x).toBeCloseTo(-0.12, 1);
  });
  it("gira por el camino corto", () => {
    const p = puntos([[0, 0, 1]]);
    expect(objetivoGiro(p.px, p.py, p.pz, p.rangos, 2 * Math.PI - 0.1).y).toBeCloseTo(2 * Math.PI, 5);
  });
  it("limita la inclinación a 1,2", () => {
    const p = puntos([[0, 1, 0.001]]);
    expect(objetivoGiro(p.px, p.py, p.pz, p.rangos, 0).x).toBe(1.2);
    const q = puntos([[0, -1, 0.001]]);
    expect(objetivoGiro(q.px, q.py, q.pz, q.rangos, 0).x).toBe(-1.2);
  });
});

describe("Globo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enciende y se destruye sin fallar en jsdom", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    const lienzo = document.createElement("canvas");
    const caja = document.createElement("div");
    document.body.append(caja); caja.append(lienzo);
    const n = 50;
    const alContar = vi.fn();
    const g = new Globo(lienzo, caja, { total: n, anillos: [{ rango: 10, etiqueta: "x" }], alContar, alTocar: vi.fn() });
    const bits = decodificarMapa("ffffffffffffffffffff", n);
    expect(() => g.encender(bits, [{ ticker: "AAA", rango: 1 }, { ticker: "BBB", rango: 2 }], 40)).not.toThrow();
    g.senalar(-1, 3);
    expect(() => g.destruir()).not.toThrow();
  });
});
