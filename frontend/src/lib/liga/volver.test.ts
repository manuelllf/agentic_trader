// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardarVolver, leerVolver } from "./volver";

afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); });

describe("volver", () => {
  it("guarda y lee texto y ruta para la ficha que se abre", () => {
    guardarVolver("Mías", "/mias", "e1");
    expect(leerVolver("e1")).toEqual({ texto: "Mías", ruta: "/mias" });
  });

  it("no sirve para otra ficha a la que se llega por enlace", () => {
    guardarVolver("Mías", "/mias", "e1");
    expect(leerVolver("e2")).toBeNull();
  });

  it("sin nada guardado o con basura devuelve null", () => {
    expect(leerVolver("e1")).toBeNull();
    window.sessionStorage.setItem("liga.volver", "no es json");
    expect(leerVolver("e1")).toBeNull();
    window.sessionStorage.setItem("liga.volver", JSON.stringify({ texto: 3, fichaId: "e1" }));
    expect(leerVolver("e1")).toBeNull();
  });

  it("no rompe si sessionStorage falla", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("bloqueado"); });
    expect(() => guardarVolver("Liga", "/liga", "e1")).not.toThrow();
    expect(leerVolver("e1")).toBeNull();
  });
});
