import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("agrupa la cabecera sin perder el recuento, crear ni la gesti?n de estrategias", () => {
  const pagina = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  expect(pagina).toContain('className="mias-encabezado"');
  for (const texto of ["strategies_count", "strategies_with_news", "strategies_create", "strategies_empty_title"]) {
    expect(pagina).toContain(`t("${texto}"`);
  }
  for (const accion of ["alApuntar(e.id)", "alDesapuntar(e.id)", "alBorrar(e.id, e.nombre)", "alCambiarCadaDia1(e.id, v)"]) {
    expect(pagina).toContain(accion);
  }
});
