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

const fila = (id: string | null, dif: number | null, rentabilidad: number | null = 1.5): FilaJornadaPublica => ({
  equipo: { id, nombre: `Estrategia ${id}`, casa: null, autor: "ana",
    escudo: { forma: "circulo", dibujo: "liso", color1: "#0B6E68", color2: null, iniciales: null } },
  rentabilidad, dif_sp: dif, puntos: null,
});
const detalle = (filas: FilaJornadaPublica[]): JornadaDetalle => ({
  jornada: { id: 1, temporada_id: 1, numero: 1, dia_inicio: "2026-10-01", dia_fin: "2026-10-30",
    cierre_inscripcion: "2026-09-30T13:00:00Z", estado: "en_juego", sp_rentabilidad: 0.4 },
  total: filas.length, filas,
});
const html = (filas: FilaJornadaPublica[]) =>
  renderToStaticMarkup(<VistaJornada detalle={detalle(filas)} miAlias={null} onAbrir={() => {}} />);

describe("VistaJornada", () => {
  it("renderiza una fila sin UUID público", () => {
    expect(html([fila(null, 1.5)])).toContain("Estrategia null");
  });

  it("pinta las tres cabeceras, en orden, cuando cada grupo tiene filas", () => {
    const salida = html([fila("a", 1.5), fila("b", 0), fila("c", -1)]);
    const posicion = ["Ganando la semana", "Empatando", "Perdiendo"].map((c) => salida.indexOf(c));
    expect(posicion.every((p) => p >= 0)).toBe(true);
    expect(posicion).toEqual([...posicion].sort((x, y) => x - y));
  });

  it("no pinta la cabecera de un grupo sin filas", () => {
    const sinEmpate = html([fila("a", 1.5), fila("c", -1)]);
    expect(sinEmpate).toContain("Ganando la semana");
    expect(sinEmpate).toContain("Perdiendo");
    expect(sinEmpate).not.toContain("Empatando");
    expect(sinEmpate).not.toContain("a 0,2 puntos o menos del S&amp;P");

    const soloEmpate = html([fila("b", 0.1), fila("d", -0.1)]);
    expect(soloEmpate).toContain("Empatando");
    expect(soloEmpate).not.toContain("Ganando la semana");
    expect(soloEmpate).not.toContain("Perdiendo");

    const soloGanando = html([fila("a", 2)]);
    expect(soloGanando).toContain("Ganando la semana");
    expect(soloGanando).not.toContain("Empatando");
    expect(soloGanando).not.toContain("Perdiendo");
  });

  it("reparte con el margen de 0,2 puntos: justo en el borde es empate", () => {
    const salida = html([fila("g", 0.21), fila("e1", 0.2), fila("e2", -0.2), fila("p", -0.21)]);
    const entre = (desde: string, hasta: string) =>
      salida.slice(salida.indexOf(desde), hasta ? salida.indexOf(hasta) : undefined);
    expect(entre("Ganando la semana", "Empatando")).toContain("Estrategia g");
    const empate = entre("Empatando", "Perdiendo");
    expect(empate).toContain("Estrategia e1");
    expect(empate).toContain("Estrategia e2");
    expect(entre("Perdiendo", "")).toContain("Estrategia p");
  });

  it("sin ninguna rentabilidad enseña el aviso y ninguna cabecera", () => {
    const salida = html([fila("a", null, null)]);
    expect(salida).toContain("La tabla se rellena con el primer cierre de bolsa.");
    expect(salida).not.toContain("Ganando la semana");
    expect(salida).not.toContain("Empatando");
    expect(salida).not.toContain("Perdiendo");
  });
});

it("reserva puesto y referencia del ?ndice solo para escritorio", () => {
  const salida = html([fila("a", 1.5)]);
  expect(salida).toContain('puesto-escritorio pos num" hidden="" style="display:none"');
  expect(salida).toContain('diferencia-escritorio vsp num" hidden=""');
});
