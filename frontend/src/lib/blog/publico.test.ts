import { afterEach, expect, it, vi } from "vitest";
import { escaparJsonLd, leerPublicado, listarPublicados } from "./publico";

afterEach(() => { vi.unstubAllGlobals(); });

it("lista el idioma solicitado con cinco minutos de revalidación", async () => {
  const datos = [{ slug: "leccion", titulo: "Lesson", resumen: "Summary", palabras: 401, publicado_en: "2026-01-01T10:00:00Z" }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(datos)));
  vi.stubGlobal("fetch", fetch);
  expect(await listarPublicados("en")).toEqual(datos);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/blog/articulos?idioma=en"), { next: { revalidate: 300 } });
});

it("codifica el slug y devuelve el cuerpo publicado en español", async () => {
  const datos = { slug: "a/b", cuerpo: "## Texto", palabras: 200 };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(datos)));
  vi.stubGlobal("fetch", fetch);
  expect(await leerPublicado("a/b", "es")).toEqual(datos);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/blog/articulos/a%2Fb?idioma=es"), { next: { revalidate: 300 } });
});

it("devuelve null solo cuando el artículo responde 404", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  expect(await leerPublicado("ausente", "en")).toBeNull();
});

it("propaga errores HTTP de lista y artículo", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 503 }))));
  await expect(listarPublicados("es")).rejects.toThrow();
  await expect(leerPublicado("leccion", "en")).rejects.toThrow();
});

it("propaga errores de red y JSON inválido", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await expect(listarPublicados("en")).rejects.toThrow("offline");
  await expect(leerPublicado("leccion", "es")).rejects.toThrow("offline");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response("invalid"))));
  await expect(listarPublicados("es")).rejects.toThrow();
  await expect(leerPublicado("leccion", "en")).rejects.toThrow();
});

it("escapa todos los signos menor que sin alterar los datos del JSON-LD", () => {
  const datos = { headline: "</script><script>alert(1)</script>", description: "a < b" };
  const json = escaparJsonLd(datos);
  expect(json).not.toContain("<");
  expect(json).toContain("\\u003c/script>");
  expect(JSON.parse(json)).toEqual(datos);
});
