// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { anotarTitulo, cambioDeRuta, leerOrigen, tituloLimpio } from "./origen";

beforeEach(() => window.sessionStorage.clear());

describe("origen de la pantalla", () => {
  it("al avanzar, la pantalla nueva conoce la anterior con su título limpio", () => {
    cambioDeRuta("/liga"); anotarTitulo("/liga", "Liga · Vennett");
    cambioDeRuta("/como-funciona"); anotarTitulo("/como-funciona", "Cómo funciona · Vennett");
    expect(leerOrigen("/como-funciona")).toEqual({ ruta: "/liga", titulo: "Liga" });
    cambioDeRuta("/legal/terminos");
    expect(leerOrigen("/legal/terminos")).toEqual({ ruta: "/como-funciona", titulo: "Cómo funciona" });
  });

  it("al volver, baja la pila y la de debajo recupera su origen", () => {
    cambioDeRuta("/liga"); anotarTitulo("/liga", "Liga · Vennett");
    cambioDeRuta("/como-funciona"); anotarTitulo("/como-funciona", "Cómo funciona · Vennett");
    cambioDeRuta("/legal/terminos");
    cambioDeRuta("/como-funciona");
    expect(leerOrigen("/como-funciona")).toEqual({ ruta: "/liga", titulo: "Liga" });
  });

  it("sin pantalla anterior (enlace de fuera) no hay origen", () => {
    cambioDeRuta("/premio");
    expect(leerOrigen("/premio")).toBeNull();
  });

  it("limpia el sufijo de la marca", () => {
    expect(tituloLimpio("Premio anual · Vennett")).toBe("Premio anual");
  });
});
