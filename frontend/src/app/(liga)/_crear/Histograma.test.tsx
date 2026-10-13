// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Histograma, posicion } from "./Histograma";
function barras(desde: number, hasta: number) {
  const div = document.createElement("div");
  div.innerHTML = renderToStaticMarkup(<Histograma barras={Array(36).fill(10)} desde={desde} hasta={hasta} />);
  return div;
}
it("marca el intervalo lineal y conserva 36 barras", () => {
  const div = barras(posicion(25, 0, 100), posicion(75, 0, 100));
  expect(div.querySelectorAll("rect")).toHaveLength(36);
  expect(div.querySelectorAll(".si")).toHaveLength(18);
  expect(div.querySelector("rect")?.getAttribute("fill")).toBe("var(--surface2)");
});
it("marca el intervalo logarítmico usando la posición del valor", () => {
  expect(posicion(10, 1, 100, true)).toBeCloseTo(0.5);
  expect(barras(posicion(10, 1, 100, true), 1).querySelectorAll(".si")).toHaveLength(18);
});
it("marca los extremos y un intervalo vacío", () => {
  expect(barras(0, 1).querySelectorAll(".si")).toHaveLength(36);
  expect(barras(1, 0).querySelectorAll(".si")).toHaveLength(0);
});
