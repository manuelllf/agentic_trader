import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CabeceraApp } from "./CabeceraApp";

vi.mock("../_sesion/Sesion", () => ({ Sesion: () => <button className="puntos" /> }));

describe("CabeceraApp", () => {
  it("muestra el sello y año sin título en modo Liga", () => {
    const html = renderToStaticMarkup(<CabeceraApp anio={2026} />);
    expect(html).toContain("2026");
    expect(html).toContain('class="sello"');
    expect(html).not.toContain("<h1");
  });
  it("centra el título sin sello en las demás pantallas", () => {
    const html = renderToStaticMarkup(<CabeceraApp titulo="Ligas privadas" />);
    expect(html).toContain('<h1 class="cab-titulo">Ligas privadas</h1>');
    expect(html).not.toContain("sello");
  });
  it("pone el menú de la cuenta antes del sello y antes del título", () => {
    const conSello = renderToStaticMarkup(<CabeceraApp anio={2026} />);
    expect(conSello.indexOf('class="puntos"')).toBeLessThan(conSello.indexOf('class="sello"'));
    const conTitulo = renderToStaticMarkup(<CabeceraApp titulo="Ligas privadas" />);
    expect(conTitulo.indexOf('class="puntos"')).toBeLessThan(conTitulo.indexOf("<h1"));
  });
});
