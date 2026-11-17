// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { expect, it } from "vitest";
import es from "../../messages/es/common.json";
import en from "../../messages/en/common.json";
import FirmaAutor, { enlacesFirma } from "./FirmaAutor";

// Igual que el blog: catálogo bajo el espacio "blog" y traducción con etiquetas.
function firma(idioma: "es" | "en") {
  const t = createTranslator({ locale: idioma, messages: { blog: idioma === "es" ? es : en }, namespace: "blog" }) as unknown as {
    rich: (clave: string, valores: Record<string, unknown>) => React.ReactNode;
  };
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<FirmaAutor>{t.rich("firma_articulo", { autor: "Manuel", ...enlacesFirma(idioma) })}</FirmaAutor>);
  return host;
}

it.each([
  ["es", "Lo escribe Manuel.", ["quiénes somos", "/quienes-somos"], ["política editorial", "/politica-editorial"]],
  ["en", "Written by Manuel.", ["about page", "/en/quienes-somos"], ["editorial policy", "/en/politica-editorial"]],
] as const)("la firma en %s lleva a Quiénes somos y a la política editorial", (idioma, inicio, uno, dos) => {
  const host = firma(idioma);
  expect(host.querySelector("p.firma-autor")?.textContent).toContain(inicio);
  expect([...host.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([[...uno], [...dos]]);
});
