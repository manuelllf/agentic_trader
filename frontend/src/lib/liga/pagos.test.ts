import { afterEach, describe, expect, it, vi } from "vitest";

const sesion = vi.hoisted(() => ({
  tokenSesion: vi.fn<() => Promise<{ token: string } | null>>(async () => ({ token: "t" })),
}));
vi.mock("./supabase", () => sesion);

import { abrirPago, cambiarPlan, leerSuscripcion, cancelarSuscripcion,
  reanudarSuscripcion } from "./pagos";

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

const gestion = [
  { ruta: "suscripcion", llamar: leerSuscripcion, method: "GET",
    error: "planes_suscripcion_error", conflicto: "planes_suscripcion_no_disponible" },
  { ruta: "cancelar", llamar: cancelarSuscripcion, method: "POST",
    error: "planes_cancelar_error", conflicto: "planes_suscripcion_no_disponible" },
  { ruta: "reanudar", llamar: reanudarSuscripcion, method: "POST",
    error: "planes_reanudar_error", conflicto: "planes_reanudar_no_disponible" },
];

describe.each(gestion)("gestión: $ruta", ({ ruta, llamar, method, error, conflicto }) => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sesion.tokenSesion.mockReset();
    sesion.tokenSesion.mockResolvedValue({ token: "t" });
  });

  it("pide al backend sin mandar un id de suscripción", async () => {
    const dato = ruta === "suscripcion" ? {
      estado: "activa", producto: "mensual", renueva_en: null, termina_en: null,
      tarjeta_marca: null, tarjeta_ultimos4: null, portal_url: null, tarjeta_url: null,
    } : { estado: "pedido" };
    const pedir = vi.fn(async () => respuesta(200, dato));
    vi.stubGlobal("fetch", pedir);
    expect(await llamar()).toEqual(ruta === "suscripcion" ? dato : { ok: true });
    const [url, init] = pedir.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith(`/liga/pagos/lemon/${ruta}`)).toBe(true);
    expect(init.method).toBe(method);
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it.each([409, 429, 502, 503])("traduce el error %i", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(status)));
    expect(await llamar()).toEqual({ error: status === 409 ? conflicto
      : status === 503 ? "planes_pago_no_disponible" : error });
  });

  it("traduce un fallo de red", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("sin red"); }));
    expect(await llamar()).toEqual({ error });
  });

  it.each([null, {}, "incorrecto"])("rechaza una respuesta inválida: %j", async (dato) => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(200, dato)));
    expect(await llamar()).toEqual({ error });
  });

  it("sin sesión no llama al backend", async () => {
    sesion.tokenSesion.mockResolvedValueOnce(null);
    const pedir = vi.fn();
    vi.stubGlobal("fetch", pedir);
    expect(await llamar()).toEqual({ error: "planes_entra" });
    expect(pedir).not.toHaveBeenCalled();
  });
});
