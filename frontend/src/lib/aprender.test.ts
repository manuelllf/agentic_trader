import { afterEach, describe, expect, it, vi } from "vitest";
import { cifrasDelMetodo, leerCiclo, leerMercado, pasanConRoe, type MercadoAprender } from "./aprender";
import { miles } from "./liga/format";

const m: MercadoAprender = {
  foto_id: 1,
  total: 10,
  roe: { minimo: 0, maximo: 2, paso: 1, defecto: 1, pasan: [10, 8, 5] },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pasanConRoe", () => {
  it.each<[number, number | null]>([
    [1, 8],
    [2, 5],
    [3, null],
    [-1, null],
    [0.5, null],
  ])("para el umbral %s devuelve %s", (umbral, esperado) => {
    expect(pasanConRoe(m, umbral)).toBe(esperado);
  });
});

describe("cifrasDelMetodo", () => {
  it("devuelve null sin datos", () => {
    expect(cifrasDelMetodo(null, "es")).toBeNull();
  });

  it("formatea los recuentos con el idioma indicado", () => {
    expect(cifrasDelMetodo({ ...m, total: 5738 }, "es")).toEqual({
      total: miles(5738, "es"), umbral: 1, pasan: "8",
    });
  });
});

describe("leerMercado", () => {
  it("lee el mercado con la caché del servidor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => m });
    vi.stubGlobal("fetch", fetchMock);

    expect(await leerMercado()).toEqual(m);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/liga\/aprender\/mercado$/),
      { next: { revalidate: 600 } },
    );
  });

  it("devuelve null si la respuesta no es correcta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await leerMercado()).toBeNull();
  });

  it("devuelve null si fetch lanza un error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin servicio")));
    expect(await leerMercado()).toBeNull();
  });
});

describe("leerCiclo", () => {
  it("devuelve null si la respuesta no es correcta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await leerCiclo()).toBeNull();
  });
});
