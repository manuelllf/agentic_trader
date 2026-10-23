import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Clasificacion, HuecoClasificacion } from "./Clasificacion";
import { FilaEquipo } from "./FilaEquipo";
import mensajes from "../../../../messages/es/league.json";

vi.mock("next-intl", () => ({
  useLocale: () => "es",
  useTranslations: () => (key: string, values?: { numero?: number; total?: number }) =>
    (key.startsWith("liga_") ? mensajes[key as keyof typeof mensajes] ?? key : key)
      .replace("{numero}", String(values?.numero ?? ""))
      .replace("{total}", String(values?.total ?? "")),
}));

it("conserva filas y huecos y oculta la cabecera en m?vil", () => {
  const salida = renderToStaticMarkup(<Clasificacion><HuecoClasificacion>105</HuecoClasificacion></Clasificacion>);
  expect(salida).toContain('ranking-cabecera" hidden="" aria-hidden="true"');
  expect(salida).toContain('class="gap">105');
  expect(salida).toContain("league_orden_rentabilidad");
  expect(salida).toContain("common_ranking_puntos_balance");
});

it("muestra la nota de la jornada provisional sin etiquetar cada fila", () => {
  const salida = renderToStaticMarkup(
    <Clasificacion jornada_provisional={7} temporada={{ n_jornadas: 52 }}>
      <FilaEquipo puesto={1} nombre="Equipo"
        escudo={{ forma: "circulo", dibujo: "liso", color1: "#123456", color2: null, iniciales: null }}
        etiqueta="Alias" vsIndice={0} puntos={3} acumulado={null} />
    </Clasificacion>,
  );
  expect(salida).not.toContain(">Provisional</span>");
  expect(salida).toContain("La jornada 7 de 52 sigue en juego: los puestos son provisionales.");
});
