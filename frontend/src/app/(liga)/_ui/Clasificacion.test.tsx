import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Clasificacion, HuecoClasificacion } from "./Clasificacion";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

it("conserva filas y huecos y oculta la cabecera en m?vil", () => {
  const salida = renderToStaticMarkup(<Clasificacion><HuecoClasificacion>105</HuecoClasificacion></Clasificacion>);
  expect(salida).toContain('ranking-cabecera" hidden="" aria-hidden="true"');
  expect(salida).toContain('class="gap">105');
  expect(salida).toContain("league_orden_rentabilidad");
  expect(salida).toContain("common_ranking_puntos_balance");
});
