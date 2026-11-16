import { describe, expect, it } from "vitest";
import { minutosCaptura, textoHorario, type EntradaHorario } from "./procesos";

const t = (clave: string, v?: Record<string, string | number>) => (v ? `${clave}${JSON.stringify(v)}` : clave);

describe("textoHorario", () => {
  it("compone el horario con lo que cuenta el scheduler", () => {
    const e: EntradaHorario = { proceso: "foto", automatico: true, dias_semana: "mon-fri", dia_mes: "*", horas: "16,18", minuto: "30", zona: "America/New_York" };
    expect(textoHorario("foto", e, true, t, "es")).toBe(
      'pnl_datos_horario{"cuando":"pnl_datos_laborables","horas":"16:30 y 18:30","zona":"pnl_datos_zona_ny"}');
  });
  it("el día del mes manda sobre los días de la semana", () => {
    const e: EntradaHorario = { proceso: "global", automatico: true, dias_semana: "*", dia_mes: "1", horas: "3", minuto: "0", zona: "UTC" };
    expect(textoHorario("global", e, true, t, "en")).toContain('"cuando":"pnl_datos_dia_mes{\\"dia\\":\\"1\\"}"');
  });
  it("fundamentales y poda son solo a mano, y sin scheduler no hay nada automático", () => {
    expect(textoHorario("fund", undefined, true, t, "es")).toBe("pnl_datos_solo_a_mano");
    expect(textoHorario("poda", undefined, false, t, "es")).toBe("pnl_datos_solo_a_mano");
    expect(textoHorario("fx", undefined, false, t, "es")).toBe("pnl_datos_sin_scheduler");
    expect(textoHorario("fx", { proceso: "fx", automatico: false }, true, t, "es")).toBe("pnl_datos_sin_trabajo");
  });
});

describe("minutosCaptura", () => {
  it("a 150 por minuto, con mínimo de uno", () => {
    expect(minutosCaptura(1840)).toBe(12);
    expect(minutosCaptura(10)).toBe(1);
  });
});
