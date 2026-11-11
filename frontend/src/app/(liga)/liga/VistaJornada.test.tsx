import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FilaJornadaPublica, JornadaDetalle } from "@/lib/liga/api";
import { VistaJornada } from "./VistaJornada";

vi.mock("next-intl", async () => {
  const [common, league] = await Promise.all([
    import("../../../../messages/es/common.json"), import("../../../../messages/es/league.json"),
  ]);
  const catalogo = { ...common.default, ...league.default } as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (catalogo[key] ?? key).replace(/\{(\w+)\}/g, (_, nombre: string) => String(values?.[nombre] ?? `{${nombre}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});

const fila = (id: string | null, dif: number | null, rentabilidad: number | null = 1.5,
  serie: number[] = []): FilaJornadaPublica => ({
  equipo: { id, nombre: `Estrategia ${id}`, casa: null, autor: "ana",
    escudo: { forma: "circulo", dibujo: "liso", color1: "#0B6E68", color2: null, iniciales: null } },
  rentabilidad, dif_sp: dif, puntos: null, serie,
});
const detalle = (filas: FilaJornadaPublica[]): JornadaDetalle => ({
  jornada: { id: 1, temporada_id: 1, numero: 1, dia_inicio: "2026-10-01", dia_fin: "2026-10-30",
    cierre_inscripcion: "2026-09-30T13:00:00Z", estado: "en_juego", sp_rentabilidad: 0.4 },
  total: filas.length, filas,
});
const html = (filas: FilaJornadaPublica[], miAlias: string | null = null) =>
  renderToStaticMarkup(<VistaJornada detalle={detalle(filas)} miAlias={miAlias} onAbrir={() => {}} />);

describe("VistaJornada", () => {
  it("numera las estrategias con cifra en el orden que llega, sin grupos", () => {
    const salida = html([fila("a", 1.5), fila("b", 0), fila("c", -1)]);
    expect(salida.indexOf("Estrategia a")).toBeLessThan(salida.indexOf("Estrategia b"));
    expect(salida.indexOf("Estrategia b")).toBeLessThan(salida.indexOf("Estrategia c"));
    expect(salida).not.toContain("Ganando la semana");
    expect(salida).not.toContain("Perdiendo");
  });

  it("cabecera con el S&P de la semana y píldora con la diferencia frente al S&P", () => {
    const salida = html([fila("a", 1.5)]);
    expect(salida).toContain("Esta semana");
    expect(salida).toMatch(/\+0,4.%/);
    expect(salida).toContain("+1,5");
    expect(salida).toContain('class="lv-pildora bien"');
  });

  it("dibuja la gráfica de la semana cuando hay al menos dos sesiones", () => {
    expect(html([fila("a", 1.5, 1.5, [0, 1, 1.5])])).toContain("<polyline");
    expect(html([fila("a", 1.5, 1.5, [])])).not.toContain("<polyline");
  });

  it("marca la estrategia propia", () => {
    expect(html([fila("a", 1)], "ana")).toContain('class="lv-fila tuya"');
    expect(html([fila("a", 1)], "otra")).not.toContain("tuya");
  });

  it("sin ninguna rentabilidad enseña el aviso y ninguna lista", () => {
    const salida = html([fila("a", null, null)]);
    expect(salida).toContain("La tabla se rellena con el primer cierre de bolsa.");
    expect(salida).not.toContain("lv-lista");
  });
});
