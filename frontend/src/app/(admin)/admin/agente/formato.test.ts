import { describe, expect, it } from "vitest";
import { bloques, negritas } from "./formato";

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
