import { describe, expect, it } from "vitest";
import { PESO_PREGUNTA_INICIAL, pesosCoherentes } from "./receta";

const PESOS = { negocio: 20, precio: 20, deuda: 20, pronto: 20, pregunta: 20 };

describe("pregunta y peso", () => {
  it("sin pregunta, el peso es 0 aunque el control se hubiera movido", () => {
    expect(pesosCoherentes("", PESOS)).toEqual({ pregunta: null, pesos: { ...PESOS, pregunta: 0 } });
    expect(pesosCoherentes("   ", PESOS).pregunta).toBeNull();
  });

  it("con pregunta y sin peso, se le da el peso inicial", () => {
    const r = pesosCoherentes("¿Tiene foso?", { ...PESOS, pregunta: 0 });
    expect(r.pregunta).toBe("¿Tiene foso?");
    expect(r.pesos.pregunta).toBe(PESO_PREGUNTA_INICIAL);
  });

  it("con pregunta y peso, respeta el peso elegido y recorta el texto", () => {
    const r = pesosCoherentes("  ¿Tiene foso?  ", { ...PESOS, pregunta: 35 });
    expect(r).toEqual({ pregunta: "¿Tiene foso?", pesos: { ...PESOS, pregunta: 35 } });
  });

  it("no toca los otros pesos", () => {
    expect(pesosCoherentes("", PESOS).pesos.negocio).toBe(20);
  });
});
