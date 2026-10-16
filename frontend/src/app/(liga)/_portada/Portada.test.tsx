// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const sesion = vi.hoisted(() => ({ valor: "fuera" as "cargando" | "fuera" | "dentro" }));
vi.mock("../_sesion/SesionContext", () => ({ useRedirigirSiHaySesion: () => sesion.valor }));
vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: (p: { href: string; className?: string; children?: unknown }) =>
    React.createElement("a", { href: p.href, className: p.className }, p.children as never) };
});
vi.mock("next-intl", async () => {
  const catalogo = (await import("../../../../messages/es/landing.json")).default as Record<string, string>;
  const t = (clave: string, valores?: Record<string, string | number>) =>
    (catalogo[clave] ?? clave).replace(/\{(\w+)\}/g, (_, n: string) => String(valores?.[n] ?? `{${n}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});
import { Portada } from "./Portada";

const pintar = () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(Portada));
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
    const pie = el.querySelector<HTMLAnchorElement>('.pel-pie a[href="/planes"]')!;
    expect(pie).toBeNull();
  });

  it("con sesión no pinta nada: la portada solo es del visitante", () => {
    sesion.valor = "dentro";
    expect(pintar().innerHTML).toBe("");
  });
});
