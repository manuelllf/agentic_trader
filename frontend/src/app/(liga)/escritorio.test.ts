import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");

it("mantiene las salidas del estado vac?o de Liga", () => {
  const pagina = leer("./liga/page.tsx");
  expect(pagina).toContain('scroll liga-escritorio');
  expect(pagina).toContain('t("league_crear_estrategia")');
  expect(pagina).toContain('t("league_entrar")');
});

it("conserva toda la gesti?n privada: copiar, cambiar código, expulsar y salir", () => {
  // La gestión vive en la hoja de miembros (Hojas.tsx) y las acciones en la página del detalle.
  const pagina = leer("./privadas/[id]/page.tsx") + leer("./privadas/Hojas.tsx");
  for (const accion of ["clipboard.writeText", "rotarCodigoLiga(id)", "expulsarDeLiga(id, alias)", "salirLiga(id)"]) {
    expect(pagina).toContain(accion);
  }
  expect(pagina).toContain("ListaRanking");
});
