import { expect, it } from "vitest";
import { medioPropio, rutaTarjeta } from "./imagenes";

it("admite imágenes y vídeos de la carpeta del blog", () => {
  expect(medioPropio("/blog/img/figura.svg")).toEqual({ tipo: "imagen", src: "/blog/img/figura.svg" });
  expect(medioPropio("/blog/img/tarjeta-en.PNG")).toEqual({ tipo: "imagen", src: "/blog/img/tarjeta-en.PNG" });
  expect(medioPropio("/blog/img/demo.webm")).toEqual({ tipo: "video", src: "/blog/img/demo.webm" });
});

it("rechaza URLs de fuera, esquemas raros y rutas que se salen de la carpeta", () => {
  for (const src of [
    "https://ejemplo.com/blog/img/a.png", "//ejemplo.com/blog/img/a.png", "javascript:alert(1)", "data:image/svg+xml,<svg/>",
    "/otra/img/a.png", "/blog/img/../../secreto.png", "/blog/img/sub/a.png", "/blog/img/a.png?x=1", "/blog/img/", "/blog/img/.oculto.png",
  ]) expect(medioPropio(src), src).toBeNull();
});

it("rechaza extensiones que no son imagen ni vídeo", () => {
  expect(medioPropio("/blog/img/script.js")).toBeNull();
  expect(medioPropio("/blog/img/pagina.html")).toBeNull();
  expect(medioPropio(undefined)).toBeNull();
});

it("la tarjeta de un artículo tiene su ruta por idioma y solo con slugs sanos", () => {
  expect(rutaTarjeta("alpha-vendio-nvda", "es")).toBe("/blog/img/alpha-vendio-nvda-tarjeta.png");
  expect(rutaTarjeta("alpha-vendio-nvda", "en")).toBe("/blog/img/alpha-vendio-nvda-tarjeta-en.png");
  expect(rutaTarjeta("../etc/passwd", "es")).toBeNull();
  expect(rutaTarjeta("con/barra", "es")).toBeNull();
  expect(rutaTarjeta("", "es")).toBeNull();
});
