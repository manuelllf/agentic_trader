import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Cuerpo } from "./componentes";

const html = (cuerpo: string) => renderToStaticMarkup(<Cuerpo cuerpo={cuerpo} />);

it("muestra las imágenes de la carpeta del blog, también los SVG", () => {
  const salida = html("![Cómo decide Alpha](/blog/img/figura.svg)");
  expect(salida).toContain('<img src="/blog/img/figura.svg" alt="Cómo decide Alpha"');
  expect(salida).toContain('loading="lazy"');
});

it("con título pone un pie debajo de la imagen", () => {
  const salida = html('![alt](/blog/img/tarjeta.png "Tarjeta de venta")');
  expect(salida).toContain('<span class="blog-fig">');
  expect(salida).toContain('<span class="blog-fig-pie">Tarjeta de venta</span>');
});

it("un vídeo propio sale mudo, en bucle y con su texto accesible", () => {
  const salida = html("![Demo](/blog/img/demo.mp4)");
  expect(salida).toContain('<video src="/blog/img/demo.mp4"');
  expect(salida).toMatch(/muted/);
  expect(salida).toContain('aria-label="Demo"');
});

it("las imágenes de fuera, los data: y las rutas con «..» quedan en su texto alternativo", () => {
  for (const src of ["https://ejemplo.com/a.png", "data:image/svg+xml,<svg/>", "/blog/img/../../x.png", "/otra/a.png"]) {
    const salida = html(`![solo texto](${src})`);
    expect(salida, src).not.toContain("<img");
    expect(salida, src).not.toContain("<video");
    expect(salida, src).toContain("solo texto");
  }
});

it("las imágenes con referencia también se filtran", () => {
  const salida = html("![fuera][r]\n\n[r]: https://ejemplo.com/a.png");
  expect(salida).not.toContain("<img");
});
