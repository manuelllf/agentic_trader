import { beforeEach, expect, it, vi } from "vitest";
import sitemap from "./sitemap";
import { listarPublicados } from "@/lib/blog/publico";

vi.mock("@/lib/blog/publico", () => ({ listarPublicados: vi.fn() }));
beforeEach(() => vi.mocked(listarPublicados).mockReset());

it("mantiene las seis URLs públicas y añade ambos listados vacíos", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  const urls = await sitemap();
  expect(urls).toHaveLength(8);
  expect(urls.slice(0, 6)).toEqual(["/", "/como-funciona", "/legal/aviso", "/legal/privacidad", "/legal/terminos", "/legal/cookies"].map(ruta => ({ url: `https://vennett.app${ruta}` })));
  expect(urls.slice(6).map(item => item.url)).toEqual(["https://vennett.app/blog", "https://vennett.app/en/blog"]);
  expect(urls[6].alternates?.languages).toEqual({ es: "https://vennett.app/blog", en: "https://vennett.app/en/blog" });
});

it("publica artículos por idioma con alternates y consulta ambos idiomas", async () => {
  vi.mocked(listarPublicados).mockImplementation(async idioma => [{ slug: idioma === "es" ? "uno" : "two", titulo: "Lesson", resumen: "Summary", palabras: 200, publicado_en: "2026-01-01T00:00:00Z" }]);
  const urls = await sitemap();
  expect(urls).toHaveLength(10);
  expect(listarPublicados).toHaveBeenCalledWith("es");
  expect(listarPublicados).toHaveBeenCalledWith("en");
  expect(urls[8]).toEqual({ url: "https://vennett.app/blog/uno", alternates: { languages: { es: "https://vennett.app/blog/uno", en: "https://vennett.app/en/blog/uno" } } });
  expect(urls[9].url).toBe("https://vennett.app/en/blog/two");
});

it("no presenta un sitemap incompleto como si la API estuviera vacía", async () => {
  vi.mocked(listarPublicados).mockImplementation(async idioma => { if (idioma === "es") throw new Error("offline"); return []; });
  await expect(sitemap()).rejects.toThrow("offline");
});
