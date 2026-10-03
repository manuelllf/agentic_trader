import { afterEach, describe, expect, it, vi } from "vitest";
import { llamar } from "./api";
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
