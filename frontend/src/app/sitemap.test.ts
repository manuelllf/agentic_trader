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

const FIJAS = ["/", "/como-funciona", "/aprender", "/aprender/que-es-la-liga", "/aprender/crear-tu-estrategia", "/aprender/que-pasa-al-cierre", "/aprender/leer-la-clasificacion", "/legal/aviso", "/legal/privacidad", "/legal/terminos", "/legal/cookies", "/liga", "/premio", "/legal/bases-premio", "/quienes-somos", "/politica-editorial"];
const enIngles = (ruta: string) => `https://vennett.app${ruta === "/" ? "/en" : `/en${ruta}`}`;

it("lista las dieciséis páginas públicas sin premio en español y en inglés, y no anuncia el críptico sin acertijos publicados", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  const urls = await sitemap();
  expect(urls).toHaveLength(34);
  expect(urls.slice(0, 32).map(item => item.url)).toEqual(FIJAS.flatMap(ruta => [`https://vennett.app${ruta}`, enIngles(ruta)]));
  expect(urls.slice(32).map(item => item.url)).toEqual(["https://vennett.app/blog", "https://vennett.app/en/blog"]);
  expect(urls[32].alternates?.languages).toEqual({ es: "https://vennett.app/blog", en: "https://vennett.app/en/blog" });
});

it("Quiénes somos y la política editorial salen en los dos idiomas, con sus alternativas", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  const urls = await sitemap();
  for (const ruta of ["/quienes-somos", "/politica-editorial"]) {
    const entradas = urls.filter(item => item.url.endsWith(ruta));
    expect(entradas.map(item => item.url)).toEqual([`https://vennett.app${ruta}`, enIngles(ruta)]);
    expect(entradas[0].alternates?.languages).toEqual({ es: `https://vennett.app${ruta}`, en: enIngles(ruta), "x-default": `https://vennett.app${ruta}` });
  }
});

it("cada página pública anuncia sus dos versiones en las dos entradas", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  const urls = await sitemap();
  const liga = urls.filter(item => item.url.endsWith("/liga"));
  expect(liga.map(item => item.url)).toEqual(["https://vennett.app/liga", "https://vennett.app/en/liga"]);
  for (const item of liga) {
    expect(item.alternates?.languages).toEqual({ es: "https://vennett.app/liga", en: "https://vennett.app/en/liga", "x-default": "https://vennett.app/liga" });
  }
  expect(urls[1].url).toBe("https://vennett.app/en");
  expect(urls[1].alternates?.languages).toEqual({ es: "https://vennett.app/", en: "https://vennett.app/en", "x-default": "https://vennett.app/" });
});

it("publica artículos por idioma con alternates y consulta ambos idiomas", async () => {
  vi.mocked(listarPublicados).mockImplementation(async idioma => [{ slug: idioma === "es" ? "uno" : "two", titulo: "Lesson", resumen: "Summary", palabras: 200, publicado_en: "2026-01-01T00:00:00Z" }]);
  const urls = await sitemap();
  expect(urls).toHaveLength(36);
  expect(listarPublicados).toHaveBeenCalledWith("es");
  expect(listarPublicados).toHaveBeenCalledWith("en");
  expect(urls[34]).toEqual({ url: "https://vennett.app/blog/uno", lastModified: "2026-01-01T00:00:00Z",
    alternates: { languages: { es: "https://vennett.app/blog/uno", en: "https://vennett.app/en/blog/uno" } } });
  expect(urls[35].url).toBe("https://vennett.app/en/blog/two");
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
  expect(urls).toHaveLength(34);
  expect(urls.map(item => item.url)).not.toContain("https://vennett.app/en/criptico");
});

it("añade los archivos publicados por idioma con su fecha y excluye futuros y utilidades", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  vi.mocked(fetch).mockImplementation(async input => ({ ok: true, json: async () => [
    { numero: String(input).endsWith("=es") ? 1 : 2, fecha: "2020-01-01" },
    { numero: 3, fecha: "9999-01-01" },
  ] }) as Response);
  const urls = await sitemap();
  expect(urls).toHaveLength(40);
  expect(urls.slice(-2)).toEqual([
    { url: "https://vennett.app/criptico/1", lastModified: "2020-01-01" },
    { url: "https://vennett.app/en/criptico/2", lastModified: "2020-01-01" },
  ]);
  // El archivo se anuncia en cada idioma con la fecha de su último acertijo.
  expect(urls.slice(-4, -2)).toEqual([
    { url: "https://vennett.app/criptico/archivo", lastModified: "2020-01-01" },
    { url: "https://vennett.app/en/criptico/archivo", lastModified: "2020-01-01" },
  ]);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/criptico/indice?idioma=es"), expect.anything());
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/criptico/indice?idioma=en"), expect.anything());
  expect(urls.some(item => /\/(baja|confirmar)$/.test(item.url))).toBe(false);
});

it("si el índice devuelve un error HTTP conserva solo las rutas fijas", async () => {
  vi.mocked(listarPublicados).mockResolvedValue([]);
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
  await expect(sitemap()).resolves.toHaveLength(34);
});
