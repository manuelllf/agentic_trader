import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Hoy, { generateMetadata as metadataHoy } from "./criptico/page";
import { generateMetadata as metadataBaja } from "./criptico/baja/page";
import Archivo, { generateMetadata as metadataArchivo } from "./criptico/[numero]/page";
import { generateMetadata as metadataEn } from "./en/criptico/page";
import { generateMetadata as metadataBajaEn } from "./en/criptico/baja/page";
import { generateMetadata as metadataConfirmar } from "./criptico/confirmar/page";
import { generateMetadata as metadataConfirmarEn } from "./en/criptico/confirmar/page";
import { generateMetadata as metadataArchivoEn } from "./en/criptico/[numero]/page";
import Lista, { generateMetadata as metadataLista } from "./criptico/archivo/page";
import ListaEn, { generateMetadata as metadataListaEn } from "./en/criptico/archivo/page";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); } }));
vi.mock("./_criptico/Pagina", () => ({ default: () => null }));
vi.mock("./_criptico/ArchivoPagina", () => ({ default: () => null }));
vi.mock("./_criptico/Token", () => ({ default: () => null }));

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true, json: async () => ({ acertijo: { numero: 1, fecha: "2020-01-01" } }),
})));
afterEach(() => vi.unstubAllGlobals());

it.each([
  [metadataHoy, "/criptico", true, "es_ES"],
  [metadataEn, "/en/criptico", true, "en_GB"],
  [metadataBaja, "/criptico/baja", false, "es_ES"],
  [metadataBajaEn, "/en/criptico/baja", false, "en_GB"],
  [metadataConfirmar, "/criptico/confirmar", false, "es_ES"],
  [metadataConfirmarEn, "/en/criptico/confirmar", false, "en_GB"],
] as const)("canonical y robots de %s", async (generar, ruta, index, locale) => {
  const metadata = await generar();
  expect(metadata.alternates).toEqual({ canonical: `https://vennett.app${ruta}` });
  expect(metadata.robots).toEqual({ index, follow: index });
  expect(metadata.openGraph).toMatchObject({ url: `https://vennett.app${ruta}`, locale });
  expect(metadata.title).toBeTruthy();
  expect(metadata.description).toBeTruthy();
});

it.each([metadataArchivo, metadataArchivoEn])("el archivo tiene canonical propio", async generar => {
  const metadata = await generar({ params: Promise.resolve({ numero: "12" }) });
  expect(metadata.alternates?.canonical).toMatch(/\/criptico\/12$/);
  expect(metadata.robots).toEqual({ index: true, follow: true });
});

it.each([
  [metadataLista, "/criptico/archivo", "es_ES"],
  [metadataListaEn, "/en/criptico/archivo", "en_GB"],
] as const)("la lista del archivo %# tiene canonical propio y se indexa", async (generar, ruta, locale) => {
  const metadata = await generar();
  expect(metadata.alternates).toEqual({ canonical: `https://vennett.app${ruta}` });
  expect(metadata.robots).toEqual({ index: true, follow: true });
  expect(metadata.openGraph).toMatchObject({ url: `https://vennett.app${ruta}`, locale });
  expect(String(metadata.title)).toMatch(/·\sVennett$/);
  expect(metadata.description).toBeTruthy();
});

it("la lista del archivo se pinta con lo que da la API y, si falla, con el error", async () => {
  const entrada = { numero: 1, fecha: "2020-01-01", nivel: "facil", longitud: 5, pista: [{ texto: "Pista", papel: null }] };
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [entrada] } as Response);
  const bien = await Lista() as { props: { idioma: string; indice: unknown } };
  expect(bien.props).toMatchObject({ idioma: "es", indice: [entrada] });
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
  const mal = await ListaEn() as { props: { idioma: string; indice: unknown } };
  expect(mal.props).toMatchObject({ idioma: "en", indice: null });
});

it("sin acertijo también se indexa; el archivo sin publicar da 404", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
  expect((await metadataHoy()).robots).toEqual({ index: true, follow: true });
  expect((await metadataArchivo({ params: Promise.resolve({ numero: "12" }) })).robots).toEqual({ index: true, follow: true });
  await expect(Hoy()).resolves.toBeTruthy();
  await expect(Archivo({ params: Promise.resolve({ numero: "12" }) })).rejects.toThrow(";404");
});

it("un acertijo futuro también se indexa y hoy queda vacío", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ acertijo: { fecha: "9999-01-01" } }) } as Response);
  expect((await metadataHoy()).robots).toEqual({ index: true, follow: true });
  await expect(Hoy()).resolves.toBeTruthy();
});
