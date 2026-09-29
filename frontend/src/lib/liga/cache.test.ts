import { beforeEach, describe, expect, it } from "vitest";
import { fijar, haFallado, invalidar, obtener } from "./cache";

describe("caché de la liga", () => {
  beforeEach(() => invalidar("k"));

  it("un fallo no se guarda como dato y se puede reintentar", async () => {
    await expect(obtener("k", () => Promise.reject(new Error("red")))).rejects.toThrow("red");
    expect(haFallado("k")).toBe(true);

    expect(await obtener("k", () => Promise.resolve("bien"))).toBe("bien");
    expect(haFallado("k")).toBe(false);
  });

  it("invalidar olvida el fallo", async () => {
    await obtener("k", () => Promise.reject(new Error("red"))).catch(() => {});
    invalidar("k");
    expect(haFallado("k")).toBe(false);
  });

  it("null es un dato válido (sin perfil) y no cuenta como fallo", async () => {
    expect(await obtener("k", () => Promise.resolve(null))).toBeNull();
    expect(haFallado("k")).toBe(false);
    fijar("k", "otro");
    expect(await obtener("k", () => Promise.reject(new Error("no se llama")))).toBe("otro");
  });
});
