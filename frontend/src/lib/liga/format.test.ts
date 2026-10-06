import { describe, expect, it } from "vitest";
import {
  claseSigno,
  diferenciaPuntos,
  euros,
  fecha,
  fraseVsIndice,
  miles,
  nombreMes,
  porcentaje,
  signo,
} from "./format";

describe("signo", () => {
  it("normaliza los Decimal serializados por la API antes de leer el signo", () => {
    expect(signo("-0.002" as unknown as number)).toBe("0,0");
    expect(claseSigno("-0.002" as unknown as number)).toBe("fl");
    expect(porcentaje("1.25" as unknown as number)).toBe("+1,3 %");
  });
  it("redondea al alza en magnitud (ROUND_HALF_UP), no al par más cercano", () => {
    expect(signo(0.55)).toBe("+0,6");
    expect(signo(-0.05)).toBe("−0,1");
  });

  it("usa el menos tipográfico, nunca el guion ASCII", () => {
    expect(signo(-1.2)).toBe("−1,2");
    expect(signo(-1.2)).not.toContain("-");
  });

  it("no pone signo en cero, ni siquiera al redondear a cero", () => {
    expect(signo(0)).toBe("0,0");
    expect(signo(0.02)).toBe("0,0");
    expect(signo(-0.001)).toBe("0,0");
  });

  it("admite otros decimales, como el eje del gráfico a 0 decimales", () => {
    expect(signo(2.6, 0)).toBe("+3");
    expect(signo(-0.4, 0)).toBe("0");
  });
});

describe("porcentaje", () => {
  it("añade espacio duro y el símbolo de porcentaje", () => {
    expect(porcentaje(1.1)).toBe("+1,1 %");
    expect(porcentaje(-1.6)).toBe("−1,6 %");
  });

  it("la diferencia en puntos se formatea igual (nunca se escribe «p. p.»)", () => {
    expect(diferenciaPuntos(0.5)).toBe(porcentaje(0.5));
    expect(diferenciaPuntos(0.5)).not.toContain("p.");
  });
});

describe("claseSigno", () => {
  it("clasifica por el valor ya redondeado, no el crudo", () => {
    expect(claseSigno(0.04)).toBe("fl"); // redondea a 0,0: ni sube ni baja
    expect(claseSigno(0.06)).toBe("up"); // redondea a 0,1
    expect(claseSigno(-0.06)).toBe("dn");
    expect(claseSigno(0)).toBe("fl");
  });
});

describe("euros", () => {
  it("dos decimales, coma y espacio duro antes de €, sin signo +", () => {
    expect(euros(3.1)).toBe("3,10 €");
    expect(euros(5.5)).toBe("5,50 €");
  });

  it("un saldo negativo sí lleva el menos tipográfico", () => {
    expect(euros(-0.03)).toBe("−0,03 €");
  });
});

describe("miles", () => {
  it("separa los miles con punto", () => {
    expect(miles(2987)).toBe("2.987");
    expect(miles(142)).toBe("142");
    expect(miles(1000000)).toBe("1.000.000");
  });

  it("trunca decimales y respeta el signo", () => {
    expect(miles(-2500)).toBe("−2.500");
  });
});

describe("nombreMes", () => {
  it("da el nombre en español a partir de un índice 0-11", () => {
    expect(nombreMes(0)).toBe("enero");
    expect(nombreMes(11)).toBe("diciembre");
  });

  it("envuelve índices fuera de rango como los meses del calendario", () => {
    expect(nombreMes(12)).toBe("enero");
    expect(nombreMes(-1)).toBe("diciembre");
  });
});

describe("fecha", () => {
  it("sin año cuando coincide con el año actual", () => {
    const ahora = new Date("2026-06-15T10:00:00Z");
    expect(fecha("2026-02-01T00:00:00Z", ahora)).toBe("1 de febrero");
  });

  it("con año cuando es distinto del actual", () => {
    const ahora = new Date("2026-09-27T10:00:00Z");
    expect(fecha("2027-01-01T00:00:00Z", ahora)).toBe("1 de enero de 2027");
  });

  it("usa la hora de Madrid, no la del proceso (UTC en el servidor)", () => {
    // 23:30 UTC del día 31 ya son las 00:30 del 1 de enero en Madrid: el día cambia aunque
    // en UTC siga siendo el 31.
    const ahora = new Date("2026-01-01T00:00:00Z");
    expect(fecha("2025-12-31T23:30:00Z", ahora)).toBe("1 de enero");
  });
});

describe("fraseVsIndice", () => {
  const t = (clave: string, valores?: Record<string, string>) => `${clave}:${valores?.value ?? ""}`;
  it("dice sobre, bajo o igual segun la diferencia redondeada", () => {
    expect(fraseVsIndice(t, 3.14)).toBe("common_ranking_sobre_sp:3,1");
    expect(fraseVsIndice(t, -0.86)).toBe("common_ranking_bajo_sp:0,9");
    expect(fraseVsIndice(t, 0.04)).toBe("common_ranking_igual_sp:");
  });
  it("usa el punto decimal en ingles", () => {
    expect(fraseVsIndice(t, -2, "en")).toBe("common_ranking_bajo_sp:2.0");
  });
});
