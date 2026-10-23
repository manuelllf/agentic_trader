import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sitemap from "./sitemap";
import { listarPublicados } from "@/lib/blog/publico";
import { leerCiclo } from "@/lib/aprender";

vi.mock("@/lib/blog/publico", () => ({ listarPublicados: vi.fn() }));
vi.mock("@/lib/aprender", () => ({ leerCiclo: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  vi.mocked(listarPublicados).mockReset();
  vi.mocked(leerCiclo).mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

it("mantiene las catorce URLs públicas sin premio y no anuncia el críptico sin acertijos publicados", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  const urls = await sitemap();
  expect(urls).toHaveLength(16);
  expect(urls.slice(0, 14)).toEqual(["/", "/como-funciona", "/aprender", "/aprender/que-es-la-liga", "/aprender/crear-tu-estrategia", "/aprender/que-pasa-al-cierre", "/aprender/leer-la-clasificacion", "/legal/aviso", "/legal/privacidad", "/legal/terminos", "/legal/cookies", "/liga", "/premio", "/legal/bases-premio"].map(ruta => ({ url: `https://vennett.app${ruta}` })));
  expect(urls.slice(14).map(item => item.url)).toEqual(["https://vennett.app/blog", "https://vennett.app/en/blog"]);
  expect(urls[14].alternates?.languages).toEqual({ es: "https://vennett.app/blog", en: "https://vennett.app/en/blog" });
});

it("publica artículos por idioma con alternates y consulta ambos idiomas", async () => {
  vi.mocked(listarPublicados).mockImplementation(async idioma => [{ slug: idioma === "es" ? "uno" : "two", titulo: "Lesson", resumen: "Summary", palabras: 200, publicado_en: "2026-01-01T00:00:00Z" }]);
  const urls = await sitemap();
  expect(urls).toHaveLength(18);
  expect(listarPublicados).toHaveBeenCalledWith("es");
  expect(listarPublicados).toHaveBeenCalledWith("en");
  expect(urls[16]).toEqual({ url: "https://vennett.app/blog/uno", alternates: { languages: { es: "https://vennett.app/blog/uno", en: "https://vennett.app/en/blog/uno" } } });
  expect(urls[17].url).toBe("https://vennett.app/en/blog/two");
});

it("incluye la guía del premio cuando es visible", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  vi.mocked(leerCiclo).mockResolvedValue({ premio: { visible: true } } as never);
  const urls = await sitemap();
  expect(urls.map(item => item.url)).toContain("https://vennett.app/aprender/el-premio");
});

it("conserva las páginas fijas aunque la API esté caída", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  vi.mocked(listarPublicados).mockImplementation(async idioma => { if (idioma === "es") throw new Error("offline"); return []; });
  const urls = await sitemap();
  expect(urls).toHaveLength(16);
  expect(urls.map(item => item.url)).not.toContain("https://vennett.app/en/criptico");
});

it("añade los archivos publicados por idioma con su fecha y excluye futuros y utilidades", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  vi.mocked(fetch).mockImplementation(async input => ({ ok: true, json: async () => [
    { numero: String(input).endsWith("=es") ? 1 : 2, fecha: "2020-01-01" },
    { numero: 3, fecha: "9999-01-01" },
  ] }) as Response);
  const urls = await sitemap();
  expect(urls).toHaveLength(20);
  expect(urls.slice(-2)).toEqual([
    { url: "https://vennett.app/criptico/1", lastModified: "2020-01-01" },
    { url: "https://vennett.app/en/criptico/2", lastModified: "2020-01-01" },
  ]);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/criptico/indice?idioma=es"), expect.anything());
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/criptico/indice?idioma=en"), expect.anything());
  expect(urls.some(item => /\/(baja|confirmar)$/.test(item.url))).toBe(false);
});

it("si el índice devuelve un error HTTP conserva solo las rutas fijas", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
  await expect(sitemap()).resolves.toHaveLength(16);
});
