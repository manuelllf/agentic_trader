import { describe, expect, it } from "vitest";
import { esInformeEnEspanol, textoInforme } from "./informe";

describe("textoInforme", () => {
  const informe = "Resumen. Noticias recientes: sube. Finanzas: caja alta. Riesgos: deuda.";

  it("reconoce los encabezados de un informe en español con la interfaz en inglés", () => {
    const salida = textoInforme(informe, "en");
    expect(salida).toContain("### Noticias recientes");
    expect(salida).toContain("### Riesgos");
    expect(esInformeEnEspanol(informe)).toBe(true);
  });

  it("reconoce también los encabezados en inglés", () => {
    const salida = textoInforme("Overview. Recent news: up. Risks: debt.", "es");
    expect(salida).toContain("### Recent news");
    expect(esInformeEnEspanol("Overview. Recent news: up.")).toBe(false);
  });
});
