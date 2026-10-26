// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const sesion = vi.hoisted(() => ({ valor: "fuera" as "cargando" | "fuera" | "dentro" }));
const idioma = vi.hoisted(() => ({ valor: "es" }));
vi.mock("../_sesion/SesionContext", () => ({ useRedirigirSiHaySesion: () => sesion.valor }));
vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: (p: { href: string; className?: string; children?: unknown }) =>
    React.createElement("a", { href: p.href, className: p.className }, p.children as never) };
});
vi.mock("next-intl", async () => {
  const catalogos: Record<string, Record<string, string>> = {
    es: (await import("../../../../messages/es/landing.json")).default,
    en: (await import("../../../../messages/en/landing.json")).default,
  };
  const t = (clave: string, valores?: Record<string, string | number>) =>
    (catalogos[idioma.valor][clave] ?? clave).replace(/\{(\w+)\}/g, (_, n: string) => String(valores?.[n] ?? `{${n}}`));
  return { useTranslations: () => t, useLocale: () => idioma.valor };
});
import type { EstadoCriptico } from "@/lib/criptico/estado";
import { Portada } from "./Portada";

const pintar = (criptico: EstadoCriptico = null) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(Portada, { criptico }));
  return host;
};

describe("Portada", () => {
  it("oculta Planes en la cabecera del visitante", () => {
    sesion.valor = "fuera";
    const cabecera = pintar().querySelector("header.pel-cabecera nav")!;
    const enlaces = [...cabecera.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(enlaces).toEqual([
      ["Ver la liga", "/liga"], ["Entrar", "/entrar"], ["Crea la tuya", "/entrar?next=/crear"],
    ]);
  });

  it("oculta Planes tanto en escritorio como en móvil", () => {
    sesion.valor = "fuera";
    const el = pintar();
    const cabecera = el.querySelector<HTMLAnchorElement>('header.pel-cabecera a[href="/planes"]')!;
    expect(cabecera).toBeNull();
    const pie = el.querySelector<HTMLAnchorElement>('.pel-regleta a[href="/planes"]')!;
    expect(pie).toBeNull();
  });

  it.each(["es", "en"])("sin críptico no hay enlace en %s", (valor) => {
    sesion.valor = "fuera";
    idioma.valor = valor;
    expect(pintar().querySelector('.pel-regleta a[href$="/criptico"]')).toBeNull();
    idioma.valor = "es";
  });

  it.each(["es", "en"])("muestra el críptico de hoy en %s", (valor) => {
    sesion.valor = "fuera";
    idioma.valor = valor;
    const pista = "Un árbol sagrado esconde el mercado de valores";
    const enlace = pintar({ tipo: "hoy", longitud: 5, pista }).querySelector('.pel-regleta a[href$="/criptico"]')!;
    expect(enlace.getAttribute("href")).toBe(valor === "en" ? "/en/criptico" : "/criptico");
    expect(enlace.textContent).toContain(valor === "en" ? "Today's cryptic" : "Críptico de hoy");
    expect(enlace.textContent).toContain(pista);
    expect(enlace.querySelectorAll(".pel-casillas i")).toHaveLength(5);
    idioma.valor = "es";
  });

  it.each(["es", "en"])("anuncia el próximo críptico en %s", (valor) => {
    sesion.valor = "fuera";
    idioma.valor = valor;
    const enlace = pintar({ tipo: "proximo", fecha: "2026-11-02" }).querySelector('.pel-regleta a[href$="/criptico"]')!;
    expect(enlace.getAttribute("href")).toBe(valor === "en" ? "/en/criptico" : "/criptico");
    expect(enlace.textContent).toContain(valor === "en" ? "Nov 2" : "2 nov");
    expect(enlace.textContent).toContain(valor === "en" ? "Tell me about the first one" : "Avísame del primero");
    idioma.valor = "es";
  });

  it("con sesión no pinta nada: la portada solo es del visitante", () => {
    sesion.valor = "dentro";
    expect(pintar().innerHTML).toBe("");
  });
});
