import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.unstubAllGlobals());

it("sin token no llama a la API", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const respuesta = await POST(new Request("https://vennett.app/api/criptico/baja", { method: "POST" }));
  expect(respuesta.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

it("con token da de baja contra la API", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const respuesta = await POST(new Request("https://vennett.app/api/criptico/baja?token=a%2Fb", { method: "POST" }));
  expect(await respuesta.json()).toEqual({ ok: true });
  expect(fetch.mock.calls[0][0]).toMatch(/\/criptico\/suscripcion\/baja\?token=a%2Fb$/);
});
