// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const sesion = vi.hoisted(() => ({ valor: "fuera" as "cargando" | "fuera" | "dentro" }));
const idioma = vi.hoisted(() => ({ valor: "es" }));
vi.mock("../_sesion/SesionContext", () => ({ useRedirigirSiHaySesion: () => sesion.valor }));
vi.mock("@/i18n/Provider", () => ({ useLanguage: () => ({ changing: false, selectLocale: vi.fn() }) }));
vi.mock("./hoy.css", () => ({}));
vi.mock("@/components/selector-idioma.css", () => ({}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: (p: { href: string; className?: string; children?: unknown }) =>
    React.createElement("a", { href: p.href, className: p.className }, p.children as never) };
});
vi.mock("next-intl", async () => {
  const catalogos: Record<string, Record<string, string>> = {
    es: { ...(await import("../../../../messages/es/landing.json")).default, ...(await import("../../../../messages/es/common.json")).default },
    en: { ...(await import("../../../../messages/en/landing.json")).default, ...(await import("../../../../messages/en/common.json")).default },
  };
  const t = (clave: string, valores?: Record<string, string | number>) =>
    (catalogos[idioma.valor][clave] ?? clave).replace(/\{(\w+)\}/g, (_, n: string) => String(valores?.[n] ?? `{${n}}`));
  return { useTranslations: () => t, useLocale: () => idioma.valor };
});
import type { EstadoCriptico } from "@/lib/criptico/estado";
import type { BoletinHoy } from "./Hoy";
import { Portada } from "./Portada";

const HOY: EstadoCriptico = { tipo: "hoy", longitud: 4, pista: "Tío que se traga el principio del préstamo da el precio del dinero", numero: 10, nivel: "media" };
const ARTICULO: BoletinHoy = { slug: "nuestra-historia-vennett", titulo: "Nuestra historia: Vennett", resumen: "En 2008…", minutos: 3 };

const pintar = (criptico: EstadoCriptico = HOY, boletin: BoletinHoy = ARTICULO) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(Portada, { criptico, boletin }));
  return host;
};

describe("Portada Hoy", () => {
  it("con sesión no pinta nada: la portada solo es del visitante", () => {
    sesion.valor = "dentro";
    expect(pintar().innerHTML).toBe("");
    sesion.valor = "fuera";
  });

  it("el selector de idioma va como en el críptico y el boletín: EN a la izquierda", () => {
    const botones = [...pintar().querySelectorAll(".selector-idioma button")];
    expect(botones.map((b) => b.textContent)).toEqual(["EN", "ES"]);
    expect(botones.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });

  it("la liga invita a fichar y avisa de que la jornada es de ejemplo", () => {
    const liga = pintar().querySelector(".liga")!;
    expect(liga.querySelector('a[href="/entrar?next=/crear"]')!.textContent).toBe("Fichar mi idea");
    expect(liga.querySelector('a[href="/liga"]')).not.toBeNull();
    expect(liga.textContent).toContain("Cifras de ejemplo");
    expect(liga.querySelectorAll(".carrera li")).toHaveLength(4);
  });

  it.each(["es", "en"])("enseña el críptico de hoy con sus casillas en %s", (valor) => {
    idioma.valor = valor;
    const el = pintar();
    const enlace = el.querySelector('a[href$="/criptico"]')!;
    expect(enlace.getAttribute("href")).toBe(valor === "en" ? "/en/criptico" : "/criptico");
    expect(el.textContent).toContain(valor === "en" ? "Cryptic no. 10" : "Críptico nº 10");
    expect(el.querySelector(".pista")!.textContent).toContain("precio del dinero");
    expect(el.querySelectorAll(".casillas span")).toHaveLength(4);
    idioma.valor = "es";
  });

  it("anuncia el próximo críptico si hoy no hay", () => {
    const el = pintar({ tipo: "proximo", fecha: "2026-11-02" });
    expect(el.textContent).toContain("Avísame del primero");
    expect(el.querySelector('a[href="/criptico"]')).not.toBeNull();
  });

  it.each(["es", "en"])("enlaza el último artículo del boletín en %s", (valor) => {
    idioma.valor = valor;
    const enlace = pintar().querySelector('a[href$="/blog/nuestra-historia-vennett"]')!;
    expect(enlace.getAttribute("href")).toBe(valor === "en" ? "/en/blog/nuestra-historia-vennett" : "/blog/nuestra-historia-vennett");
    idioma.valor = "es";
  });

  it("sin críptico ni artículo, la liga ocupa todo el mosaico", () => {
    const el = pintar(null, null);
    expect(el.querySelectorAll(".mosaico .pieza")).toHaveLength(1);
    expect(el.querySelector(".mosaico")!.className).toContain("solo-liga");
  });
});
