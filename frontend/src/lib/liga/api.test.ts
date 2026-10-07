import { afterEach, describe, expect, it, vi } from "vitest";
import { getClasificacion, getYo, guardarIdioma, llamar } from "./api";
import { tokenSesion } from "./supabase";

vi.mock("./supabase", () => ({ tokenSesion: vi.fn(), sesionCaducada: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe("guardado ligado a la cuenta del borrador", () => {
  it("no envía el contenido si la sesión pasó a otra cuenta", async () => {
    vi.mocked(tokenSesion).mockResolvedValue({ uid: "otra", token: "local", aal: "aal1" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const resultado = await llamar("/liga/borradores/nueva", { method: "PUT", body: "{}" }, true, 1000, "original");
    expect(resultado).toContain("La sesión ha cambiado");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("guarda normalmente mientras sigue la cuenta original", async () => {
    vi.mocked(tokenSesion).mockResolvedValue({ uid: "original", token: "local", aal: "aal1" });
    const fetch = vi.fn().mockResolvedValue(new Response('{"revision":2}', { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await llamar("/liga/borradores/nueva", { method: "PUT", body: "{}" }, true, 1000, "original"))
      .toEqual({ revision: 2 });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("language preference ownership", () => {
  it("does not save a preference after the account changes", async () => {
    vi.mocked(tokenSesion).mockResolvedValue({ uid: "other", token: "local", aal: "aal1" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(typeof await guardarIdioma("en", "original")).toBe("string");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("identifies a missing profile by HTTP status in either language", async () => {
    vi.mocked(tokenSesion).mockResolvedValue({ uid: "original", token: "local", aal: "aal1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"Profile not found."}', { status: 404 })));
    expect(await getYo()).toBeNull();
  });
});

describe("getClasificacion", () => {
  it("usa rentabilidad por defecto y acepta puntos", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"filas":[]}', { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await getClasificacion();
    expect(String(fetch.mock.calls[0][0])).toContain("orden=rentabilidad");
    await getClasificacion({ orden: "puntos" });
    expect(String(fetch.mock.calls[1][0])).toContain("orden=puntos");
  });
});
