import { describe, expect, it } from "vitest";
import { SALAS, SECCIONES, salaDe, seccionDe, tienePadre } from "./salas";

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
    ["/admin/alpha/decisiones/12", "alpha"],
    ["/admin/omega/x", "omega"],
  ])("%s es de la sala %s", (ruta, sala) => {
    expect(salaDe(ruta)).toBe(sala);
  });

  it("no confunde prefijos parecidos ni salas que ya no existen", () => {
    expect(salaDe("/admin/alphabeta")).toBe("vennett");
    expect(salaDe("/admin/agentes")).toBe("vennett");
    expect(salaDe("/admin/beta")).toBe("vennett");
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
    expect(tienePadre("/admin/alpha")).toBe(false);
  });

});

describe("catálogo", () => {
  it("tiene tres salas (Vennett, Alpha y Omega) y solo Archivo marcado como pronto", () => {
    expect(SALAS.map(s => s.clave)).toEqual(["vennett", "alpha", "omega"]);
    expect(SECCIONES.filter(s => s.pronto).map(s => s.clave)).toEqual(["archivo"]);
    expect(SECCIONES).toHaveLength(12);
  });
});
