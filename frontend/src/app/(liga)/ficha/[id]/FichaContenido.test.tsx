import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Ficha } from "@/lib/liga/api";
import { FichaContenido } from "./FichaContenido";

const estado = vi.hoisted(() => ({ ficha: null as Ficha | string | null, plan: "pro" }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLocale: () => "es",
  useTranslations: () => (clave: string) => clave,
}));
vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ pedirTexto: vi.fn(), dialogo: null }) }));
vi.mock("../../_sesion/SesionContext", () => ({ useSesionRequerida: () => ({ estado: "dentro", yo: { plan: estado.plan } }) }));
vi.mock("@/lib/liga/cache", () => ({
  invalidar: vi.fn(),
  useCache: (clave: string | null) => ({ datos: clave?.startsWith("ficha:") ? estado.ficha : undefined, cargando: false, refrescar: vi.fn() }),
}));
vi.mock("../../_ui", () => ({
  BarraPestanas: () => null, Cargando: () => null, Escudo: () => null, CASA: {}, escudoCasa: vi.fn(),
  Cifra: ({ valor }: { valor: number }) => <span>{valor}</span>,
  Boton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Segmentado: () => <div data-selector="vista" />,
  ErrorLiga: ({ mensaje }: { mensaje: string }) => <p role="alert">{mensaje}</p>,
}));

beforeEach(() => {
  estado.plan = "pro";
  estado.ficha = {
    id: "estrategia-1", nombre: "Foso ancho", casa: null, autor: "Ana", estado: "jugando",
    visibilidad: "publicada", es_dueno: true, escudo: { forma: "escudo", dibujo: "liso", color1: "#0B6E68", color2: null, iniciales: null },
    jornadas: [], posiciones: [], receta: {
      id: 1, catalogo_version: 1, creada: "2026-01-01", idea: "", reglas: [{ clave: "deuda", params: { maximo: 2 } }], pesos: {}, pregunta: "",
      n_empresas: 5, reparto: "igual", max_por_sector: 2, excluidas: [],
    },
  } satisfies Ficha;
});

it("mantiene la edici?n y las reglas autorizadas en el lateral oculto en m?vil", () => {
  const salida = renderToStaticMarkup(<FichaContenido id="estrategia-1" />);
  expect(salida).toContain('class="ficha-principal"');
  expect(salida).toContain('class="ficha-reglas" hidden=""');
  expect(salida).toContain('class="rulec"');
  expect(salida).toContain("maximo: 2");
  expect(salida).toContain('href="/crear/estrategia-1"');
  expect(salida.indexOf('data-selector="vista"')).toBeLessThan(salida.indexOf('class="ficha-lateral"'));
});

it("no reconstruye las reglas privadas y conserva la acci?n de reportar", () => {
  estado.ficha = { ...(estado.ficha as Ficha), receta: null, es_dueno: false };
  const salida = renderToStaticMarkup(<FichaContenido id="estrategia-1" />);
  expect(salida).not.toContain('class="rulec"');
  expect(salida).not.toContain('class="ficha-reglas"');
  expect(salida).toContain("strategies_report");
});

it("mantiene el error y el enlace de vuelta sin mostrar reglas ni acciones de otra ficha", () => {
  estado.ficha = "No disponible";
  const salida = renderToStaticMarkup(<FichaContenido id="estrategia-1" />);
  expect(salida).toContain("No disponible");
  expect(salida).toContain('href="/liga"');
  expect(salida).not.toContain('class="ficha-cuerpo"');
});

it("oculta el aviso comercial y el enlace de planes en una cuenta gratis", () => {
  estado.plan = "gratis";
  estado.ficha = { ...(estado.ficha as Ficha), es_dueno: false };
  const salida = renderToStaticMarkup(<FichaContenido id="estrategia-1" />);
  expect(salida).not.toContain('/cuenta/plan');
  expect(salida).not.toContain('strategies_pro_copy_note');
  expect(salida).toContain('strategies_report');
});
