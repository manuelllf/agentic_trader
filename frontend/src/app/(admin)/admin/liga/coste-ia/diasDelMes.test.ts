import { describe, expect, it } from "vitest";
import { diasDelMes, maximoDia } from "./diasDelMes";

describe("diasDelMes", () => {
  it("incluye todos los días de febrero", () => {
    expect(diasDelMes("2026-02", [])).toHaveLength(28);
  });

  it("coloca el gasto en su día y completa los días sin gasto", () => {
    const dias = diasDelMes("2026-10", [{ dia: "2026-10-03", pagado_usd: "1.5" }]);
    expect(dias).toHaveLength(31);
    expect(dias[2]).toEqual({ dia: 3, pagado: 1.5 });
    expect(dias[3]).toEqual({ dia: 4, pagado: 0 });
  });

  it("ignora el gasto de otro mes", () => {
    const dias = diasDelMes("2026-10", [{ dia: "2026-11-01", pagado_usd: "2" }]);
    expect(dias.every((dia) => dia.pagado === 0)).toBe(true);
  });
});

describe("maximoDia", () => {
  it("devuelve cero sin días", () => {
    expect(maximoDia([])).toBe(0);
  });

  it("devuelve el mayor gasto diario", () => {
    expect(maximoDia([{ pagado: 2 }, { pagado: 5 }])).toBe(5);
  });
});
