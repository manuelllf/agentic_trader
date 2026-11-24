import { afterEach, describe, expect, it, vi } from "vitest";
import { empresaPorRango, idRegla, leerPortadaDemo, normalizarPortada, type PortadaDemo } from "./portada";
import { guardarIdeaPortada, tomarIdeaPortada } from "./ideaPortada";

function almacen(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() { return datos.size; }, clear: () => datos.clear(), key: () => null,
    getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); },
  };
}

describe("reglas de la portada", () => {
  it.each([
    [{ clave: "rentables", params: { roe_pct: 15 } }, "roe15"],
    [{ clave: "tamano", params: { desde: 10000, hasta: 5000000 } }, "grande"],
    [{ clave: "tamano", params: { desde: 300, hasta: 2000 } }, "pequena"],
    [{ clave: "tamano", params: { desde: 50, hasta: 300 } }, null],
    [{ clave: "caja_neta", params: {} }, "caja"],
    [{ clave: "castigadas_pct", params: { p: 30 } }, "caida30"],
    [{ clave: "inventada", params: {} }, null],
  ])("%o se lee como %s", (regla, id) => {
    expect(idRegla({ ...regla, detalle: "" })).toBe(id);
  });

  it("las cifras de la semana llegan como texto decimal y se pasan a número", () => {
    const crudo = { semana: { dia_inicio: "2026-11-16", dia_fin: "2026-11-20", sp: "-8.6000",
      casa: [{ casa: "alpha", rentabilidad: "-10.2000", dif_sp: "-1.6000", puntos: 0 }] } } as unknown as PortadaDemo;
    const { semana } = normalizarPortada(crudo);
    expect(semana!.sp).toBe(-8.6);
    expect(semana!.casa[0]).toMatchObject({ rentabilidad: -10.2, dif_sp: -1.6 });
  });
});

describe("rutas de la API", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  // El router de la liga monta /aprender bajo /liga: sin el prefijo, la demo no salía en producción.
  it("la demo y la empresa se piden bajo /liga/aprender", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await leerPortadaDemo("en");
    await empresaPorRango(14);
    const rutas = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(rutas.map((u) => u.pathname)).toEqual(["/liga/aprender/portada", "/liga/aprender/portada/empresa/14"]);
    expect(rutas[0].searchParams.get("idioma")).toBe("en");
  });
});

describe("idea de la portada", () => {
  it("viaja a Crear una sola vez", () => {
    const s = almacen();
    guardarIdeaPortada("  Empresas rentables y baratas  ", s);
    expect(tomarIdeaPortada(s)).toBe("Empresas rentables y baratas");
    expect(tomarIdeaPortada(s)).toBeNull();
  });

  it("sin almacenamiento no rompe nada", () => {
    expect(() => guardarIdeaPortada("x", null)).not.toThrow();
    expect(tomarIdeaPortada(null)).toBeNull();
  });
});
