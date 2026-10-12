import { afterEach, describe, expect, it, vi } from "vitest";

const sesion = vi.hoisted(() => ({
  tokenSesion: vi.fn<() => Promise<{ token: string } | null>>(async () => ({ token: "t" })),
}));
vi.mock("./supabase", () => sesion);

import { abrirPago, leerSuscripcion } from "./pagos";

function respuesta(status: number, cuerpo: unknown = {}) {
  return new Response(JSON.stringify(cuerpo), { status });
}

describe("pagos de Lemon en el cliente", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sesion.tokenSesion.mockReset();
    sesion.tokenSesion.mockResolvedValue({ token: "t" });
  });

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
});

describe("leerSuscripcion", () => {
  const error = "planes_suscripcion_error";
  const conflicto = "planes_suscripcion_no_disponible";
  afterEach(() => {
    vi.unstubAllGlobals();
    sesion.tokenSesion.mockReset();
    sesion.tokenSesion.mockResolvedValue({ token: "t" });
  });

  it("pide al backend sin mandar un id de suscripción", async () => {
    const dato = {
      estado: "activa", producto: "mensual", renueva_en: null, termina_en: null,
      tarjeta_marca: null, tarjeta_ultimos4: null, portal_url: null, tarjeta_url: null,
    };
    const pedir = vi.fn(async () => respuesta(200, dato));
    vi.stubGlobal("fetch", pedir);
    expect(await leerSuscripcion()).toEqual(dato);
    const [url, init] = pedir.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/liga/pagos/lemon/suscripcion")).toBe(true);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it.each([409, 429, 502, 503])("traduce el error %i", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(status)));
    expect(await leerSuscripcion()).toEqual({ error: status === 409 ? conflicto
      : status === 503 ? "planes_pago_no_disponible" : error });
  });

  it("traduce un fallo de red", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("sin red"); }));
    expect(await leerSuscripcion()).toEqual({ error });
  });

  it.each([null, {}, "incorrecto"])("rechaza una respuesta inválida: %j", async (dato) => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(200, dato)));
    expect(await leerSuscripcion()).toEqual({ error });
  });

  it("sin sesión no llama al backend", async () => {
    sesion.tokenSesion.mockResolvedValueOnce(null);
    const pedir = vi.fn();
    vi.stubGlobal("fetch", pedir);
    expect(await leerSuscripcion()).toEqual({ error: "planes_entra" });
    expect(pedir).not.toHaveBeenCalled();
  });
});
