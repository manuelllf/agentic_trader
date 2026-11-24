// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

const sesion = vi.hoisted(() => ({ valor: "fuera" as "cargando" | "fuera" | "dentro" }));
vi.mock("../_sesion/SesionContext", () => ({ useRedirigirSiHaySesion: () => sesion.valor }));
vi.mock("@/i18n/Provider", () => ({ useLanguage: () => ({ changing: false, selectLocale: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("./portada.css", () => ({}));
vi.mock("../_ui/hoja.css", () => ({}));
vi.mock("@/components/selector-idioma.css", () => ({}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: (p: { href: string; className?: string; children?: unknown }) =>
    React.createElement("a", { href: p.href, className: p.className }, p.children as never) };
});
import esLanding from "../../../../messages/es/landing.json";
import esCommon from "../../../../messages/es/common.json";
import enLanding from "../../../../messages/en/landing.json";
import enCommon from "../../../../messages/en/common.json";
import type { EstadoCriptico } from "@/lib/criptico/estado";
import type { PortadaDemo } from "@/lib/liga/portada";
import { Portada } from "./Portada";
import type { BoletinPortada } from "./Secciones";

const MENSAJES = { es: { ...esLanding, ...esCommon }, en: { ...enLanding, ...enCommon } };
const N = 5723, VACIO = "0".repeat(Math.ceil(N / 4));
const estilo = (pasan: number) => ({
  pasan, mapa: VACIO,
  cinco: [["MU", "Micron Technology", 14, 82.7], ["SKHY", "SK hynix", 13, 81.8], ["FSM", "Fortuna Mining", 1800, 79.8],
    ["AU", "AngloGold Ashanti", 372, 79], ["SQM", "Sociedad Química y Minera", 680, 78.6]]
    .map(([ticker, nombre, rango, nota]) => ({ ticker: ticker as string, nombre: nombre as string, rango: rango as number, nota: nota as number })),
  reglas: [{ clave: "rentables", params: { roe_pct: 15 }, detalle: "ROE de al menos 15 %" },
    { clave: "nueva", params: {}, detalle: "Una regla sin texto propio" }],
});
const DEMO: PortadaDemo = {
  foto_id: 2, notas_del: "2026-10-30T22:00:00+00:00", total: N,
  anillos: [{ rango: 162, musd: 100000 }, { rango: 900, musd: 10000 }, { rango: 2508, musd: 1000 }],
  estilos: Object.fromEntries(["calidad", "dividendo", "crecimiento", "maduros", "balance", "castigadas", "pequenas"].map((c, i) => [c, estilo(523 - i)])),
  semana: { dia_inicio: "2026-11-16", dia_fin: "2026-11-20", sp: -8.6, casa: [
    { casa: "alpha", rentabilidad: -10.2, dif_sp: -1.6, puntos: 0 },
    { casa: "lambda", rentabilidad: -18.5, dif_sp: -9.9, puntos: 0 },
    { casa: "omega", rentabilidad: -49.2, dif_sp: -40.6, puntos: 0 },
  ] },
};
const HOY: EstadoCriptico = { tipo: "hoy", id: 7, longitud: 4, pista: "Subida de precios: alzar sin su última letra", numero: 23, nivel: "facil" };
const ARTICULO: BoletinPortada = { slug: "alpha-vendio-nvda", titulo: "Alpha vendió Nvidia", resumen: "Esto es lo que cambié.", minutos: 6 };

function pintar({ demo = DEMO, criptico = HOY, boletin = ARTICULO, idioma = "es" }: {
  demo?: PortadaDemo | null; criptico?: EstadoCriptico; boletin?: BoletinPortada; idioma?: "es" | "en";
} = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<NextIntlClientProvider locale={idioma} messages={MENSAJES[idioma]} timeZone="Europe/Madrid">
    <Portada demo={demo} criptico={criptico} boletin={boletin} />
  </NextIntlClientProvider>);
  return host;
}

describe("Portada", () => {
  it("con sesión no pinta nada: va a la liga", () => {
    sesion.valor = "dentro";
    expect(pintar().innerHTML).toBe("");
    sesion.valor = "fuera";
  });

  it("mientras se comprueba la sesión ya pinta el contenido, para que el HTML del servidor lo lleve", () => {
    sesion.valor = "cargando";
    const el = pintar();
    expect(el.querySelector("h1")!.textContent).toBe("De 5.723 empresas, esta idea deja 523 y elige 5.");
    expect(el.querySelector(".ceja")!.textContent).toBe("Liga de estrategias de inversión en papel");
    sesion.valor = "fuera";
  });

  it("las 7 ideas salen en el carrusel y en la lista, con la primera elegida", () => {
    const el = pintar();
    expect(el.querySelectorAll(".tarjeta")).toHaveLength(7);
    expect(el.querySelectorAll('.opcion[role="radio"]')).toHaveLength(7);
    expect(el.querySelector('.opcion[aria-checked="true"] .n')!.textContent).toBe("Calidad a precio razonable");
    expect(el.querySelector(".estrella")!.textContent).toBe("1. Micron Technology (MU), grande, nota 82,7");
  });

  it("por dentro enseña las 5, las reglas con su texto llano y la fecha de la foto", () => {
    const el = pintar();
    expect(el.querySelector("#dentro-t")!.textContent).toBe("Calidad a precio razonable, por dentro");
    expect([...el.querySelectorAll(".cinco .nom")].map((n) => n.textContent)).toHaveLength(5);
    expect(el.querySelector(".cinco .sub")!.textContent).toBe("MU, grande");
    const reglas = [...el.querySelectorAll(".reglas .t")].map((n) => n.textContent);
    expect(reglas).toEqual(["Gana más de 15 € por cada 100 € de sus accionistas", "Una regla sin texto propio"]);
    expect(el.textContent).toContain("Foto del 30 de octubre");
  });

  it("la semana dice la verdad aunque sea mala, con los escudos de la casa", () => {
    const el = pintar();
    expect(el.querySelector("#semana-t")!.textContent).toBe("La semana pasada, ninguna de las tres de Vennett batió al S&P 500");
    expect(el.textContent).toContain("El S&P cayó un 8,6 % del 16 al 20 de noviembre.");
    expect([...el.querySelectorAll(".pildora")].map((p) => p.textContent)).toEqual(["−1,6", "−9,9", "−40,6"]);
    expect(el.querySelectorAll(".semana .crest-casa")).toHaveLength(3);
  });

  it.each(["es", "en"] as const)("el crucigrama de hoy tiene sus casillas y lleva al crucigrama en %s", (idioma) => {
    const el = pintar({ idioma });
    expect(el.querySelectorAll(".casillas span")).toHaveLength(4);
    expect(el.querySelector('a.enlace')!.getAttribute("href")).toBe(idioma === "en" ? "/en/criptico" : "/criptico");
  });

  it("anuncia el próximo crucigrama si hoy no hay", () => {
    const el = pintar({ criptico: { tipo: "proximo", fecha: "2026-12-02" } });
    expect(el.textContent).toContain("El próximo sale el 2 de diciembre.");
  });

  it.each(["es", "en"] as const)("el boletín enlaza el último artículo con su imagen en %s", (idioma) => {
    const ruta = `${idioma === "en" ? "/en" : ""}/blog/alpha-vendio-nvda`;
    const el = pintar({ idioma });
    expect(el.querySelector("a.articulo")!.getAttribute("href")).toBe(ruta);
    expect(el.querySelector("a.articulo img")!.getAttribute("src")).toBe(`${ruta}/imagen`);
  });

  it.each(["es", "en"] as const)("el pie lleva la letra pequeña y los enlaces en %s", (idioma) => {
    const el = pintar({ idioma });
    const enlaces = [...el.querySelectorAll("footer.pie a")].map((a) => a.getAttribute("href"));
    const p = idioma === "en" ? "/en" : "";
    expect(enlaces).toEqual([`${p}/como-funciona`, `${p}/quienes-somos`, `${p}/politica-editorial`, `${p}/blog`,
      `${p}/legal/aviso`, `${p}/legal/privacidad`, `${p}/legal/cookies`]);
    expect(el.querySelectorAll(".pie-letra li")).toHaveLength(4);
  });

  it("sin datos de la demo no hay globo ni ideas, pero sí titular y acción", () => {
    const el = pintar({ demo: null });
    expect(el.querySelector("h1")!.textContent).toBe("Tu idea de inversión, contra el S&P 500.");
    expect(el.querySelector("canvas")).toBeNull();
    expect(el.querySelector(".boton-h")!.textContent).toBe("Escribir mi idea");
  });

  it("en inglés el titular cambia de forma y de cifras", () => {
    const el = pintar({ idioma: "en" });
    expect(el.querySelector("h1")!.textContent).toBe("Out of 5,723 companies, this idea keeps 523 and picks 5.");
  });
});
