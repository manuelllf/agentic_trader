// Andamio de los tests del motor: lienzo, reloj, ventana y observador simulados, y el montaje sobre
// el marcado real de `Pelicula`. Los tests hacen `vi.mock` de next-intl y next/link (ver motor.test.ts).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import es from "../../../../../messages/es/landing.json";
import en from "../../../../../messages/en/landing.json";
import { Pelicula } from "../Pelicula";
import { montarPelicula } from "./motor";

export type Idioma = "es" | "en";

const catalogos: Record<Idioma, Record<string, string>> = { es, en };
const extra: Record<Idioma, Record<string, string>> = {
  es: { strategies_weight_business: "El negocio", strategies_weight_price: "El precio",
    strategies_weight_debt: "La deuda", strategies_weight_catalyst: "Algo a favor pronto" },
  en: { strategies_weight_business: "The business", strategies_weight_price: "The price",
    strategies_weight_debt: "Debt", strategies_weight_catalyst: "Near-term catalyst" },
};

/** `t` del catálogo real, sustituyendo `{nombre}` por su valor; si falta la clave, devuelve la clave. */
export function traductor(idioma: Idioma) {
  return (clave: string, valores?: Record<string, string | number>): string => {
    const texto = catalogos[idioma][clave] ?? extra[idioma][clave] ?? clave;
    return texto.replace(/\{(\w+)\}/g, (_, nombre: string) => String(valores?.[nombre] ?? `{${nombre}}`));
  };
}

export interface LlamadaLienzo { metodo: string; args: unknown[] }

/** Contexto 2D que acepta cualquier método del motor y anota las llamadas del último fotograma. */
export function crearContextoFalso() {
  const llamadas: LlamadaLienzo[] = [];
  const propios: Record<string, unknown> = {};
  const resultados: Record<string, (...args: never[]) => unknown> = {
    measureText: ((texto: string) => ({ width: texto.length * 6 })) as never,
    createLinearGradient: (() => ({ addColorStop() {} })) as never,
    createImageData: ((ancho: number, alto: number) => ({ data: new Uint8ClampedArray(ancho * alto * 4) })) as never,
  };
  const metodos = new Map<string, (...args: unknown[]) => unknown>();
  const contexto = new Proxy(propios, {
    get(objeto, propiedad: string) {
      if (propiedad in objeto) return objeto[propiedad];
      let metodo = metodos.get(propiedad);
      if (!metodo) {
        metodo = (...args: unknown[]) => {
          // Cada fotograma empieza con setTransform: solo se conserva el último.
          if (propiedad === "setTransform") llamadas.length = 0;
          llamadas.push({ metodo: propiedad, args });
          return resultados[propiedad]?.(...(args as never[]));
        };
        metodos.set(propiedad, metodo);
      }
      return metodo;
    },
    set(objeto, propiedad: string, valor) { objeto[propiedad] = valor; return true; },
  });
  return { contexto, llamadas };
}

/** `requestAnimationFrame` manual: el test decide cuánto tiempo pasa. */
export function crearReloj() {
  const cola = new Map<number, FrameRequestCallback>();
  let siguiente = 0;
  let ahora = 1000;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cola.set(++siguiente, cb); return siguiente; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { cola.delete(id); });
  return {
    /** Avanza `segundos` en fotogramas de 50 ms, el máximo que el motor cuenta por fotograma. */
    avanzar(segundos: number) {
      const fotogramas = Math.max(1, Math.ceil(segundos / 0.05 - 1e-9));
      for (let i = 0; i < fotogramas; i++) {
        ahora += 50;
        const pendientes = [...cola.values()];
        cola.clear();
        pendientes.forEach((cb) => cb(ahora));
      }
    },
    pendientes: () => cola.size,
  };
}

/** Observador de intersección que se dispara a mano con `visibilidad(ratio)`. */
export function crearObservador() {
  let aviso: IntersectionObserverCallback | null = null;
  class Falso {
    constructor(cb: IntersectionObserverCallback) { aviso = cb; }
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", Falso);
  return {
    visibilidad(ratio: number) {
      aviso?.([{ intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver);
    },
  };
}

export function fijarOcultoDelDocumento(oculto: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => oculto });
}

const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} }) as DOMRect;

export interface Opciones { idioma?: Idioma; tiempo?: number; reducido?: boolean }

/**
 * Monta la película sobre el marcado real de `Pelicula` en una ventana móvil de 390x844.
 * Con `tiempo` la abre parada en ese segundo (`?t=`).
 */
export function montar(opciones: Opciones = {}) {
  const { idioma = "es", tiempo, reducido = false } = opciones;
  const { contexto, llamadas } = crearContextoFalso();
  const reloj = crearReloj();
  const observador = crearObservador();
  fijarOcultoDelDocumento(false);
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: reducido && consulta.includes("prefers-reduced-motion"), media: consulta,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => contexto) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:,");
  history.replaceState(null, "", tiempo == null ? "/" : `/?t=${tiempo}`);

  const raiz = document.createElement("div");
  raiz.innerHTML = renderToStaticMarkup(createElement(Pelicula));
  document.body.append(raiz);
  const pelicula = raiz.firstElementChild as HTMLElement;
  const pieza = <E extends HTMLElement = HTMLElement>(nombre: string) =>
    pelicula.querySelector<E>(`[data-p="${nombre}"]`)!;
  const piezas = (nombre: string) => [...pelicula.querySelectorAll<HTMLElement>(`[data-p="${nombre}"]`)];
  const item = (nombre: string) => pelicula.querySelector<HTMLElement>(`[data-it="${nombre}"]`)!;
  pieza("escena").getBoundingClientRect = () => rect(0, 0, 390, 844);
  pieza("franja").getBoundingClientRect = () => rect(16, 630, 358, 214);

  const limpiar = montarPelicula(pelicula, { locale: idioma, t: traductor(idioma) });
  return {
    pelicula, pieza, piezas, item, reloj, observador, llamadas, limpiar,
    desmontar() { limpiar(); raiz.remove(); },
  };
}

/** Deja el entorno como estaba para el siguiente test. */
export function restaurarEntorno() {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
}
