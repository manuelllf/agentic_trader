import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LARGO_IDEA, guardarIdea, tomarIdea } from "./idea";

function almacenFalso() {
  const datos = new Map<string, string>();
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
  };
}

describe("idea de la portada", () => {
  beforeEach(() => vi.stubGlobal("sessionStorage", almacenFalso()));
  afterEach(() => vi.unstubAllGlobals());

  it("se guarda recortada y se entrega una sola vez", () => {
    guardarIdea("  empresas pequeñas con poca deuda  ");
    expect(tomarIdea()).toBe("empresas pequeñas con poca deuda");
    expect(tomarIdea()).toBe("");
  });

  it("una idea vacía no deja rastro de una anterior", () => {
    guardarIdea("algo");
    guardarIdea("   ");
    expect(tomarIdea()).toBe("");
  });

  it("no pasa del largo que admite el editor", () => {
    guardarIdea("a".repeat(LARGO_IDEA + 50));
    expect(tomarIdea()).toHaveLength(LARGO_IDEA);
  });

  it("sin almacenamiento no lanza", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("bloqueado"); },
      setItem: () => { throw new Error("bloqueado"); },
      removeItem: () => { throw new Error("bloqueado"); },
    });
    expect(() => guardarIdea("algo")).not.toThrow();
    expect(tomarIdea()).toBe("");
  });
});
