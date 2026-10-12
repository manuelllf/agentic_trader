import { describe, expect, it } from "vitest";
import { correoOculto, debeCompletarCuenta } from "./cuenta";

describe("debeCompletarCuenta", () => {
  it.each([
    [true, "/liga", true],
    [true, "/cuenta/borrar", false],
    [true, "/cuenta/datos", false],
    [true, "/cuenta/plan", true],
    [false, "/liga", false],
    [true, "/completar", false],
    [true, "/auth/callback?x", false],
    [true, "/legal/privacidad", false],
  ])("pendiente=%s, ruta=%s devuelve %s", (pendiente, ruta, esperado) => {
    expect(debeCompletarCuenta(pendiente, ruta)).toBe(esperado);
  });
});

describe("correoOculto", () => {
  it.each([
    ["manuel@gmail.com", "m•••••@gmail.com"],
    ["a@vennett.com", "a•••••@vennett.com"],
    ["sin-arroba", "•••••"],
    ["", "•••••"],
  ])("oculta %s", (email, esperado) => {
    expect(correoOculto(email)).toBe(esperado);
  });
});
