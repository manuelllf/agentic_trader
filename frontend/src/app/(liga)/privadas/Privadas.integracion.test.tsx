// @vitest-environment jsdom
// Comprueba contra la maqueta v6 lo que ve la persona: la lista con su puesto y el «+» de la cabecera, el
// estado vacío, el detalle con el ranking, los pendientes y la hoja de invitar. Datos de ejemplo.
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LigaDetalle, LigaResumen } from "@/lib/liga/api";

let datosCache: unknown = null;
let detalleRuta: unknown = null;

vi.mock("next-intl", async () => {
  const [common, league, strategies, privadas] = await Promise.all([
    import("../../../../messages/es/common.json"), import("../../../../messages/es/league.json"),
    import("../../../../messages/es/strategies.json"), import("../../../../messages/es/privateLeagues.json"),
  ]);
  const catalogo = { ...common.default, ...league.default, ...strategies.default, ...privadas.default } as Record<string, string>;
  const t = (key: string, valores?: Record<string, string | number>) =>
    (catalogo[key] ?? key).replace(/\{(\w+)\}/g, (_, nombre: string) => String(valores?.[nombre] ?? `{${nombre}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useParams: () => ({ id: "liga-1" }) }));
vi.mock("next/link", async () => {
  const react = await import("react");
  return { default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    react.createElement("a", { href, className }, children) };
});
vi.mock("../_sesion/SesionContext", () => ({ useSesionRequerida: () => ({ estado: "dentro", yo: { puede_crear_liga: true } }) }));
vi.mock("@/components/Confirmar", () => ({ useConfirmar: () => ({ confirmar: async () => false, dialogo: null }) }));
vi.mock("@/lib/liga/ficha", () => ({ precargarFicha: vi.fn() }));
vi.mock("@/lib/liga/api", () => ({
  misLigas: vi.fn(), verLiga: vi.fn(), crearLiga: vi.fn(), unirseLiga: vi.fn(),
  rotarCodigoLiga: vi.fn(), expulsarDeLiga: vi.fn(), salirLiga: vi.fn(),
}));
vi.mock("@/lib/liga/cache", () => ({ invalidar: vi.fn(), useCache: (clave: string | null) => ({
  datos: clave === "mis-ligas" ? datosCache : detalleRuta, cargando: false, fallo: false, refrescar: vi.fn(),
}) }));
// La cabecera depende de la sesión; aquí solo importa el «+» que le pasa cada pantalla.
vi.mock("../_ui", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  CabeceraApp: ({ titulo, izquierda, derecha }: { titulo?: string; izquierda?: ReactNode; derecha?: ReactNode }) =>
    <>{izquierda}<h1>{titulo}</h1>{derecha}</>,
  BarraPestanas: () => null,
}));

import PrivadasLista from "./page";
import PrivadaDetalle from "./[id]/page";

const escudo = { forma: "circulo" as const, dibujo: "liso" as const, color1: "#0B6E68", color2: null, iniciales: null };
const liga = (nombre: string, puesto: number | null, n: number): LigaResumen =>
  ({ id: nombre, nombre, cupo: 50, oculta: false, creada: "2026-11-01", es_dueno: true, codigo: "K7M2QXP4",
    n_miembros: n, mio: null, puesto, sp500_mes: null, lider: null } as unknown as LigaResumen);

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const proto = HTMLElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLElement) { this.setAttribute("open", ""); };
  proto.close ??= function (this: HTMLElement) { this.removeAttribute("open"); };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  datosCache = null;
  detalleRuta = null;
});

const texto = () => container.textContent ?? "";
const boton = (nombre: string) => [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nombre || b.textContent === nombre) as HTMLButtonElement | undefined;

describe("lista de Privadas (maqueta v6)", () => {
  it("muestra cada liga con su número de personas y tu puesto de la semana", () => {
    datosCache = [liga("Los del martes", 3, 6), liga("Pádel y bolsa", 2, 3)];
    act(() => root.render(<PrivadasLista />));
    expect(texto()).toContain("Los del martes");
    expect(texto()).toContain("3.º");
    expect(texto()).toContain("Pádel y bolsa");
    expect(texto()).toContain("Tu puesto");
  });

  it("ofrece unirse y crear desde el «+» de la cabecera", () => {
    datosCache = [];
    act(() => root.render(<PrivadasLista />));
    const mas = boton("Unirme o crear una liga");
    expect(mas).toBeDefined();
    act(() => mas?.click());
    expect(texto()).toContain("Unirme con código");
    expect(texto()).toContain("Crear liga");
  });

  it("explica el estado vacío y ofrece el botón para unirse", () => {
    datosCache = [];
    act(() => root.render(<PrivadasLista />));
    expect(texto()).toContain("Todavía no estás en ninguna liga");
    expect(boton("Unirme con código")).toBeDefined();
  });
});

describe("detalle de una liga (maqueta v6)", () => {
  const miembro = (alias: string, est: string, mes: number | null, yo = false, sinEstrategia = false) => ({
    alias, es_yo: yo, unido: "2026-11-01T10:00:00Z", puntos: 3, jornadas: 1, dif_sp: 0.5, provisional: false,
    acumulado: null, movimiento: null,
    estrategia: sinEstrategia ? null : { id: `${alias}-e`, nombre: est, visibilidad: "publicada", escudo },
    rentabilidad_mes: mes, diferencia_mes: mes == null ? null : mes + 1.6,
    serie_semana: mes == null ? [] : [0, mes], serie_temporada: [],
  });
  const detalle = {
    id: "liga-1", nombre: "Los del martes", cupo: 50, oculta: false, creada: "2026-11-01", es_dueno: true,
    codigo: "K7M2QXP4", n_miembros: 4, jornada_numero: 7, jornada_total: 12, datos_hasta: "2026-11-12",
    sp500_mes: -1.6, en_vivo: true, consultado: "2026-11-12T17:30:00Z",
    miembros: [
      miembro("Marta", "Brújula verde", 2.4),
      miembro("Tú", "Mi cartera", -0.4, true),
      miembro("Dani", "Cartera tranquila", 0.9),
      miembro("Carmen", "", null, false, true),
    ],
  } as unknown as LigaDetalle;

  it("pinta el ranking de la semana, los pendientes y el grupo de celdas", () => {
    detalleRuta = detalle;
    act(() => root.render(<PrivadaDetalle />));
    expect(texto()).toContain("Los del martes");
    expect(texto()).toContain("Invitar");
    expect(texto()).toContain("Brújula verde");
    expect(texto()).toContain("Mi cartera");
    expect(container.querySelectorAll("li.lv-fila:not(.pv-pendiente)")).toHaveLength(3);
    expect(texto()).toContain("Sin resultado todavía");
    expect(texto()).toContain("¿Qué estrategia representa a cada persona?");
  });

  it("abre la hoja de invitar con el código y el botón de copiar", () => {
    detalleRuta = detalle;
    act(() => root.render(<PrivadaDetalle />));
    act(() => boton("Invitar")?.click());
    expect(texto()).toContain("K7M2QXP4");
    expect(texto()).toContain("Copiar código");
    expect(texto()).toContain("Cambiar código de invitación");
  });
});
