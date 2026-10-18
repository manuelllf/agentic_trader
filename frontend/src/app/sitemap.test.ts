import { beforeEach, expect, it, vi } from "vitest";
import sitemap from "./sitemap";
import { listarPublicados } from "@/lib/blog/publico";

vi.mock("@/lib/blog/publico", () => ({ listarPublicados: vi.fn() }));
beforeEach(() => vi.mocked(listarPublicados).mockReset());

it("mantiene las nueve URLs públicas y añade ambos listados vacíos", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  const urls = await sitemap();
  expect(urls).toHaveLength(11);
  expect(urls.slice(0, 9)).toEqual(["/", "/como-funciona", "/legal/aviso", "/legal/privacidad", "/legal/terminos", "/legal/cookies", "/liga", "/premio", "/legal/bases-premio"].map(ruta => ({ url: `https://vennett.app${ruta}` })));
  expect(urls.slice(9).map(item => item.url)).toEqual(["https://vennett.app/blog", "https://vennett.app/en/blog"]);
  expect(urls[9].alternates?.languages).toEqual({ es: "https://vennett.app/blog", en: "https://vennett.app/en/blog" });
});

it("publica artículos por idioma con alternates y consulta ambos idiomas", async () => {
  vi.mocked(listarPublicados).mockImplementation(async idioma => [{ slug: idioma === "es" ? "uno" : "two", titulo: "Lesson", resumen: "Summary", palabras: 200, publicado_en: "2026-01-01T00:00:00Z" }]);
  const urls = await sitemap();
  expect(urls).toHaveLength(13);
  expect(listarPublicados).toHaveBeenCalledWith("es");
  expect(listarPublicados).toHaveBeenCalledWith("en");
  expect(urls[11]).toEqual({ url: "https://vennett.app/blog/uno", alternates: { languages: { es: "https://vennett.app/blog/uno", en: "https://vennett.app/en/blog/uno" } } });
  expect(urls[12].url).toBe("https://vennett.app/en/blog/two");
});

it("no presenta un sitemap incompleto como si la API estuviera vacía", async () => {
  vi.mocked(listarPublicados).mockImplementation(async idioma => { if (idioma === "es") throw new Error("offline"); return []; });
  await expect(sitemap()).rejects.toThrow("offline");
});
