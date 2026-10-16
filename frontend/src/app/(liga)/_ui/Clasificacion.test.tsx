import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Clasificacion, HuecoClasificacion } from "./Clasificacion";
import { FilaEquipo } from "./FilaEquipo";
import mensajes from "../../../../messages/es/league.json";

vi.mock("next-intl", () => ({
  useLocale: () => "es",
  useTranslations: () => (key: string, values?: { numero?: number }) =>
    (key.startsWith("liga_") ? mensajes[key as keyof typeof mensajes] ?? key : key).replace("{numero}", String(values?.numero ?? "")),
}));

it("conserva filas y huecos y oculta la cabecera en m?vil", () => {
  const salida = renderToStaticMarkup(<Clasificacion><HuecoClasificacion>105</HuecoClasificacion></Clasificacion>);
  expect(salida).toContain('ranking-cabecera" hidden="" aria-hidden="true"');
  expect(salida).toContain('class="gap">105');
  expect(salida).toContain("league_orden_rentabilidad");
  expect(salida).toContain("common_ranking_puntos_balance");
});

it("muestra la insignia y la nota de la jornada provisional", () => {
  const respuesta = { jornada_provisional: 7, filas: [{ provisional: true }] };
  const salida = renderToStaticMarkup(
    <Clasificacion jornada_provisional={respuesta.jornada_provisional}>
      <FilaEquipo puesto={1} nombre="Equipo" provisional={respuesta.filas[0].provisional}
        escudo={{ forma: "circulo", dibujo: "liso", color1: "#123456", color2: null, iniciales: null }}
        etiqueta="Alias" vsIndice={0} puntos={3} acumulado={null} />
    </Clasificacion>,
  );
  expect(salida).toContain(">Provisional</span>");
  expect(salida).toContain("La jornada 7 sigue en juego: los puestos son provisionales.");
});
