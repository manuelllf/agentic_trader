import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { porcentaje } from "@/lib/liga/format";
import { FilaEquipo } from "./FilaEquipo";
import { escudoCasa } from "./Escudo";

vi.mock("next-intl", async () => {
  const [common, strategies, league] = await Promise.all([
    import("../../../../messages/es/common.json"), import("../../../../messages/es/strategies.json"),
    import("../../../../messages/es/league.json"),
  ]);
  const catalogo = { ...common.default, ...strategies.default, ...league.default } as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (catalogo[key] ?? key).replace(/\{(\w+)\}/g, (_, nombre: string) => String(values?.[nombre] ?? `{${nombre}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});

const acumulado = { rentabilidad: 12.4, sp500: 8.3, diferencia_pp: 4.1, desde: "2026-01-02", hasta: "2026-07-30", periodos: 6, incompleta: false };
const base = { puesto: 1, nombre: "Alpha", escudo: escudoCasa("alpha"), etiqueta: "de la casa", vsIndice: 4.1,
  puntos: 21, movimiento: 2, acumulado, abrible: false };
const html = (props: Record<string, unknown>) => renderToStaticMarkup(<FilaEquipo {...base} {...props} />);

describe("FilaEquipo ordenada", () => {
  it("muestra puntos, balance y movimiento en orden de puntos", () => {
    const salida = html({ orden: "puntos", ganadas: 6, empatadas: 3, perdidas: 0 });
    expect(salida).toContain("21 pts");
    expect(salida).toContain("6G · 3E · 0P");
    expect(salida).toContain("↑2");
    expect(salida).not.toContain(porcentaje(12.4, 1, "es"));
  });
  it("oculta el movimiento en rentabilidad y conserva la rentabilidad", () => {
    const salida = html({ orden: "rentabilidad" });
    expect(salida).not.toContain("↑2");
    expect(salida).toContain(porcentaje(12.4, 1, "es"));
  });
  it("conserva las flechas para los llamadores antiguos", () => {
    expect(html({ orden: undefined })).toContain("↑2");
  });
  it("omite el balance si falta alguno de sus recuentos", () => {
    expect(html({ orden: "puntos", empatadas: 3, perdidas: 0 })).not.toContain("G · ");
  });
});
