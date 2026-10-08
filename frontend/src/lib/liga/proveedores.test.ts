import { describe, expect, it } from "vitest";
import { esAliasValido } from "./proveedores";

describe("esAliasValido", () => {
  it.each([
    ["ana_1", true], ["AB", false], ["a".repeat(21), false], ["Ana", false], ["ana-x", false],
  ])("%s devuelve %s", (alias, esperado) => {
    expect(esAliasValido(alias)).toBe(esperado);
  });
});
