import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("conserva las muestras y sus controles al aislar el estilo de escritorio", () => {
  const pagina = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  expect(pagina).toContain('className="scroll muestrario"');
  expect(pagina).toContain('t("strategies_showcase_intro")');
  expect(pagina.match(/<Seccion titulo=/g)).toHaveLength(12);
  expect(pagina).toContain("setCargandoDemo((v) => !v)");
  expect(pagina).toContain('process.env.NODE_ENV === "production"');
  expect(pagina).toContain("notFound()");
});
