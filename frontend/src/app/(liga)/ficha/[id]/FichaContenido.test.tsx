import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Ficha } from "@/lib/liga/api";
import { FichaContenido } from "./FichaContenido";

const estado = vi.hoisted(() => ({ ficha: null as Ficha | string | null, cargando: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLocale: () => "es",
  useTranslations: () => (clave: string) => clave,
}));
vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ pedirTexto: vi.fn(), dialogo: null }) }));
vi.mock("../../_sesion/SesionContext", () => ({ useSesionRequerida: () => ({ estado: "dentro" }) }));
vi.mock("@/lib/liga/cache", () => ({
  invalidar: vi.fn(),
  useCache: (clave: string | null) => ({
    datos: clave?.startsWith("ficha:") ? estado.ficha : undefined,
    cargando: clave?.startsWith("ficha:") ? estado.cargando : false, refrescar: vi.fn(),
  }),
}));
vi.mock("../../_ui", () => ({ BarraPestanas: () => null }));
// Las piezas tienen sus propias pruebas: aquí se comprueba qué reciben y en qué orden salen.
vi.mock("./CabeceraFicha", () => ({
  CabeceraFicha: (p: { nombre: string; esDueno: boolean; puedeCopiar: boolean; sinAcciones?: boolean }) =>
    <header data-nombre={p.nombre} data-dueno={String(p.esDueno)} data-copiar={String(p.puedeCopiar)} data-sin={String(!!p.sinAcciones)} />,
}));
vi.mock("./CabezaFicha", () => ({ CabezaFicha: () => <div data-pieza="cabeza" /> }));
vi.mock("./CarteraFicha", () => ({ CarteraFicha: () => <div data-pieza="cartera" /> }));
vi.mock("./MetodologiaFicha", () => ({ MetodologiaFicha: () => <div data-pieza="metodo" /> }));
vi.mock("./ResultadosFicha", () => ({ ResultadosFicha: () => <div data-pieza="resultados" /> }));

const base: Ficha = {
  id: "estrategia-1", nombre: "Foso ancho", casa: null, autor: "Ana", estado: "jugando",
  visibilidad: "publicada", es_dueno: true, escudo: { forma: "escudo", dibujo: "liso", color1: "#0B6E68", color2: null, iniciales: null },
  jornadas: [], posiciones: [], receta: {
    id: 1, catalogo_version: 1, creada: "2026-01-01", idea: "", reglas: [], pesos: {}, pregunta: "",
    n_empresas: 5, reparto: "igual", max_por_sector: 2, excluidas: [],
  },
};

beforeEach(() => { estado.ficha = { ...base }; estado.cargando = false; });

it("pinta la barra, la cabeza, el segmentado de tres vistas y la cartera, en ese orden", () => {
  const salida = renderToStaticMarkup(<FichaContenido id="estrategia-1" />);
  expect(salida).toContain('class="scroll lv-pagina fi"');
  expect(salida).toContain('data-nombre="Foso ancho" data-dueno="true" data-copiar="false"');
  for (const pestana of ["strategies_portfolio", "strategies_methodology", "strategies_results"]) expect(salida).toContain(pestana);
  const orden = ["<header", 'data-pieza="cabeza"', 'class="lv-seg"', 'data-pieza="cartera"'].map((s) => salida.indexOf(s));
  expect(orden).toEqual([...orden].sort((a, b) => a - b));
  expect(salida).not.toContain('data-pieza="metodo"');
});

it("deja copiar una ajena publicada que juega, y no una retirada, una casa ni la tuya", () => {
  estado.ficha = { ...base, es_dueno: false };
  expect(renderToStaticMarkup(<FichaContenido id="estrategia-1" />)).toContain('data-copiar="true"');
  estado.ficha = { ...base, es_dueno: false, estado: "retirada" };
  expect(renderToStaticMarkup(<FichaContenido id="estrategia-1" />)).toContain('data-copiar="false"');
  estado.ficha = { ...base, es_dueno: false, casa: "alpha" };
  expect(renderToStaticMarkup(<FichaContenido id="estrategia-1" />)).toContain('data-copiar="false"');
  estado.ficha = { ...base, es_dueno: false, receta: null };
  expect(renderToStaticMarkup(<FichaContenido id="estrategia-1" />)).toContain('data-copiar="false"');
});

it("mientras carga enseña el esqueleto y la barra sin acciones", () => {
  estado.ficha = null; estado.cargando = true;
  const salida = renderToStaticMarkup(<FichaContenido id="estrategia-1" />);
  expect(salida).toContain('data-sin="true"');
  expect(salida).toContain('class="fi-esq"');
  expect(salida).not.toContain('data-pieza="cabeza"');
});

it("si falla, explica qué pasó y deja reintentar, sin piezas de la ficha", () => {
  estado.ficha = "No existe esa estrategia.";
  const salida = renderToStaticMarkup(<FichaContenido id="estrategia-1" />);
  expect(salida).toContain("ficha_error_t");
  expect(salida).toContain("No existe esa estrategia.");
  expect(salida).toContain("strategies_retry");
  expect(salida).not.toContain('data-pieza="cartera"');
});
