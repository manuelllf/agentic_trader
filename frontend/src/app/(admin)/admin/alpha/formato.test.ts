import { describe, expect, it } from "vitest";
import { bloques, horaES, horaNY, horasNYyES, negritas } from "./formato";

describe("bloques del texto del agente", () => {
  it("separa títulos, listas y párrafos aunque no haya línea en blanco entre ellos", () => {
    const texto = "# Filosofía\n\n## Cuándo vendo\n- Se rompe la tesis.\n- El negocio empeora.\nNo vendo por ruido.";
    expect(bloques(texto)).toEqual([
      { tipo: "titulo", nivel: 1, texto: "Filosofía" },
      { tipo: "titulo", nivel: 2, texto: "Cuándo vendo" },
      { tipo: "lista", items: ["Se rompe la tesis.", "El negocio empeora."] },
      { tipo: "parrafo", texto: "No vendo por ruido." },
    ]);
  });

  it("une las líneas de un párrafo y continúa un punto con la línea sangrada", () => {
    expect(bloques("Una línea\notra línea\n\n1. Punto\n   que sigue")).toEqual([
      { tipo: "parrafo", texto: "Una línea otra línea" },
      { tipo: "lista", items: ["Punto que sigue"] },
    ]);
  });

  it("texto sin formato queda en párrafos", () => {
    expect(bloques("Primero.\n\nSegundo.")).toEqual([
      { tipo: "parrafo", texto: "Primero." }, { tipo: "parrafo", texto: "Segundo." }]);
  });

  it("marca las negritas en los trozos impares", () => {
    expect(negritas("Regla **mía**, no del código")).toEqual(["Regla ", "mía", ", no del código"]);
  });
});

describe("horas de Nueva York y de Madrid", () => {
  it("en invierno hay 6 horas de diferencia", () => {
    const iso = "2026-11-16T14:35:00Z";
    expect(horaNY(iso, "es")).toBe("09:35");
    expect(horaES(iso, "es")).toBe("15:35");
    expect(horasNYyES(iso, "es")).toBe("09:35 NY · 15:35 Madrid");
  });

  it("entre el cambio de hora de EE. UU. y el de Europa solo hay 5", () => {
    const iso = "2026-03-16T13:35:00Z";
    expect(horaNY(iso, "es")).toBe("09:35");
    expect(horaES(iso, "es")).toBe("14:35");
  });

  it("con segundos cuando se piden", () => {
    const iso = "2026-11-16T14:35:09Z";
    expect(horaNY(iso, "es", true)).toBe("09:35:09");
    expect(horaES(iso, "es", true)).toBe("15:35:09");
  });

  it("cruza la medianoche: el mismo instante cae en días distintos", () => {
    expect(horaNY("2026-11-17T00:30:00Z", "es")).toBe("19:30");
    expect(horaES("2026-11-17T00:30:00Z", "es")).toBe("01:30");
  });
});
