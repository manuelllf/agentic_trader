import { describe, expect, it } from "vitest";
import { debeCompletarCuenta } from "./cuenta";

describe("debeCompletarCuenta", () => {
  it.each([
    [true, "/liga", true],
    [false, "/liga", false],
    [true, "/completar", false],
    [true, "/auth/callback?x", false],
    [true, "/legal/privacidad", false],
  ])("pendiente=%s, ruta=%s devuelve %s", (pendiente, ruta, esperado) => {
    expect(debeCompletarCuenta(pendiente, ruta)).toBe(esperado);
  });
});
