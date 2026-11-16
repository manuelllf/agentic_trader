import { describe, expect, it } from "vitest";
import { SALAS, SECCIONES, esPantallaNueva, salaDe, seccionDe, tienePadre } from "./salas";

describe("salaDe", () => {
  it.each([
    ["/admin", "vennett"],
    ["/admin/", "vennett"],
    ["/admin/liga", "vennett"],
    ["/admin/liga/usuarios/123", "vennett"],
    ["/admin/blog", "vennett"],
    ["/admin/datos", "vennett"],
    ["/admin/archivo", "vennett"],
    ["/admin/alpha", "alpha"],
    ["/admin/alpha/informe/3", "alpha"],
    ["/admin/beta", "beta"],
    ["/admin/omega/x", "omega"],
    ["/admin/agente", "alphagentic"],
    ["/admin/agente/hoy", "alphagentic"],
  ])("%s es de la sala %s", (ruta, sala) => {
    expect(salaDe(ruta)).toBe(sala);
  });

  it("no confunde prefijos parecidos", () => {
    expect(salaDe("/admin/alphabeta")).toBe("vennett");
    expect(salaDe("/admin/agentes")).toBe("vennett");
  });
});

describe("seccionDe y tienePadre", () => {
  it("identifica la sección por ruta real", () => {
    expect(seccionDe("/admin/liga/jornadas")).toBe("jornadas");
    expect(seccionDe("/admin/liga/usuarios/123")).toBe("usuarios");
    expect(seccionDe("/admin/liga/coste-ia")).toBe("coste");
    expect(seccionDe("/admin/blog/nuevo")).toBe("boletin");
    expect(seccionDe("/admin")).toBeNull();
    expect(seccionDe("/admin/liga")).toBeNull();
    expect(seccionDe("/admin/omega")).toBeNull();
  });

  it("solo Vennett fuera del inicio tiene padre", () => {
    expect(tienePadre("/admin")).toBe(false);
    expect(tienePadre("/admin/liga/jornadas")).toBe(true);
    expect(tienePadre("/admin/liga")).toBe(true);
    expect(tienePadre("/admin/omega")).toBe(false);
    expect(tienePadre("/admin/agente")).toBe(false);
  });

  it("solo la Alpha antigua y Beta conservan su aspecto", () => {
    expect(esPantallaNueva("/admin")).toBe(true);
    expect(esPantallaNueva("/admin/liga/usuarios")).toBe(true);
    expect(esPantallaNueva("/admin/omega")).toBe(true);
    expect(esPantallaNueva("/admin/alpha")).toBe(false);
    expect(esPantallaNueva("/admin/beta/x")).toBe(false);
  });
});

describe("catálogo", () => {
  it("tiene cinco salas y solo Archivo marcado como pronto", () => {
    expect(SALAS.map(s => s.clave)).toEqual(["vennett", "alpha", "beta", "omega", "alphagentic"]);
    expect(SECCIONES.filter(s => s.pronto).map(s => s.clave)).toEqual(["archivo"]);
    expect(SECCIONES).toHaveLength(12);
  });
});
