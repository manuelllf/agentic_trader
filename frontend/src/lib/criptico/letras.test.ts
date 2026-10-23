import { describe, expect, it } from "vitest";
import { comparar, normalizar, validarLetra } from "./letras";

describe("letras", () => {
  it("quita tildes y diéresis, manteniendo la eñe incluso descompuesta", () => {
    expect(normalizar("acción, pingüino y nin\u0303o")).toBe("ACCION, PINGUINO Y NIÑO");
    expect(comparar("interés", "INTERES")).toBe(true);
    expect(comparar("año", "ano")).toBe(false);
  });
  it("solo admite una letra A-Z, y Ñ exclusivamente en español", () => {
    for (const entrada of ["a", "z", "é", "ü", "ñ"]) expect(validarLetra(entrada, "es")).toBe(true);
    for (const entrada of ["", "AB", "1", " ", "-", "🙂", "ß", "\u0000"]) expect(validarLetra(entrada)).toBe(false);
    expect(validarLetra("ñ", "en")).toBe(false);
    expect(validarLetra("é", "en")).toBe(true);
  });
});
