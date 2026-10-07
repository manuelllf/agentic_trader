import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TarjetaEstrategia, type TarjetaEstrategiaProps } from "./TarjetaEstrategia";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));

const base: TarjetaEstrategiaProps = {
  id: "estrategia-1", nombre: "Foso ancho",
  escudo: { forma: "escudo", dibujo: "liso", color1: "#1D3A6E" },
  escudoEtiqueta: "Escudo de Foso ancho", estado: "Jugando", punto: "jugando",
  abrible: true, ajustesAbiertos: false, ajustesEtiqueta: "Ajustes de estrategia",
  onAjustes: () => {}, alAcercar: () => {},
};
const html = (props: Partial<TarjetaEstrategiaProps> = {}) => renderToStaticMarkup(<TarjetaEstrategia {...base} {...props} />);

describe("TarjetaEstrategia", () => {
  it("muestra puesto y movimientos solo cuando hay puesto", () => {
    const subida = html({ puesto: 3, movimiento: 1 });
    expect(subida).toContain('class="mias-pos num"');
    expect(subida).toContain('>3<small class="up">↑1</small>');
    expect(html({ puesto: 3, movimiento: -2 })).toContain("↓2");
    expect(html({ puesto: 3, movimiento: 0 })).not.toContain('class="up"');
    expect(html()).not.toContain("mias-pos");
    expect(html()).toContain('class="mias-cab sinpos"');
  });

  it("muestra el mes y su diferencia con el mismo color", () => {
    const mes = html({ mes: { etiqueta: "Este mes", valor: "+3,2 %", clase: "up", dif: "+1,4 pp" } });
    expect(mes).toContain("Este mes");
    expect(mes).toContain('<b class="num up">+3,2 %</b>');
    expect(mes).toContain('<small class="num up">+1,4 pp</small>');
    expect(html({ mes: null })).not.toContain("mias-res");
  });

  it("muestra el premio solo cuando se proporciona", () => {
    expect(html({ premio: "En el premio" })).toContain("En el premio");
    expect(html()).not.toContain("En el premio");
  });

  it("controla el enlace extendido y los ajustes conservando los pies", () => {
    expect(html()).toContain('class="mias-estrategia abrible"');
    const nodos = { lineas: <div>Pie permanente</div>, ajustes: <div>Panel de ajustes</div> };
    const abierta = html({ ...nodos, abrible: false, ajustesAbiertos: true });
    expect(abierta).toContain('class="mias-estrategia"');
    expect(abierta).not.toContain("abrible");
    expect(abierta).toMatch(/<button[^>]*aria-expanded="true"/);
    expect(abierta).toContain("Panel de ajustes");
    expect(abierta).toContain("Pie permanente");
    const cerrada = html({ ...nodos, ajustesAbiertos: false });
    expect(cerrada).not.toContain("Panel de ajustes");
    expect(cerrada).toContain("Pie permanente");
  });

  it("indica cuando está ocupada", () => {
    expect(html({ ocupada: true })).toContain('aria-busy="true"');
    expect(html()).not.toContain("aria-busy");
  });

  it("enlaza a la ficha y etiqueta el botón de ajustes", () => {
    expect(html()).toContain('href="/ficha/estrategia-1"');
    expect(html()).toMatch(/<button[^>]*aria-label="Ajustes de estrategia"/);
  });
});
