// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const sesion = vi.hoisted(() => ({ estado: "fuera" as "cargando" | "fuera" | "dentro" }));
const pagos = vi.hoisted(() => ({ abrirPago: vi.fn(), leerSuscripcion: vi.fn() }));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => sesion }));
vi.mock("@/lib/liga/pagos", () => pagos);
vi.mock("@/i18n/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => createElement("a", props) }));
vi.mock("next-intl", async () => {
  const es = (await import("../../../../messages/es/planes.json")).default as Record<string, string>;
  const t = (key: string, values?: Record<string, string | number>) =>
    (es[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});
import { PlanesPublicos } from "./PlanesPublicos";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;

function montar(estado: "cargando" | "fuera" | "dentro") {
  sesion.estado = estado;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(PlanesPublicos)));
  return host;
}
const elegir = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLAnchorElement>("a")].filter((a) => a.textContent === "Elegir");

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  sesion.estado = "fuera";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PlanesPublicos", () => {
  it("enseña los cuatro planes con sus precios", () => {
    const el = montar("fuera");
    expect(el.querySelector("h1")?.textContent).toBe("Planes");
    expect(el.textContent).toContain("Pro te deja apuntar hasta tres estrategias");
    const filas = [...el.querySelectorAll("li.cuenta-plan-fila")].map((f) => [
      f.querySelector(".cuenta-plan-fila-nombre")?.textContent,
      f.querySelector(".cuenta-plan-fila-detalle")?.textContent,
    ]);
    expect(filas).toEqual([
      ["Pro · Mensual", "4,99 € al mes · se renueva cada mes"],
      ["Pro · Media temporada", "25 € por 6 meses · 4,17 € al mes"],
      ["Pro · Temporada", "49 € por 12 meses · 4,08 € al mes"],
      ["Pase de liga", "25 € por 12 meses · suma una liga privada"],
    ]);
  });

  it("al visitante le lleva a crear cuenta y de ahí al plan", () => {
    const enlaces = elegir(montar("fuera"));
    expect(enlaces).toHaveLength(4);
    for (const enlace of enlaces) expect(enlace.getAttribute("href")).toBe("/registrar?next=/cuenta/plan");
  });

  it("antes de saber si hay sesión deja el enlace de crear cuenta", () => {
    const enlaces = elegir(montar("cargando"));
    expect(enlaces).toHaveLength(4);
    for (const enlace of enlaces) expect(enlace.getAttribute("href")).toBe("/registrar?next=/cuenta/plan");
  });

  it("con sesión lleva a elegir el plan en la cuenta", () => {
    const enlaces = elegir(montar("dentro"));
    expect(enlaces).toHaveLength(4);
    for (const enlace of enlaces) expect(enlace.getAttribute("href")).toBe("/cuenta/plan");
  });

  it("no llama a la API para enseñar los precios", () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);
    const el = montar("fuera");
    expect(el.querySelectorAll("button")).toHaveLength(0);
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(pagos.abrirPago).not.toHaveBeenCalled();
    expect(pagos.leerSuscripcion).not.toHaveBeenCalled();
  });

  it("deja volver a la portada desde la marca", () => {
    const el = montar("fuera");
    expect(el.querySelector("header a.wordmark")?.getAttribute("href")).toBe("/");
  });
});
