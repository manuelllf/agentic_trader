import { readFileSync } from "node:fs";
import { parse } from "postcss";
import { expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const css = parse(leer("./admin.css"));

it("limita los estilos de escritorio a 880 px y a las pantallas del encargo", () => {
  let reglas = 0;
  css.walkRules((regla) => {
    if (!regla.selector.includes(".admin-")) return;
    reglas++;
    expect(regla.parent?.type).toBe("atrule");
    expect(regla.parent && "params" in regla.parent && regla.parent.params).toBe("(min-width: 880px)");
    regla.walkDecls((decl) => expect(decl.prop).not.toMatch(/color|background|font|shadow/));
  });
  expect(reglas).toBeGreaterThan(10);
});

it("conserva el contenedor móvil en cada pantalla y amplía a 960 px", () => {
  for (const ruta of ["page.tsx", "liga/page.tsx", ...[
    "usuarios", "usuarios/[id]", "auditoria", "premio", "ajustes", "coste-ia", "errores", "moderacion",
  ].map((ruta) => `liga/${ruta}/page.tsx`)]) {
    expect(leer(`./admin/${ruta}`)).toContain("admin-escritorio mx-auto max-w-md px-4");
  }
  expect(leer("./admin.css")).toContain("max-width: 960px");
});

it("distribuye salas, procesos y usuarios sin quitar la paginación", () => {
  expect(leer("./admin/page.tsx")).toContain("admin-salas mt-4 border-t");
  expect(leer("./admin/liga/page.tsx")).toContain('className="admin-procesos"');
  expect(leer("./admin.css")).toContain("repeat(2, minmax(0, 1fr))");
  expect(leer("./admin.css")).toContain("width: 480px");
  expect(leer("./admin.css")).toContain("minmax(0, 1fr) minmax(0, 1fr) 24px");
  const usuarios = leer("./admin/liga/usuarios/page.tsx");
  expect(usuarios).toContain("admin-buscador mt-4 flex gap-2");
  expect(usuarios).toContain("admin-usuario flex min-h-[56px]");
  expect(usuarios).toContain('t("admin_previous")');
  expect(usuarios).toContain('t("admin_next")');
});
