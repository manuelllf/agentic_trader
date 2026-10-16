import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");

it("mantiene las salidas del estado vac?o de Liga", () => {
  const pagina = leer("./liga/page.tsx");
  expect(pagina).toContain('scroll liga-escritorio');
  expect(pagina).toContain('t("league_crear_estrategia")');
  expect(pagina).toContain('t("league_entrar")');
});

it("conserva toda la gesti?n privada junto a la clasificaci?n", () => {
  const pagina = leer("./privadas/[id]/page.tsx");
  for (const accion of ["clipboard.writeText", "rotarCodigoLiga(id)", "expulsarDeLiga(id, m.alias)", "salirLiga(id)"]) {
    expect(pagina).toContain(accion);
  }
  expect(pagina).toContain('miembros-escritorio meta" hidden');
  expect(pagina).toContain('className="priv-clasificacion"');
});
