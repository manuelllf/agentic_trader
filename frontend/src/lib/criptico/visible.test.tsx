import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Portada } from "@/app/(liga)/_portada/Portada";

const config = vi.hoisted(() => ({ visible: false, idioma: "es" }));
vi.mock("./visible", () => ({ get CRIPTICO_VISIBLE() { return config.visible; } }));
vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave, useLocale: () => config.idioma }));
vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("@/app/(liga)/_sesion/SesionContext", () => ({ useRedirigirSiHaySesion: () => "fuera" }));
vi.mock("@/app/(liga)/_portada/Pelicula", () => ({ Pelicula: () => null }));

it.each(["es", "en"])("el enlace de la landing en %s depende del interruptor", idioma => {
  config.idioma = idioma;
  config.visible = false;
  expect(renderToStaticMarkup(<Portada />)).not.toContain("/criptico");
  config.visible = true;
  const html = renderToStaticMarkup(<Portada />);
  expect(html).toContain(`href="${idioma === "en" ? "/en" : ""}/criptico"`);
  expect(html).toContain("landing_criptico");
});
