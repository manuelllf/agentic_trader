import { describe, expect, it } from "vitest";
import {
  caidaMaxima,
  decimalesDeTicks,
  indiceCercano,
  inicioPeriodo,
  inicios,
  observaciones,
  periodosDisponibles,
  ticksLimpios,
  ventana,
  type PuntoSerie,
} from "./grafica";

function serie(estrategia: number[], sp500: number[], jornadas?: (number | null)[]): PuntoSerie[] {
  return estrategia.map((e, i) => ({
    dia: `2026-10-${String(i + 1).padStart(2, "0")}`,
    estrategia: e,
    sp500: sp500[i],
    provisional: false,
    salto: false,
    ...(jornadas ? { jornada: jornadas[i] } : {}),
  }));
}

const dias = (n: number) => Array.from({ length: n }, (_, i) => i * 0.5);

describe("ticksLimpios", () => {
  it("cubre el máximo: la línea nunca se sale de la gráfica", () => {
    const ticks = ticksLimpios(-0.3, 2.6);
    expect(ticks[0]).toBeLessThanOrEqual(-0.3);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(2.6);
    expect(ticks).toContain(0);
  });

  it("usa pasos redondos y equidistantes", () => {
    const ticks = ticksLimpios(-1.4, 3.6);
    const pasos = ticks.slice(1).map((t, i) => Math.round((t - ticks[i]) * 1e6) / 1e6);
    expect(new Set(pasos).size).toBe(1);
    expect([0.5, 1, 2]).toContain(pasos[0]);
  });

  it("cada marca se escribe exacta con los decimales del eje, en cualquier rango", () => {
    for (const [min, max] of [[-0.3, 2.6], [0, 0.4], [-0.9, 0.2], [-3, 10], [-12, 47], [1.1, 2.9]]) {
      const ticks = ticksLimpios(min, max);
      const d = decimalesDeTicks(ticks);
      for (const tick of ticks) {
        expect(Number(tick.toFixed(d))).toBeCloseTo(tick, 9);
      }
    }
  });

  it("incluye el 0 % aunque todo sea positivo o negativo", () => {
    expect(ticksLimpios(1, 3)).toContain(0);
    expect(ticksLimpios(-3, -1)).toContain(0);
  });

  it("no se rompe con una serie plana", () => {
    const ticks = ticksLimpios(0, 0);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks).toContain(0);
  });
});

describe("periodos", () => {
  it("con 4 cierres solo hay día y total", () => {
    const s = serie(dias(4), dias(4));
    expect(periodosDisponibles(s)).toEqual({
      dia: true, semana: false, mes: false, jornada: false, total: true,
    });
  });

  it("semana pide 6 puntos y mes 22", () => {
    expect(inicioPeriodo(serie(dias(6), dias(6)), "semana")).toBe(0);
    expect(inicioPeriodo(serie(dias(5), dias(5)), "semana")).toBeNull();
    expect(inicioPeriodo(serie(dias(22), dias(22)), "mes")).toBe(0);
    expect(inicioPeriodo(serie(dias(21), dias(21)), "mes")).toBeNull();
  });

  it("la jornada empieza donde cambia la última y exige una anterior", () => {
    const s = serie(dias(6), dias(6), [1, 1, 1, 2, 2, 2]);
    expect(inicioPeriodo(s, "jornada")).toBe(3);
    expect(inicioPeriodo(serie(dias(6), dias(6), [2, 2, 2, 2, 2, 2]), "jornada")).toBeNull();
    expect(inicioPeriodo(serie(dias(6), dias(6)), "jornada")).toBeNull();
  });

  it("una jornada que empieza en el último punto no es una curva", () => {
    expect(inicioPeriodo(serie(dias(4), dias(4), [1, 1, 1, 2]), "jornada")).toBeNull();
  });
});

describe("ventana", () => {
  it("rebasa a 0 % componiendo, no restando", () => {
    const s = serie([0, 10, 21], [0, 5, 10.25]);
    const v = ventana(s, "dia");
    expect(v).toHaveLength(2);
    expect(v[0].estrategia).toBeCloseTo(0, 10);
    expect(v[0].sp500).toBeCloseTo(0, 10);
    expect(v[1].estrategia).toBeCloseTo(10, 10);
    expect(v[1].sp500).toBeCloseTo(5, 10);
  });

  it("total devuelve toda la serie y conserva los marcadores", () => {
    const s = serie([0, 2, 1], [0, 1, 1], [1, 1, 2]);
    const v = ventana(s, "total");
    expect(v).toHaveLength(3);
    expect(v.map((p) => p.jornada)).toEqual([1, 1, 2]);
  });

  it("un periodo que no cabe devuelve vacío", () => {
    expect(ventana(serie(dias(4), dias(4)), "mes")).toEqual([]);
  });
});

describe("caída máxima", () => {
  it("mide desde el último máximo", () => {
    const v = ventana(serie([0, 10, -10, 5], [0, 0, 0, 0]), "total");
    expect(caidaMaxima(v)).toBeCloseTo(0.9 / 1.1 - 1, 10);
  });

  it("es cero si la curva solo sube", () => {
    expect(caidaMaxima(ventana(serie([0, 1, 2], [0, 0, 0]), "total"))).toBe(0);
  });
});

describe("observaciones e inicios", () => {
  it("los saltos no cuentan como retorno diario", () => {
    const s = serie(dias(4), dias(4));
    s[2].salto = true;
    expect(observaciones(s)).toBe(2);
  });

  it("marca el primer día de cada jornada nueva, no el primero de la serie", () => {
    const s = serie(dias(5), dias(5), [1, 1, 2, 2, 3]);
    expect(inicios(s)).toEqual([{ indice: 2, jornada: 2 }, { indice: 4, jornada: 3 }]);
  });
});

describe("indiceCercano", () => {
  it("se queda dentro de la serie", () => {
    expect(indiceCercano(-50, 40, 270, 10)).toBe(0);
    expect(indiceCercano(999, 40, 270, 10)).toBe(9);
    expect(indiceCercano(170, 40, 270, 10)).toBe(4);
  });
});
