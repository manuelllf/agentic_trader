import { describe, expect, it } from "vitest";
import { esFiltro, esOrden, formatoUsd, horasMinutos } from "./panel";

describe("esFiltro", () => {
  it("acepta filtros conocidos y rechaza valores desconocidos o nulos", () => {
    expect(esFiltro("activas")).toBe(true);
    expect(esFiltro("x")).toBe(false);
    expect(esFiltro(null)).toBe(false);
  });
});

describe("esOrden", () => {
  it("acepta órdenes conocidos y rechaza valores desconocidos", () => {
    expect(esOrden("visitas_7d")).toBe(true);
    expect(esOrden("nombre")).toBe(false);
  });
});

describe("formatoUsd", () => {
  it("muestra dólares con cuatro decimales según el idioma", () => {
    expect(formatoUsd("es").format(0.0084)).toContain("0,0084");
    expect(formatoUsd("en").format(1)).toContain("1.0000");
  });
});

describe("horasMinutos", () => {
  it("convierte segundos en horas y minutos", () => {
    expect(horasMinutos(7800)).toEqual({ horas: 2, minutos: 10 });
  });

  it("devuelve cero para tiempos nulos o negativos", () => {
    expect(horasMinutos(0)).toEqual({ horas: 0, minutos: 0 });
    expect(horasMinutos(-5)).toEqual({ horas: 0, minutos: 0 });
  });
});
