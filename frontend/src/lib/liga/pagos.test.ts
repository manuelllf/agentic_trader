import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ tokenSesion: async () => ({ token: "t" }) }));

import { abrirPago, cambiarPlan } from "./pagos";

function respuesta(status: number, cuerpo: unknown = {}) {
  return new Response(JSON.stringify(cuerpo), { status });
}

describe("pagos de Lemon en el cliente", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("un 409 al comprar Pro dice que ya tienes Pro activo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(409)));
    expect(await abrirPago("mensual")).toEqual({ error: "planes_ya_pro" });
  });

  it("el pack de liga se abre aunque ya tengas un pase: no hay 409 que traducir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      respuesta(200, { url: "https://vennett.lemonsqueezy.com/checkout/buy/x" })));
    expect(await abrirPago("pack_liga")).toEqual(
      { url: "https://vennett.lemonsqueezy.com/checkout/buy/x" });
  });

  it("cambiar de plan pide la duración nueva al backend", async () => {
    const pedir = vi.fn(async () => respuesta(200, { estado: "pedido" }));
    vi.stubGlobal("fetch", pedir);
    expect(await cambiarPlan("temporada")).toEqual({ ok: true });
    const [url, init] = pedir.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/liga/pagos/lemon/cambiar-plan")).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ producto: "temporada" });
  });

  it("cambiar al mismo plan o sin Pro de Lemon se traduce, y un fallo del servidor también", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(409)));
    expect(await cambiarPlan("mensual")).toEqual({ error: "planes_cambio_no_disponible" });
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(502)));
    expect(await cambiarPlan("mensual")).toEqual({ error: "planes_cambio_error" });
  });
});
