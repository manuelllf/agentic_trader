import { beforeEach, describe, expect, it } from "vitest";
import { fijar, haFallado, invalidar, limpiarPrivado, obtener } from "./cache";

describe("caché de la liga", () => {
  beforeEach(() => invalidar("k"));

  it("cambiar de cuenta olvida el seguimiento de todas las fichas", async () => {
    fijar("seguimiento:estrategia", { usuario: "anterior" });
    limpiarPrivado();
    expect(await obtener("seguimiento:estrategia", async () => ({ usuario: "actual" })))
      .toEqual({ usuario: "actual" });
  });

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

  it("una respuesta anterior a la invalidación no pisa la nueva", async () => {
    let resolver!: (value: { saldo: number }) => void;
    const anterior = obtener("k", () => new Promise<{ saldo: number }>((r) => { resolver = r; }));
    await Promise.resolve();
    invalidar("k");
    await obtener("k", async () => ({ saldo: 10 }));
    resolver({ saldo: 100 });
    await anterior;
    expect(await obtener("k", async () => ({ saldo: -1 }))).toEqual({ saldo: 10 });
  });

  it("una petición pendiente no deshace un dato recibido de una mutación", async () => {
    let resolver!: (value: number) => void;
    const anterior = obtener("k", () => new Promise<number>((r) => { resolver = r; }));
    await Promise.resolve();
    fijar("k", 7);
    resolver(3);
    await anterior;
    expect(await obtener("k", async () => 0)).toBe(7);
  });

  it("null es un dato válido (sin perfil) y no cuenta como fallo", async () => {
    expect(await obtener("k", () => Promise.resolve(null))).toBeNull();
    expect(haFallado("k")).toBe(false);
    fijar("k", "otro");
    expect(await obtener("k", () => Promise.reject(new Error("no se llama")))).toBe("otro");
  });
});
