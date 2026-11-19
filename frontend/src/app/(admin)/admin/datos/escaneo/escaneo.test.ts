import { describe, expect, it } from "vitest";
import { porNotas, tono } from "./escaneo";

describe("porNotas", () => {
  it("reparte en cinco grupos del mismo tamaño, de la nota más alta a la más baja", () => {
    const pares = Array.from({ length: 10 }, (_, i) => ({ score: i * 10, ret: i }));   // notas 0..90, retornos 0..9
    const grupos = porNotas(pares);
    expect(grupos.map(g => g.n)).toEqual([2, 2, 2, 2, 2]);
    expect(grupos.map(g => g.media)).toEqual([8.5, 6.5, 4.5, 2.5, 0.5]);
  });

  it("no depende del orden en que lleguen los pares", () => {
    const pares = [{ score: 1, ret: 10 }, { score: 5, ret: -2 }, { score: 3, ret: 4 }, { score: 9, ret: 7 }, { score: 7, ret: 1 }];
    expect(porNotas(pares)).toEqual(porNotas([...pares].reverse()));
    expect(porNotas(pares).map(g => g.media)).toEqual([7, 1, -2, 4, 10]);
  });

  it("reparte el resto sin dejar a nadie fuera", () => {
    const grupos = porNotas(Array.from({ length: 12 }, (_, i) => ({ score: i, ret: 1 })));
    expect(grupos.reduce((a, g) => a + g.n, 0)).toBe(12);
    expect(grupos.every(g => g.n >= 2)).toBe(true);
  });

  it("con menos pares que grupos no hay lectura", () => {
    expect(porNotas([])).toEqual([]);
    expect(porNotas(Array.from({ length: 4 }, (_, i) => ({ score: i, ret: i })))).toEqual([]);
  });
});

describe("tono", () => {
  it("solo colorea ganar y perder", () => {
    expect([tono(1.2), tono(-0.4), tono(0), tono(null)]).toEqual(["pd-bien", "pd-mal", "", ""]);
  });
});
