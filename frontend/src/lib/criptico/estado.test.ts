import { beforeEach, describe, expect, it, vi } from "vitest";
import { estadoCriptico } from "./estado";
import { leerPublicado, listarPublicados, proximaFecha } from "./publico";

vi.mock("./publico", () => ({ listarPublicados: vi.fn(), leerPublicado: vi.fn(), proximaFecha: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe("estadoCriptico", () => {
  it("anuncia el próximo cuando la lista está vacía", async () => {
    vi.mocked(listarPublicados).mockResolvedValue([]);
    vi.mocked(proximaFecha).mockResolvedValue("2026-11-02");
    expect(await estadoCriptico("es")).toEqual({ tipo: "proximo", fecha: "2026-11-02" });
  });

  it("no muestra nada sin publicados ni próximo", async () => {
    vi.mocked(listarPublicados).mockResolvedValue([]);
    vi.mocked(proximaFecha).mockResolvedValue(null);
    expect(await estadoCriptico("es")).toBeNull();
  });

  it("compone la pista de hoy", async () => {
    vi.mocked(listarPublicados).mockResolvedValue([{ numero: 1, fecha: "2026-10-26" }]);
    vi.mocked(leerPublicado).mockResolvedValue({
      acertijo: { longitud: 5, pista: [{ texto: "Un árbol ", papel: null }, { texto: "sagrado", papel: "def" }] },
    } as NonNullable<Awaited<ReturnType<typeof leerPublicado>>>);
    expect(await estadoCriptico("es")).toEqual({ tipo: "hoy", longitud: 5, pista: "Un árbol sagrado" });
    expect(proximaFecha).not.toHaveBeenCalled();
  });

  it("no muestra nada si falta la entrega", async () => {
    vi.mocked(listarPublicados).mockResolvedValue([{ numero: 1, fecha: "2026-10-26" }]);
    vi.mocked(leerPublicado).mockResolvedValue(null);
    expect(await estadoCriptico("es")).toBeNull();
  });

  it("no muestra nada si falla la API", async () => {
    vi.mocked(listarPublicados).mockRejectedValue(new Error("API unavailable"));
    expect(await estadoCriptico("es")).toBeNull();
  });
});
