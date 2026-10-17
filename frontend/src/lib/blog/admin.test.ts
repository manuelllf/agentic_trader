import { afterEach, expect, it, vi } from "vitest";
import { guardarArticulo, publicarArticulo, programarArticulo, resumenBoletin, enviarPruebaBoletin } from "./admin";
import { tokenSesion } from "@/lib/liga/supabase";
vi.mock("@/lib/liga/supabase", () => ({ tokenSesion: vi.fn() }));
vi.mock("@/i18n/browser", () => ({ browserText: (key: string) => key }));
vi.mock("@/i18n/locale", () => ({ browserLocale: () => "es" }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const textos = { es: { titulo: "Hola", resumen: "Resumen", cuerpo: "Texto" }, en: { titulo: "Hello", resumen: "Summary", cuerpo: "Body" } };
it("envía ambos idiomas por PUT y solo incluye slug cuando se pasa", async () => {
  vi.mocked(tokenSesion).mockResolvedValue({ uid: "admin", token: "sesion", aal: "aal2" });
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetch);
  await guardarArticulo(7, textos);
  await guardarArticulo(7, { ...textos, slug: "otro-slug" });
  expect(fetch.mock.calls[0][0]).toContain("/blog/admin/articulos/7");
  expect(fetch.mock.calls[0][1].method).toBe("PUT");
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer sesion");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(textos);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ ...textos, slug: "otro-slug" });
});
it("conserva el texto del servidor y el estado 409", async () => {
  vi.mocked(tokenSesion).mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Esta dirección ya existe." }), { status: 409 })));
  await expect(guardarArticulo(7, textos)).rejects.toMatchObject({ message: "Esta dirección ya existe.", status: 409 });
});

it("publica con la preferencia del boletín", async () => {
  vi.mocked(tokenSesion).mockResolvedValue(null);
  const fetch = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetch);
  await publicarArticulo(7, false);
  expect(fetch.mock.calls[0][0]).toContain("/articulos/7/publicar");
  expect(fetch.mock.calls[0][1].method).toBe("POST");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ avisar_boletin: false });
});
it("programa con una fecha ISO con zona y la preferencia del boletín", async () => {
  vi.mocked(tokenSesion).mockResolvedValue(null);
  const fetch = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetch);
  await programarArticulo(7, "2026-10-19T07:00:00.000Z", true);
  expect(fetch.mock.calls[0][0]).toContain("/articulos/7/programar");
  expect(fetch.mock.calls[0][1].method).toBe("POST");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ programado_para: "2026-10-19T07:00:00.000Z", avisar_boletin: true });
});
it("consulta el resumen y solicita un correo de prueba", async () => {
  vi.mocked(tokenSesion).mockResolvedValue(null);
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}"))); vi.stubGlobal("fetch", fetch);
  await resumenBoletin(); await enviarPruebaBoletin();
  expect(fetch.mock.calls[0][0]).toContain("/boletin");
  expect(fetch.mock.calls[0][1].method).toBe("GET");
  expect(fetch.mock.calls[1][0]).toContain("/boletin/prueba");
  expect(fetch.mock.calls[1][1].method).toBe("POST");
});
