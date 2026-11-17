import { describe, expect, it } from "vitest";
import { agruparPorMes, ayudaLocal, buscar, cuadriculaDelMes, fechaDeNumero, resueltoLocal } from "./archivo";
import { clavePartida } from "./partida";

const pista = (texto: string) => [{ texto, papel: null }];
const indice = [
  { numero: 1, fecha: "2026-11-02", nivel: "facil" as const, longitud: 5, pista: pista("Un árbol sagrado esconde el mercado de valores") },
  { numero: 2, fecha: "2026-11-03", nivel: "facil" as const, longitud: 5, pista: pista("Traen en desorden lo que ingresas") },
  { numero: 3, fecha: "2026-10-30", nivel: "media" as const, longitud: 7, pista: pista("Un club de Milán es lo que pagas por un préstamo") },
];

describe("archivo del críptico", () => {
  it("agrupa por mes del más reciente al más antiguo, con el número más alto primero", () => {
    const meses = agruparPorMes(indice);
    expect(meses.map(mes => mes.clave)).toEqual(["2026-11", "2026-10"]);
    expect(meses[0].entradas.map(entrada => entrada.numero)).toEqual([2, 1]);
  });

  it("dibuja la cuadrícula de lunes a domingo; noviembre de 2026 empieza en domingo", () => {
    const celdas = cuadriculaDelMes("2026-11");
    expect(celdas.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(celdas[6]).toEqual({ dia: 1, fecha: "2026-11-01" });
    expect(celdas.length % 7).toBe(0);
    expect(celdas.filter(Boolean)).toHaveLength(30);
  });

  it("busca por número exacto y por la fecha ya formateada", () => {
    expect(buscar(indice, "2", () => "")).toEqual([indice[1]]);
    expect(buscar(indice, "3 nov", fecha => (fecha === "2026-11-03" ? "3 nov" : ""))).toEqual([indice[1]]);
    expect(buscar(indice, "   ", () => "")).toEqual([]);
  });

  it("busca también en la pista, sin tildes ni mayúsculas", () => {
    expect(buscar(indice, "ARBOL", () => "")).toEqual([indice[0]]);
    expect(buscar(indice, "milan", () => "")).toEqual([indice[2]]);
    expect(buscar(indice, "préstamo", () => "")).toEqual([indice[2]]);
    expect(buscar(indice, "inexistente", () => "")).toEqual([]);
  });

  it("calcula la fecha de cada número a partir del actual, cruzando fin de mes", () => {
    expect(fechaDeNumero("2026-11-11", 10, 9)).toBe("2026-11-10");
    expect(fechaDeNumero("2026-11-11", 10, 12)).toBe("2026-11-13");
    expect(fechaDeNumero("2026-11-02", 1, 30)).toBe("2026-12-01");
  });

  it("sabe si un acertijo está resuelto en este dispositivo, por idioma y número", () => {
    const almacen = { getItem: (clave: string) => (clave === clavePartida("es", 1) ? JSON.stringify({ resultado: "resuelto" }) : null) };
    expect(resueltoLocal("es", 1, almacen)).toBe(true);
    expect(resueltoLocal("es", 2, almacen)).toBe(false);
    expect(resueltoLocal("en", 1, almacen)).toBe(false);
    expect(resueltoLocal("es", 1, undefined)).toBe(false);
  });

  it("distingue lo resuelto con ayuda de lo resuelto sin ella", () => {
    const almacen = { getItem: (clave: string) => (clave === clavePartida("es", 1) ? JSON.stringify({ resultado: "solucion" }) : null) };
    expect(resueltoLocal("es", 1, almacen)).toBe(true);
    expect(ayudaLocal("es", 1, almacen)).toBe(true);
    expect(ayudaLocal("es", 2, almacen)).toBe(false);
  });
});
