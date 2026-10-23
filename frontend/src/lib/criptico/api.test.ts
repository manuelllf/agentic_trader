import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";

vi.mock("@/lib/liga/supabase", () => ({ tokenSesion: async () => null, supabase: () => null }));
afterEach(() => vi.unstubAllGlobals());

describe("cliente del críptico", () => {
  it("acepta el 204 vacío de resuelto con el cliente compartido", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.resuelto(42, 2)).resolves.toBeUndefined();
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/criptico/42/resuelto");
    expect(opciones.method).toBe("POST");
    expect(JSON.parse(opciones.body)).toEqual({ ayudas_usadas: 2 });
  });
  it("acepta el 202 de suscripción sin exigir campos de respuesta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.suscribir("persona@example.com", "en")).resolves.toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "persona@example.com", idioma: "en" });
  });
  it("conserva las respuestas JSON de comprobar y manda únicamente las letras", async () => {
    const respuesta = { correcta: false, detalle: null };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(respuesta));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.comprobar(42, "RENTA")).resolves.toEqual(respuesta);
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe("/criptico/42/comprobar");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ letras: "RENTA" });
  });
});
