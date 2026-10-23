// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/criptico/api";
import { cargarPartida } from "@/lib/criptico/partida";
import type { Acertijo, Detalle } from "@/lib/criptico/tipos";
import textos from "../../../../messages/es/criptico.json";
import Juego from "./Juego";

vi.mock("@/lib/criptico/api", () => ({
  comprobar: vi.fn(), resuelto: vi.fn(), solucion: vi.fn(), letra: vi.fn(), numero: vi.fn(), suscribir: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ ApiError: class extends Error { status = 404; } }));

const a: Acertijo = { id: 42, numero: 1, idioma: "es", fecha: "2026-10-23", nivel: "facil", longitud: 5,
  pista: [{ texto: "Terna ", papel: "mat" }, { texto: "revuelta", papel: "ind" }, { texto: ": ingresos", papel: "def" }],
  ayudas: { def: "Ingresos", ind: "Anagrama", mat: "Terna" }, media: null, n_media: null };
const detalle: Detalle = { respuesta: "RENTA", palabra: "renta", resolucion: "TERNA revuelta = RENTA",
  concepto: "Lo que ingresas en un periodo.", ejemplo: "100 € al mes", regla_catalogo: null };
let root: Root;
let nodo: HTMLDivElement;

async function montar(acertijo = a) {
  await act(async () => { root.render(<Juego acertijo={acertijo} textos={textos} />); });
}
async function pulsar(key: string) {
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
}
async function escribir(texto: string) { for (const letra of texto) await pulsar(letra); }
async function click(texto: string) {
  const boton = [...nodo.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === texto || b.textContent === texto);
  expect(boton, texto).toBeDefined();
  await act(async () => { boton!.click(); });
}
const letras = () => [...nodo.querySelectorAll(".cr-casilla")].map(b => b.textContent).join("");

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  localStorage.clear();
  nodo = document.createElement("div"); document.body.append(nodo); root = createRoot(nodo);
  vi.mocked(api.resuelto).mockResolvedValue(undefined);
  vi.mocked(api.solucion).mockResolvedValue({ detalle });
  vi.mocked(api.letra).mockResolvedValue({ letra: "R" });
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); nodo.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("Juego", () => {
  it("escribe, avisa si faltan letras, comprueba mal y después bien; registra una vez", async () => {
    vi.mocked(api.comprobar).mockResolvedValueOnce({ correcta: false, detalle: null })
      .mockResolvedValueOnce({ correcta: true, detalle });
    await montar();
    await escribir("TER"); await pulsar("Enter");
    expect(nodo.textContent).toContain("Faltan letras"); expect(api.comprobar).not.toHaveBeenCalled();
    await escribir("NA"); expect(letras()).toBe("TERNA"); await pulsar("Enter");
    expect(api.comprobar).toHaveBeenLastCalledWith(42, "TERNA");
    expect(nodo.textContent).toContain("Todavía no"); expect(nodo.querySelector(".cr-mal")).not.toBeNull();
    for (let i = 0; i < 5; i++) await pulsar("Backspace");
    await escribir("RENTA"); await pulsar("Enter"); await pulsar("Enter");
    expect(api.resuelto).toHaveBeenCalledExactlyOnceWith(42, 0);
    expect(nodo.textContent).toContain("Resuelto sin ayudas");
    expect(nodo.textContent).toContain(detalle.concepto);
    expect(nodo.textContent).toContain("Cómo se resuelve");
    expect(nodo.textContent).not.toContain("Media de quien");
    expect(cargarPartida(a).resultado).toBe("resuelto");
    await act(async () => { root.unmount(); }); root = createRoot(nodo); await montar();
    expect(nodo.textContent).toContain("Resuelto sin ayudas");
    expect(api.resuelto).toHaveBeenCalledTimes(1);
  });
  it("pide ayudas, fija la letra y guarda la solución vista sin registrar un acierto", async () => {
    await montar(); await click("Definición"); await click("Letra");
    expect(api.letra).toHaveBeenCalledExactlyOnceWith(42);
    expect(nodo.querySelector(".cr-casilla.fija")?.textContent).toBe("R");
    expect(nodo.querySelector(".cr-s-def.on")).not.toBeNull();
    await pulsar("Backspace"); expect(letras()).toBe("R");
    await click("Ver la solución");
    expect(api.solucion).toHaveBeenCalledExactlyOnceWith(42, 2);
    expect(api.resuelto).not.toHaveBeenCalled();
    expect(nodo.textContent).toContain("Solución vista"); expect(letras()).toBe("RENTA");
    expect(cargarPartida(a).ayudas).toEqual(["def", "letra"]);
    expect(cargarPartida(a).resultado).toBe("solucion");
  });
  it("puede reintentar una petición fallida sin perder las letras", async () => {
    vi.mocked(api.comprobar).mockRejectedValueOnce(new Error("red"))
      .mockResolvedValueOnce({ correcta: true, detalle });
    await montar(); await escribir("RENTA"); await pulsar("Enter");
    expect(nodo.textContent).toContain("No hemos podido conectar"); expect(letras()).toBe("RENTA");
    await pulsar("Enter"); expect(api.resuelto).toHaveBeenCalledTimes(1);
  });
  it("muestra la bienvenida móvil una vez y permite usar las teclas en pantalla", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    await montar(); expect(nodo.querySelector('[role="dialog"]')).not.toBeNull();
    expect(nodo.querySelectorAll(".cr-hoja ol li")).toHaveLength(3);
    await pulsar("A"); expect(letras()).toBe("");
    await click("Empezar"); expect(localStorage.getItem("criptico:bienvenida")).toBe("1");
    const tecla = nodo.querySelector<HTMLButtonElement>('[aria-label="Escribir Ñ"]')!;
    await act(async () => { tecla.click(); }); expect(letras()).toBe("Ñ");
    await act(async () => { root.unmount(); }); root = createRoot(nodo); await montar();
    expect(nodo.querySelector('[role="dialog"]')).toBeNull(); expect(letras()).toBe("Ñ");
  });
  it("comparte el resultado y la ruta del idioma sin revelar la respuesta", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    await montar(); await click("Ver la solución"); await click("Compartir");
    expect(share).toHaveBeenCalledTimes(1);
    const texto = share.mock.calls[0][0].text;
    expect(texto).toContain("nº 1"); expect(texto).toContain("Solución vista");
    expect(texto).toContain("https://vennett.app/criptico"); expect(texto).not.toMatch(/RENTA/i);
    Reflect.deleteProperty(navigator, "share");
  });
});
