import { describe, expect, it } from "vitest";
import { marcarSegmentos } from "./pista";
import type { Segmento } from "./tipos";

const pista: Segmento[] = [
  { texto: "Terna", papel: "mat" }, { texto: " ", papel: null },
  { texto: "revuelta", papel: "ind" }, { texto: ": ingresos", papel: "def" },
];
describe("segmentos de la pista", () => {
  it("marca solo el papel de las ayudas usadas y conserva texto, orden y original", () => {
    const marcada = marcarSegmentos(pista, ["def", "letra"]);
    expect(marcada.map(s => s.marcado)).toEqual([false, false, false, true]);
    expect(marcada.map(s => s.texto).join("")).toBe("Terna revuelta: ingresos");
    expect(pista[0]).not.toHaveProperty("marcado");
  });
  it("desmonta todos los papeles al terminar, sin marcar los enlaces", () => {
    expect(marcarSegmentos(pista, [], true).map(s => s.marcado)).toEqual([true, false, true, true]);
    expect(marcarSegmentos(pista, []).every(s => !s.marcado)).toBe(true);
  });
});
