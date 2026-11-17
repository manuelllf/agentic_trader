// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntradaIndice } from "@/lib/criptico/publico";
import { clavePartida } from "@/lib/criptico/partida";
import en from "../../../../messages/en/criptico.json";
import es from "../../../../messages/es/criptico.json";
import ArchivoPagina from "./ArchivoPagina";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/criptico/api", () => ({ suscribir: vi.fn() }));

const pista = (texto: string) => [{ texto: `${texto} `, papel: null }, { texto: "pista", papel: "def" as const }];
const indice: EntradaIndice[] = [
  { numero: 1, fecha: "2026-10-31", nivel: "dificil", longitud: 7, pista: pista("Un club de Milán") },
  { numero: 2, fecha: "2026-11-01", nivel: "facil", longitud: 5, pista: pista("Un árbol sagrado") },
  { numero: 3, fecha: "2026-11-02", nivel: "media", longitud: 6, pista: pista("Ruegos alocados") },
];
let root: Root;
let nodo: HTMLDivElement;

async function montar(idioma: "es" | "en" = "es", datos: EntradaIndice[] | null = indice) {
  await act(async () => { root.render(<ArchivoPagina idioma={idioma} textos={idioma === "es" ? es : en} indice={datos} />); });
}
async function escribirEn(entrada: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(entrada, valor);
    entrada.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const boton = (texto: string) => [...nodo.querySelectorAll("button")].find(b => b.textContent === texto || b.getAttribute("aria-label") === texto)!;
const hrefs = () => [...nodo.querySelectorAll(".cr-lista-archivo a")].map(a => a.getAttribute("href"));

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  nodo = document.createElement("div"); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => { root.unmount(); }); nodo.remove(); });

describe("Archivo del críptico", () => {
  it("lo trae pintado el servidor: todas las pistas y sus enlaces están en el HTML, sin afirmar nada del dispositivo", () => {
    const html = renderToString(<ArchivoPagina idioma="es" textos={es} indice={indice} />).replaceAll("<!-- -->", "");
    for (const texto of ["Un club de Milán pista (7)", "Un árbol sagrado pista (5)", "Ruegos alocados pista (6)"]) expect(html).toContain(texto);
    expect(html).toContain('href="/criptico"');
    expect(html).toContain('href="/criptico/1"');
    expect(html).toContain('href="/criptico/2"');
    expect(html).not.toContain("Por resolver");
    expect(html).toContain("Archivo del críptico");
  });

  it("agrupa por meses, abre el más reciente y enseña número, fecha, pista, nivel y longitud", async () => {
    await montar();
    expect(nodo.querySelector("h1")?.textContent).toBe("Archivo del críptico");
    expect(nodo.querySelector(".cr-meta")?.textContent).toBe("3 acertijos desde el 31 de octubre de 2026");
    const meses = [...nodo.querySelectorAll("details.cr-mes")];
    expect(meses.map(m => m.querySelector("b")?.textContent)).toEqual(["noviembre de 2026", "octubre de 2026"]);
    expect(meses.map(m => (m as HTMLDetailsElement).open)).toEqual([true, false]);
    const primera = nodo.querySelector(".cr-lista-archivo li")!;
    expect(primera.textContent).toContain("Nº 3");
    expect(primera.textContent).toContain("Ruegos alocados pista (6)");
    expect(primera.textContent).toContain("Media");
    expect(hrefs()).toEqual(["/criptico", "/criptico/2", "/criptico/1"]);
  });

  it("al montar añade qué has resuelto en este dispositivo, con y sin ayuda", async () => {
    localStorage.setItem(clavePartida("es", 2), JSON.stringify({ resultado: "resuelto" }));
    localStorage.setItem(clavePartida("es", 1), JSON.stringify({ resultado: "solucion" }));
    await montar();
    const filas = [...nodo.querySelectorAll(".cr-lista-archivo li")].map(li => li.querySelector("em")?.textContent);
    expect(filas).toEqual(["Por resolver", "Hecho", "Resuelto con ayuda"]);
    expect(nodo.querySelector("details.cr-mes small")?.textContent).toBe("1 de 2 resueltos");
    expect(nodo.querySelector("em.hecho")).not.toBeNull();
  });

  it("busca por número, fecha o pista, sin tildes, y avisa si nada coincide", async () => {
    await montar();
    const buscador = nodo.querySelector<HTMLInputElement>('input[type="search"]')!;
    await escribirEn(buscador, "arbol");
    expect(nodo.querySelectorAll("details.cr-mes")).toHaveLength(0);
    expect(hrefs()).toEqual(["/criptico/2"]);
    await escribirEn(buscador, "3");
    expect(hrefs()).toEqual(["/criptico"]);
    await escribirEn(buscador, "zzz");
    expect(nodo.textContent).toContain("Ningún acertijo coincide.");
    await escribirEn(buscador, "");
    expect(nodo.querySelectorAll("details.cr-mes")).toHaveLength(2);
  });

  it("«Ir a un número» abre ese acertijo, el de hoy en la portada del críptico, y avisa si no existe", async () => {
    await montar();
    const entrada = nodo.querySelector<HTMLInputElement>('input[type="number"]')!;
    const ir = () => act(async () => { nodo.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await escribirEn(entrada, "2"); await ir();
    expect(router.push).toHaveBeenLastCalledWith("/criptico/2");
    await escribirEn(entrada, "3"); await ir();
    expect(router.push).toHaveBeenLastCalledWith("/criptico");
    router.push.mockClear();
    await escribirEn(entrada, "99"); await ir();
    expect(router.push).not.toHaveBeenCalled();
    expect(nodo.textContent).toContain("Ese número todavía no existe.");
  });

  it("el calendario enlaza los días con acertijo y cambia de mes", async () => {
    await montar();
    await act(async () => { boton("Calendario").click(); });
    expect(nodo.querySelector(".cr-mes-nav b")?.textContent).toBe("noviembre de 2026");
    const celdas = [...nodo.querySelectorAll("a.cr-celda")];
    expect(celdas.map(c => c.getAttribute("href"))).toEqual(["/criptico/2", "/criptico"]);
    expect(nodo.querySelector("a.cr-celda.hoy")?.textContent).toBe("2");
    await act(async () => { boton("Mes anterior").click(); });
    expect(nodo.querySelector(".cr-mes-nav b")?.textContent).toBe("octubre de 2026");
    expect([...nodo.querySelectorAll("a.cr-celda")].map(c => c.getAttribute("href"))).toEqual(["/criptico/1"]);
    expect((boton("Mes anterior") as HTMLButtonElement).disabled).toBe(true);
  });

  it("la cabecera marca el archivo como página actual y el «?» abre cómo se lee, que se cierra con Escape", async () => {
    await montar();
    expect(nodo.querySelector('a.cr-icono[aria-current="page"]')?.getAttribute("href")).toBe("/criptico/archivo");
    await act(async () => { boton("Cómo se lee un críptico").click(); });
    expect(nodo.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(nodo.querySelector('[role="dialog"]')).toBeNull();
  });

  it("el pie lleva quiénes somos, la política editorial y lo legal", async () => {
    await montar();
    const enlaces = [...nodo.querySelectorAll("footer a")].map(a => [a.textContent, a.getAttribute("href")]);
    expect(enlaces).toEqual([
      ["Quiénes somos", "/quienes-somos"], ["Política editorial", "/politica-editorial"],
      ["Aviso legal", "/legal/aviso"], ["Privacidad", "/legal/privacidad"], ["Cookies", "/legal/cookies"],
    ]);
  });

  it("en inglés, todo en inglés y con rutas /en", async () => {
    await montar("en");
    expect(nodo.querySelector("h1")?.textContent).toBe("Cryptic archive");
    expect(nodo.querySelector(".cr-meta")?.textContent).toBe("3 puzzles since October 31, 2026");
    expect(hrefs()).toEqual(["/en/criptico", "/en/criptico/2", "/en/criptico/1"]);
    expect([...nodo.querySelectorAll("footer a")].map(a => a.getAttribute("href")))
      .toEqual(["/en/quienes-somos", "/en/politica-editorial", "/en/legal/aviso", "/en/legal/privacidad", "/en/legal/cookies"]);
    expect(nodo.querySelector('a.cr-icono')?.getAttribute("href")).toBe("/en/criptico/archivo");
  });

  it("si la lista no llegó, lo dice y deja reintentar", async () => {
    await montar("es", null);
    expect(nodo.querySelector('[role="status"]')?.textContent).toBe(es.cr_error);
    await act(async () => { boton("Volver a intentar").click(); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(nodo.querySelector(".cr-lista-archivo")).toBeNull();
  });
});
