import { afterEach, describe, expect, it, vi } from "vitest";
import { proximaFecha } from "./publico";

afterEach(() => vi.unstubAllGlobals());

describe("proximaFecha", () => {
  it("devuelve null ante un 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    expect(await proximaFecha("es")).toBeNull();
  });

  it("devuelve la fecha y solicita el idioma inglés", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ fecha: "2026-11-02" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await proximaFecha("en")).toBe("2026-11-02");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/criptico/proximo?idioma=en"), { next: { revalidate: 300 } });
  });

  it("lanza ante un 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(proximaFecha("es")).rejects.toThrow("Criptico API unavailable");
  });
});
