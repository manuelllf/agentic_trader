import { afterEach, describe, expect, it, vi } from "vitest";
import { bienvenidaVista, borrar, cargarPartida, clavePartida, escribir, guardarBienvenida, guardarPartida, nuevaPartida } from "./partida";
import { fechaMadrid, reloj, segundosHastaMedianoche } from "./reloj";

const a = { idioma: "es" as const, numero: 14, longitud: 5 };
function memoria() {
  const datos = new Map<string, string>();
  return { getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => { datos.set(clave, valor); } };
}
afterEach(() => vi.unstubAllGlobals());
describe("partidas", () => {
  it("guarda letras, ayudas y resultado separados por idioma y número", () => {
    const storage = memoria();
    const p = { ...nuevaPartida(5), letras: ["R", "E", "", "", ""], ayudas: ["def" as const] };
    guardarPartida(a, p, storage);
    expect(cargarPartida(a, storage)).toEqual(p);
    expect(cargarPartida({ ...a, idioma: "en" }, storage)).toEqual(nuevaPartida(5));
    expect(cargarPartida({ ...a, numero: 13 }, storage)).toEqual(nuevaPartida(5));
  });
  it("se recupera de datos corruptos o de otra longitud", () => {
    const storage = memoria();
    for (const datos of ["{", "null", JSON.stringify({ ...nuevaPartida(5), letras: ["A"] }),
      JSON.stringify({ ...nuevaPartida(5), ayudas: ["otra"] }),
      JSON.stringify({ ...nuevaPartida(5), resultado: "resuelto" }),
      JSON.stringify({ ...nuevaPartida(5), letras: [5, "", "", "", ""] })]) {
      storage.setItem(clavePartida("es", 14), datos);
      expect(cargarPartida(a, storage)).toEqual(nuevaPartida(5));
    }
  });
  it("sigue funcionando si localStorage rechaza lecturas o escrituras", () => {
    const storage = { getItem: () => { throw new Error("denegado"); }, setItem: () => { throw new Error("cuota"); } };
    vi.stubGlobal("localStorage", storage);
    expect(cargarPartida(a)).toEqual(nuevaPartida(5));
    expect(() => guardarPartida(a, nuevaPartida(5))).not.toThrow();
    expect(bienvenidaVista()).toBe(false);
    expect(() => guardarBienvenida()).not.toThrow();
  });
  it("recuerda la bienvenida", () => {
    const storage = memoria();
    expect(bienvenidaVista(storage)).toBe(false);
    guardarBienvenida(storage);
    expect(bienvenidaVista(storage)).toBe(true);
  });
  it("fija la primera letra, normaliza las otras y borra hacia atrás", () => {
    const p = { ...nuevaPartida(5), letras: ["R", "", "", "", ""], ayudas: ["letra" as const] };
    expect(escribir(p, 0, "X", "es")).toBe(p);
    const siguiente = escribir(p, 1, "é", "es");
    expect(siguiente.letras).toEqual(["R", "E", "", "", ""]);
    const borrada = borrar(siguiente, 2);
    expect(borrada.indice).toBe(1);
    expect(borrada.partida.letras).toEqual(p.letras);
    expect(borrar(p, 1).partida).toBe(p);
    expect(escribir({ ...p, resultado: "solucion" }, 2, "A", "es").letras).toEqual(p.letras);
  });
});
describe("medianoche de Madrid", () => {
  it("usa Madrid aunque en UTC todavía sea el día anterior", () => {
    expect(fechaMadrid(new Date("2026-10-22T23:30:00Z"))).toBe("2026-10-23");
    expect(reloj(segundosHastaMedianoche(new Date("2026-10-23T21:59:59Z")))).toBe("00:00:01");
  });
  it("cuenta las horas reales durante los dos cambios de horario", () => {
    expect(segundosHastaMedianoche(new Date("2026-03-28T23:00:00Z"))).toBe(23 * 3600);
    expect(segundosHastaMedianoche(new Date("2026-10-24T22:00:00Z"))).toBe(25 * 3600);
  });
});
