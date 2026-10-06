// La película de la portada: un lienzo y unas capas de texto que son función del tiempo. dibujar(t)
// no guarda estado entre fotogramas, así que el scroll la mueve adelante y atrás como la reproducción.

import type { Locale } from "@/i18n/locale";
import { fraseVsIndice, miles, porcentaje, signo } from "@/lib/liga/format";
import { DIAS, SESIONES_JORNADA, crearSeries, valorEn, type Estrategia, type Series } from "./series";
import {
  PER_MAX, PER_MIN, UMBRALES, clamp, crearUniverso, cumple, evaluar, type Empresa, type Evaluacion,
} from "./universo";

export interface Textos {
  locale: Locale;
  t: (clave: string, valores?: Record<string, string | number>) => string;
}

// Guion, en segundos. Hasta `intro` la película corre sola; el resto lo reparte el scroll.
const T = {
  intro: 7.0, cierre: 4.0, alejar0: 3.4, alejar1: 6.4,
  oscurecer0: 7.2, oscurecer1: 8.2, aclarar0: 12.7, aclarar1: 13.6,
  escribir0: 8.1, escribir1: 11.7,
  regla: [[13.7, 15.5], [15.8, 17.6], [17.9, 19.7], [20.0, 21.8]], barrido: 1.3,
  retile0: 22.2, retile1: 24.4,
  lista0: 25.4, lista1: 27.8,
  cartera0: 30.4, cartera1: 32.4,
  origen0: 34.4, origen1: 35.6,
  trazo0: 35.8, trazo1: 41.8,
  otras0: 45.0, otras1: 46.6,
  filas0: 47.0, filas1: 49.4,
  D: 55,
};
const ITEMS: [string, number, number, number, number][] = [
  ["cierre", 4.3, 4.9, 7.0, 7.5], ["tesis", 7.5, 8.0, 12.9, 13.5], ["reglas", 12.9, 13.6, 24.9, 25.5],
  ["pesos", 25.5, 26.1, 29.9, 30.4], ["cartera", 30.5, 31.1, 34.2, 34.7], ["nota", 34.6, 35.2, 42.4, 42.9],
  ["veredicto", 42.6, 43.2, 46.3, 46.8], ["liga", 46.6, 47.2, 51.0, 51.5], ["fin", 51.5, 52.3, 99, 99],
];

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const tramo = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const suave = (p: number) => p * p * (3 - 2 * p);
const salida = (p: number) => 1 - Math.pow(1 - p, 3);
const entradaSalida = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
type Rgb = [number, number, number];
const mezcla = (a: Rgb, b: Rgb, p: number): Rgb => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
const rgb = (c: Rgb, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  suelo: hex("#0A0C0D"), panel: hex("#111517"), plano: hex("#1A1F21"), sube: hex("#1F7064"), baja: hex("#8E3B34"),
  fantasma: hex("#121618"), tinta: hex("#EEF2F0"), tinta2: hex("#B9C2BE"), mudo: hex("#7F8A86"), teal: hex("#3FC7BF"),
  barra: hex("#2A3336"), violeta: hex("#BFA2D8"), bien: hex("#5CC98A"), mal: hex("#F08A7E"),
  cartera: ["#3FC7BF", "#2FA8A1", "#238C86", "#1A716C", "#145A56"].map(hex),
};
function colorCambio(chg: number): Rgb {
  const k = Math.pow(Math.min(Math.abs(chg) / 3, 1), 0.75);
  return mezcla(C.plano, chg >= 0 ? C.sube : C.baja, k);
}

interface Zona { x: number; y: number; w: number; h: number }
interface Mapa { R: Float32Array; sectores: (Zona & { s: number })[] }
interface Fila extends Zona { estrategia: Estrategia | null; valor: number; j: number; corte: boolean }

// Treemap «squarified»: rectángulos lo más cuadrados posible, de mayor a menor.
function squarify<T extends { v: number }>(items: T[], x: number, y: number, w: number, h: number,
  colocar: (o: T, x: number, y: number, w: number, h: number) => void) {
  const total = items.reduce((s, o) => s + o.v, 0);
  if (total <= 0 || w <= 0 || h <= 0) return;
  const k = (w * h) / total;
  let i = 0, rx = x, ry = y, rw = w, rh = h;
  while (i < items.length) {
    const lado = Math.min(rw, rh);
    let j = i, suma = 0, peor = Infinity, min = Infinity, max = 0;
    while (j < items.length) {
      const a = items[j].v * k, s2 = suma + a, mn = Math.min(min, a), mx = Math.max(max, a);
      const p = Math.max((lado * lado * mx) / (s2 * s2), (s2 * s2) / (lado * lado * mn));
      if (p > peor) break;
      peor = p; suma = s2; min = mn; max = mx; j++;
    }
    if (rw >= rh) {
      const cw = suma / rh; let yy = ry;
      for (let q = i; q < j; q++) { const hh = (items[q].v * k) / cw; colocar(items[q], rx, yy, cw, hh); yy += hh; }
      rx += cw; rw -= cw;
    } else {
      const ch = suma / rw; let xx = rx;
      for (let q = i; q < j; q++) { const ww = (items[q].v * k) / ch; colocar(items[q], xx, ry, ww, ch); xx += ww; }
      ry += ch; rh -= ch;
    }
    i = j;
  }
}

/** Monta la película dentro de `raiz` y devuelve la función que la desmonta. */
export function montarPelicula(raiz: HTMLElement, textos: Textos): () => void {
  const pieza = <E extends HTMLElement = HTMLElement>(n: string) => raiz.querySelector<E>(`[data-p="${n}"]`)!;
  const piezas = <E extends HTMLElement = HTMLElement>(n: string) => [...raiz.querySelectorAll<E>(`[data-p="${n}"]`)];
  const escena = pieza("escena"), lienzo = pieza<HTMLCanvasElement>("lienzo"), franja = pieza("franja");
  const pelicula = pieza("pelicula"), selector = pieza<HTMLInputElement>("per"), ficha = pieza("ficha");
  const ctx = lienzo.getContext("2d")!;
  const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { t, locale } = textos;
  const sectores = t("landing_sectores").split("|");
  const nombresLiga = t("landing_liga_nombres").split("|");
  const decimal = (v: number, d: number) => Math.abs(v).toFixed(d).replace(".", locale === "en" ? "." : ",");
  const fuentes = () => {
    const css = getComputedStyle(raiz);
    return { dato: css.getPropertyValue("--pel-data").trim() || "monospace", ui: css.getPropertyValue("--pel-ui").trim() || "sans-serif" };
  };
  let F = fuentes();

  const EMP = crearUniverso();
  let PER: number = UMBRALES.per;
  let EV: Evaluacion = evaluar(EMP, PER);
  let SERIES: Series = crearSeries(EV.cartera);

  // --- Geometría ------------------------------------------------------------------------------
  let W = 0, H = 0, DPR = 1, ANCHO = false;
  let P: Zona = { x: 0, y: 0, w: 0, h: 0 };
  function medir() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = escena.getBoundingClientRect();
    W = r.width; H = r.height;
    lienzo.width = Math.round(W * DPR); lienzo.height = Math.round(H * DPR);
    ANCHO = matchMedia("(min-width: 900px) and (min-aspect-ratio: 11/10)").matches;
    const tz = franja.getBoundingClientRect();
    if (ANCHO) P = { x: tz.right - r.left + 56, y: 96, w: W - (tz.right - r.left) - 56 - 48, h: H - 96 - 92 };
    else P = { x: 16, y: 64, w: W - 32, h: Math.max(220, tz.top - r.top - 64 - 14) };
  }

  function mapa(lista: Empresa[], Z: Zona): Mapa {
    const R = new Float32Array(EMP.length * 4).fill(NaN);
    const out: Mapa["sectores"] = [];
    const grupos = sectores.map((_, s) => ({ s, v: 0, emp: [] as Empresa[] }));
    for (const e of lista) { grupos[e.sector].v += e.cap; grupos[e.sector].emp.push(e); }
    squarify(grupos.filter((g) => g.v > 0).sort((a, b) => b.v - a.v), Z.x, Z.y, Z.w, Z.h, (g, gx, gy, gw, gh) => {
      const m = Math.min(1.5, gw * 0.02, gh * 0.02);
      out.push({ s: g.s, x: gx + m, y: gy + m, w: gw - 2 * m, h: gh - 2 * m });
      const items = g.emp.slice().sort((a, b) => b.cap - a.cap).map((e) => ({ v: e.cap, e }));
      squarify(items, gx + m, gy + m, gw - 2 * m, gh - 2 * m, (o, ex, ey, ew, eh) => {
        const b = o.e.id * 4; R[b] = ex; R[b + 1] = ey; R[b + 2] = ew; R[b + 3] = eh;
      });
    });
    return { R, sectores: out };
  }

  // Lista ordenada, barra de la cartera y origen de la gráfica.
  let L0: Mapa, L1: Mapa, LISTA: Float32Array, BARRA: Float32Array, ORIGEN: Float32Array, RANGO: Int16Array;
  let filaH = 38, listaY0 = 0;
  const G = { x0: 0, x1: 0, yA: 0, yB: 0, min: -4, max: 14, base: [0, 1], liga: [0, 1],
    x: (d: number) => G.x0 + (G.x1 - G.x0) * (d / DIAS),
    y: (v: number) => G.yB - (G.yB - G.yA) * ((v - G.min) / (G.max - G.min)) };
  function rangoDe(series: number[][]): [number, number] {
    let mn = 0, mx = 0;
    for (const s of series) for (const v of s) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const m = (mx - mn) * 0.08;
    return [mn - m, mx + m];
  }
  function fijarRangos() {
    G.base = rangoDe([SERIES.sp, SERIES.tu]);
    G.liga = rangoDe([SERIES.sp, ...SERIES.todas.map((s) => s.serie)]);
    G.min = G.base[0]; G.max = G.base[1];
  }
  function maquetar() {
    L0 = mapa(EMP, P);
    L1 = mapa(EV.vivas, P);
    LISTA = new Float32Array(EMP.length * 4).fill(NaN);
    RANGO = new Int16Array(EMP.length).fill(-1);
    filaH = ANCHO ? 46 : 38;
    const hueco = ANCHO ? 7 : 5;
    const maxNota = EV.vivas[0] ? EV.vivas[0].nota : 1;
    EV.cartera.forEach((e, k) => {
      const b = e.id * 4; LISTA[b] = P.x; LISTA[b + 1] = P.y + 8 + k * (filaH + hueco); LISTA[b + 2] = P.w; LISTA[b + 3] = filaH;
      RANGO[e.id] = k;
    });
    const resto = EV.vivas.filter((e) => RANGO[e.id] < 0);
    listaY0 = P.y + 8 + 5 * (filaH + hueco) + 16;
    const paso = resto.length ? Math.min(4, (P.y + P.h - listaY0) / resto.length) : 4, alto = Math.max(0.6, paso * 0.66);
    resto.forEach((e, j) => {
      const b = e.id * 4;
      LISTA[b] = P.x; LISTA[b + 1] = listaY0 + j * paso; LISTA[b + 2] = Math.max(6, P.w * 0.92 * (e.nota / maxNota)); LISTA[b + 3] = alto;
      RANGO[e.id] = 5 + j;
    });
    BARRA = new Float32Array(EMP.length * 4).fill(NaN);
    const bh = ANCHO ? 92 : 70, by = P.y + P.h * 0.46 - bh / 2, g = ANCHO ? 6 : 4;
    EV.cartera.forEach((e, k) => {
      const b = e.id * 4, w = P.w / 5;
      BARRA[b] = P.x + k * w + g / 2; BARRA[b + 1] = by; BARRA[b + 2] = w - g; BARRA[b + 3] = bh;
    });
    G.x0 = P.x + 10; G.x1 = P.x + P.w - (ANCHO ? 92 : 70);
    G.yA = P.y + 34; G.yB = P.y + P.h - 34;
    ORIGEN = new Float32Array(EMP.length * 4).fill(NaN);
    EV.cartera.forEach((e, k) => {
      const b = e.id * 4; ORIGEN[b] = G.x0 - 6; ORIGEN[b + 1] = G.y(0) - 26 + k * 10.4; ORIGEN[b + 2] = 12; ORIGEN[b + 3] = 8.4;
    });
    maquetarFilas();
  }

  // Liga: tu fila y la del S&P se ven siempre; si caen fuera, ocupan los últimos huecos tras un corte.
  let FILAS: Fila[] = [];
  function maquetarFilas() {
    const entradas = [...SERIES.ranking.map((s) => ({ estrategia: s as Estrategia | null, valor: s.serie[DIAS] })),
      { estrategia: null, valor: SERIES.sp[DIAS] }].sort((a, b) => b.valor - a.valor);
    const fh = ANCHO ? 50 : 44, gap = 6;
    const n = Math.max(5, Math.floor((P.h + gap - 20) / (fh + gap)));
    const fijas = [entradas.findIndex((e) => e.estrategia?.indice === -1), entradas.findIndex((e) => !e.estrategia)];
    let idx = entradas.map((_, i) => i).slice(0, n);
    for (const m of fijas.slice().sort((a, b) => a - b)) {
      if (idx.includes(m)) continue;
      const quitar = idx.slice().reverse().find((i) => !fijas.includes(i));
      idx = idx.filter((i) => i !== quitar).concat(m).sort((a, b) => a - b);
    }
    const ancho = ANCHO ? Math.min(P.w, 680) : P.w;
    let extra = 0;
    FILAS = idx.map((i, j) => {
      const corte = j > 0 && i !== idx[j - 1] + 1;
      if (corte) extra += 10;
      return { ...entradas[i], corte, j, x: P.x, y: P.y + j * (fh + gap) + extra, w: ancho, h: fh };
    });
  }

  // --- Mercado en vivo hasta el cierre -----------------------------------------------------------
  const ritmo = (e: Empresa) => 0.9 + (e.id % 5) * 0.32;
  function cambioEn(e: Empresa, tt: number) {
    const n = Math.floor(Math.min(tt, T.cierre - 0.001) * ritmo(e));
    return e.cambio + e.vaiven * (hash2(e.id, n) * 2 - 1) * 1.6;
  }
  function destello(e: Empresa, tt: number) {
    if (tt >= T.cierre || reducido) return 0;
    const f = tt * ritmo(e);
    return clamp(1 - (f - Math.floor(f)) * 3.2, 0, 1);
  }

  // Cámara: al empezar, el mapa llena la pantalla; con la foto, se aleja hasta su marco.
  function camara(tt: number) {
    const s0 = Math.max(W / P.w, H / P.h) * 1.02;
    const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
    const deriva = reducido ? 0 : 0.035 * (1 - tramo(tt, 0, T.alejar0));
    const p = entradaSalida(tramo(tt, T.alejar0, T.alejar1));
    let s = lerp(s0 * (1 + deriva), 1, p);
    const empuje = reducido ? 0
      : 0.03 * suave(tramo(tt, T.oscurecer0, T.escribir1)) * (1 - suave(tramo(tt, T.aclarar0, T.aclarar1)));
    s *= 1 + empuje;
    return { s, ox: cx, oy: cy, tx: lerp(W / 2, cx, p), ty: lerp(H / 2, cy, p) };
  }

  // Fondo fijo: el mapa entero, ya congelado, para que el mercado siga detrás de todo.
  let FONDO: HTMLCanvasElement | null = null;
  function pintarFondo() {
    FONDO = document.createElement("canvas");
    FONDO.width = lienzo.width; FONDO.height = lienzo.height;
    const f = FONDO.getContext("2d")!;
    f.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const e of EMP) {
      const b = e.id * 4, ex = L0.R[b], ey = L0.R[b + 1], ew = L0.R[b + 2], eh = L0.R[b + 3];
      if (!(ew > 0)) continue;
      const g = Math.min(0.5, ew * 0.1, eh * 0.1);
      f.fillStyle = rgb(colorCambio(cambioEn(e, T.cierre)));
      f.fillRect(ex + g, ey + g, ew - 2 * g, eh - 2 * g);
    }
  }

  let GOLPES: [Empresa, number, number, number, number][] = [];
  function dibujarMercado(tt: number) {
    const cam = camara(tt);
    const nViv = EV.vivas.length || 1;
    const etiquetas: [Empresa, number, number, number, number, number, number][] = [];
    for (const e of EMP) {
      const b = e.id * 4;
      let ex = L0.R[b], ey = L0.R[b + 1], ew = L0.R[b + 2], eh = L0.R[b + 3];
      if (!(ew > 0)) continue;
      let alfa = 1, fantasma = 0, rotulo = 1;
      let color = colorCambio(cambioEn(e, tt));
      const fl = destello(e, tt);
      if (fl > 0) color = mezcla(color, C.tinta, 0.14 * fl);
      const k = EV.caida[e.id];
      if (k >= 0) {
        const tp = T.regla[k][0] + ((ex + ew / 2 - P.x) / P.w) * T.barrido;
        fantasma = salida(tramo(tt, tp, tp + 0.45));
        if (tt >= T.retile0) { alfa = 1 - suave(tramo(tt, T.retile0, T.retile0 + 0.9)); if (alfa <= 0.01) continue; }
      } else if (tt >= T.retile0) {
        const d = 0.55 * hash2(e.id, 3);
        const p = entradaSalida(tramo(tt, T.retile0 + d, T.retile0 + d + 1.4));
        ex = lerp(ex, L1.R[b], p); ey = lerp(ey, L1.R[b + 1], p); ew = lerp(ew, L1.R[b + 2], p); eh = lerp(eh, L1.R[b + 3], p);
        if (tt >= T.lista0) {
          const r = RANGO[e.id], top = r < 5;
          const d2 = top ? 0.12 * r : 0.3 + 0.7 * (r / nViv);
          const q = entradaSalida(tramo(tt, T.lista0 + d2, T.lista0 + d2 + 1.3));
          ex = lerp(ex, LISTA[b], q); ey = lerp(ey, LISTA[b + 1], q); ew = lerp(ew, LISTA[b + 2], q); eh = lerp(eh, LISTA[b + 3], q);
          color = mezcla(color, top ? C.cartera[r] : C.barra, q);
          rotulo = 1 - tramo(q, 0, 0.35);
          if (tt >= T.cartera0) {
            if (top) {
              const z = entradaSalida(tramo(tt, T.cartera0 + 0.08 * r, T.cartera0 + 0.08 * r + 1.3));
              ex = lerp(ex, BARRA[b], z); ey = lerp(ey, BARRA[b + 1], z); ew = lerp(ew, BARRA[b + 2], z); eh = lerp(eh, BARRA[b + 3], z);
              if (tt >= T.origen0) {
                const o = entradaSalida(tramo(tt, T.origen0, T.origen1));
                ex = lerp(ex, ORIGEN[b], o); ey = lerp(ey, ORIGEN[b + 1], o); ew = lerp(ew, ORIGEN[b + 2], o); eh = lerp(eh, ORIGEN[b + 3], o);
                alfa = 1 - tramo(tt, T.origen1 - 0.25, T.origen1 + 0.15);
                if (alfa <= 0.01) continue;
              }
            } else {
              const f = tramo(tt, T.cartera0 - 0.2 + 0.5 * (r / nViv), T.cartera0 + 0.7 + 0.5 * (r / nViv));
              alfa = 1 - suave(f); ey += 26 * f;
              if (alfa <= 0.01) continue;
            }
          }
        }
      }
      if (tt < T.lista0) {
        ex = cam.tx + (ex - cam.ox) * cam.s; ey = cam.ty + (ey - cam.oy) * cam.s; ew *= cam.s; eh *= cam.s;
      }
      if (fantasma > 0) {
        const s = 1 - 0.42 * fantasma;
        ex += (ew * (1 - s)) / 2; ey += (eh * (1 - s)) / 2; ew *= s; eh *= s;
        color = mezcla(color, C.fantasma, 0.9 * fantasma);
        rotulo *= 1 - fantasma;
      }
      if (ex + ew < 0 || ey + eh < 0 || ex > W || ey > H) continue;
      const g = Math.min(0.5, ew * 0.1, eh * 0.1);
      ctx.fillStyle = rgb(color, alfa);
      ctx.fillRect(ex + g, ey + g, ew - 2 * g, eh - 2 * g);
      if (e.ticker && tt < T.retile1 && alfa > 0.5) GOLPES.push([e, ex, ey, ew, eh]);
      if (e.ticker && rotulo * alfa > 0.02 && ew > 26 && eh > 15) etiquetas.push([e, ex, ey, ew, eh, rotulo * alfa, cambioEn(e, tt)]);
    }
    // Rótulos de las casillas grandes: ticker y variación del día, como en un mapa de bolsa.
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const [e, ex, ey, ew, eh, a, chg] of etiquetas) {
      const ticker = e.ticker!;
      const f = Math.min(ew / (ticker.length * 0.66 + 0.6), eh * 0.36, 30);
      if (f < 8) continue;
      const conCambio = eh > f * 2.7 && f >= 9;
      const cy = ey + eh / 2 - (conCambio ? f * 0.36 : 0);
      ctx.font = `700 ${f.toFixed(1)}px ${F.dato}`;
      ctx.fillStyle = rgb(C.tinta, 0.92 * a);
      ctx.fillText(ticker, ex + ew / 2, cy);
      if (conCambio) {
        ctx.font = `400 ${(f * 0.6).toFixed(1)}px ${F.dato}`;
        ctx.fillStyle = rgb(C.tinta, 0.62 * a);
        ctx.fillText(porcentaje(chg, 2, locale), ex + ew / 2, cy + f * 0.92);
      }
    }
    dibujarSectores(tt, cam);
  }

  function dibujarSectores(tt: number, cam: ReturnType<typeof camara>) {
    const fuera = 1 - tramo(tt, T.retile0 - 0.4, T.retile0 + 0.3);
    const dentro = tramo(tt, T.retile1 - 0.4, T.retile1 + 0.2) * (1 - tramo(tt, T.lista0, T.lista0 + 0.5));
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `600 ${ANCHO ? 10 : 9}px ${F.dato}`;
    const pinta = (lista: Mapa["sectores"], a: number, conCam: boolean) => {
      if (a <= 0.01) return;
      for (const s of lista) {
        let { x: sx, y: sy, w: sw, h: sh } = s;
        if (conCam) { sx = cam.tx + (sx - cam.ox) * cam.s; sy = cam.ty + (sy - cam.oy) * cam.s; sw *= cam.s; sh *= cam.s; }
        const txt = (sectores[s.s] ?? "").toLocaleUpperCase(locale);
        const tw = ctx.measureText(txt).width;
        if (sw < tw + 14 || sh < 34) continue;
        ctx.fillStyle = rgb(C.suelo, 0.62 * a);
        ctx.fillRect(sx + 1, sy + 1, tw + 10, 15);
        ctx.fillStyle = rgb(C.tinta2, 0.85 * a);
        ctx.fillText(txt, sx + 6, sy + 12);
      }
    };
    pinta(L0.sectores, fuera, true);
    pinta(L1.sectores, dentro, false);
  }

  // Barrido de cada regla: una línea que cruza el mapa y apaga lo que no cumple.
  function dibujarBarrido(tt: number) {
    for (let k = 0; k < 4; k++) {
      const a = T.regla[k][0];
      if (tt < a || tt > a + T.barrido + 0.25) continue;
      const lx = P.x + P.w * tramo(tt, a, a + T.barrido);
      const fin = 1 - tramo(tt, a + T.barrido, a + T.barrido + 0.25);
      const grad = ctx.createLinearGradient(lx - 90, 0, lx, 0);
      grad.addColorStop(0, rgb(C.violeta, 0)); grad.addColorStop(1, rgb(C.violeta, 0.16 * fin));
      ctx.fillStyle = grad; ctx.fillRect(lx - 90, P.y, 90, P.h);
      ctx.fillStyle = rgb(C.violeta, 0.95 * fin); ctx.fillRect(lx - 0.75, P.y - 6, 1.5, P.h + 12);
    }
  }

  // Filas con nombre (criterios) y tramos de la cartera, por encima de las casillas.
  function dibujarRotulosCartera(tt: number) {
    if (tt < T.lista0 + 0.4 || tt > T.origen0 + 0.4) return;
    const enLista = tramo(tt, T.lista0 + 0.9, T.lista0 + 1.6) * (1 - tramo(tt, T.cartera0, T.cartera0 + 0.35));
    const enBarra = tramo(tt, T.cartera0 + 1.0, T.cartera0 + 1.5) * (1 - tramo(tt, T.origen0, T.origen0 + 0.3));
    EV.cartera.forEach((e, k) => {
      const b = e.id * 4, ticker = e.ticker!;
      if (enLista > 0.01) {
        const lx = LISTA[b], ly = LISTA[b + 1], lw = LISTA[b + 2];
        ctx.textBaseline = "middle"; ctx.textAlign = "left";
        ctx.font = `600 ${ANCHO ? 12 : 11}px ${F.dato}`; ctx.fillStyle = rgb(C.suelo, 0.75 * enLista);
        ctx.fillText(String(k + 1), lx + 12, ly + filaH / 2);
        ctx.font = `700 ${ANCHO ? 16 : 14}px ${F.dato}`; ctx.fillStyle = rgb(C.suelo, 0.95 * enLista);
        ctx.fillText(ticker, lx + 34, ly + filaH / 2);
        const tw = ctx.measureText(ticker).width;
        ctx.font = `600 ${ANCHO ? 14 : 12.5}px ${F.ui}`; ctx.fillStyle = rgb(C.suelo, 0.72 * enLista);
        ctx.fillText(e.nombre ?? "", lx + 44 + tw, ly + filaH / 2);
        ctx.textAlign = "right";
        ctx.font = `700 ${ANCHO ? 14 : 12.5}px ${F.dato}`; ctx.fillStyle = rgb(C.suelo, 0.9 * enLista);
        ctx.fillText(t("landing_nota", { valor: decimal(e.nota, 1) }), lx + lw - 12, ly + filaH / 2);
      }
      if (enBarra > 0.01) {
        const bx = BARRA[b], by = BARRA[b + 1], bw = BARRA[b + 2], bh = BARRA[b + 3];
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const f = Math.min(ANCHO ? 18 : 14, bw / (ticker.length * 0.7 + 0.4));
        ctx.font = `700 ${f.toFixed(1)}px ${F.dato}`; ctx.fillStyle = rgb(C.suelo, 0.95 * enBarra);
        ctx.fillText(ticker, bx + bw / 2, by + bh / 2 - f * 0.45);
        ctx.font = `400 ${(f * 0.72).toFixed(1)}px ${F.dato}`; ctx.fillStyle = rgb(C.suelo, 0.75 * enBarra);
        ctx.fillText(t("landing_peso_tramo", { valor: 20 }), bx + bw / 2, by + bh / 2 + f * 0.62);
      }
    });
    const resto = EV.vivas.length - 5;
    if (enLista > 0.01 && resto > 0) {
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.font = `600 11px ${F.dato}`; ctx.fillStyle = rgb(C.mudo, enLista);
      ctx.fillText(t("landing_mas_ordenadas", { cuantas: miles(resto, locale) }), P.x, listaY0 - 5);
    }
  }

  // --- Gráfica: seis jornadas contra el S&P 500 --------------------------------------------------
  type Mapeo = (d: number, v: number) => [number, number];
  const xy: Mapeo = (d, v) => [G.x(d), G.y(v)];
  function trazar(serie: number[], hasta: number, map: Mapeo) {
    ctx.beginPath();
    const n = Math.floor(hasta);
    for (let d = 0; d <= n; d++) { const [px, py] = map(d, serie[d]); if (d) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    if (hasta > n && n < DIAS) { const [px, py] = map(hasta, valorEn(serie, hasta)); ctx.lineTo(px, py); }
  }

  function dibujarGrafica(tt: number) {
    if (tt < T.origen0 - 0.1) return;
    const ejes = tramo(tt, T.origen0, T.origen1) * (1 - tramo(tt, T.filas0, T.filas0 + 0.6));
    const liga = entradaSalida(tramo(tt, T.otras0, T.otras1));
    G.min = lerp(G.base[0], G.liga[0], liga); G.max = lerp(G.base[1], G.liga[1], liga);
    const hasta = DIAS * tramo(tt, T.trazo0, T.trazo1);
    if (ejes > 0.01) {
      ctx.save();
      ctx.strokeStyle = rgb(C.mudo, 0.55 * ejes); ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(G.x0, G.y(0)); ctx.lineTo(G.x1, G.y(0)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `600 ${ANCHO ? 11 : 10}px ${F.dato}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      for (let j = 0; j < 6; j++) {
        const xa = G.x(j * SESIONES_JORNADA), xb = G.x((j + 1) * SESIONES_JORNADA), viva = hasta >= j * SESIONES_JORNADA;
        if (j) { ctx.fillStyle = rgb(C.tinta, 0.07 * ejes); ctx.fillRect(xa, G.yA - 10, 1, G.yB - G.yA + 16); }
        ctx.fillStyle = rgb(viva ? C.tinta2 : C.mudo, (viva ? 0.9 : 0.4) * ejes);
        ctx.fillText(t("landing_jornada_corta", { numero: j + 1 }), (xa + xb) / 2, G.yB + 24);
      }
      ctx.textAlign = "left"; ctx.fillStyle = rgb(C.mudo, 0.8 * ejes);
      ctx.fillText(porcentaje(0, 0, locale), G.x1 + 8, G.y(0) + 4);
      ctx.restore();
    }
    const filas = tramo(tt, T.filas0, T.filas0 + 0.5);
    // Zona entre las dos líneas: verde cuando vas por delante, rojo cuando no.
    if (hasta > 0 && filas < 1) {
      const a = (1 - filas) * 0.16 * (1 - liga * 0.6);
      for (let d = 0; d < Math.min(hasta, DIAS); d++) {
        const d2 = Math.min(d + 1, hasta);
        const tu1 = SERIES.tu[d], tu2 = valorEn(SERIES.tu, d2), sp1 = SERIES.sp[d], sp2 = valorEn(SERIES.sp, d2);
        ctx.fillStyle = rgb(tu1 + tu2 >= sp1 + sp2 ? C.bien : C.mal, a);
        ctx.beginPath(); ctx.moveTo(G.x(d), G.y(tu1)); ctx.lineTo(G.x(d2), G.y(tu2));
        ctx.lineTo(G.x(d2), G.y(sp2)); ctx.lineTo(G.x(d), G.y(sp1)); ctx.closePath(); ctx.fill();
      }
    }
    if (liga > 0.001) dibujarLiga(tt, liga);
    if (hasta <= 0) return;
    const spA = 1 - tramo(tt, T.filas0, T.filas0 + 0.6);
    if (spA > 0.01) {
      ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = rgb(C.tinta2, 0.8 * spA);
      trazar(SERIES.sp, hasta, xy); ctx.stroke(); ctx.restore();
    }
    if (tt >= T.filas0) return;
    ctx.lineWidth = ANCHO ? 3 : 2.5; ctx.strokeStyle = rgb(C.teal); ctx.lineJoin = "round";
    trazar(SERIES.tu, hasta, xy); ctx.stroke();
    const [px, py] = xy(hasta, valorEn(SERIES.tu, hasta)), [sx, sy] = xy(hasta, valorEn(SERIES.sp, hasta));
    ctx.fillStyle = rgb(C.tinta2, spA); ctx.beginPath(); ctx.arc(sx, sy, 3, 0, 7); ctx.fill();
    ctx.fillStyle = rgb(C.teal); ctx.strokeStyle = rgb(C.suelo); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill(); ctx.stroke();
    if (hasta >= DIAS - 0.01) rotulosFinales(spA * (1 - liga));
  }

  function rotulosFinales(a: number) {
    if (a <= 0.01) return;
    const vt = SERIES.tu[DIAS], vs = SERIES.sp[DIAS];
    let yt = G.y(vt), ys = G.y(vs);
    if (Math.abs(yt - ys) < 30) { const m = (yt + ys) / 2, s = yt < ys ? -1 : 1; yt = m + s * 15; ys = m - s * 15; }
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const rx = G.x1 + 10;
    ctx.font = `700 ${ANCHO ? 15 : 13}px ${F.dato}`;
    ctx.fillStyle = rgb(C.teal, a); ctx.fillText(porcentaje(vt, 1, locale), rx, yt - 7);
    ctx.fillStyle = rgb(C.tinta2, a); ctx.fillText(porcentaje(vs, 1, locale), rx, ys - 7);
    ctx.font = `400 ${ANCHO ? 11 : 10}px ${F.dato}`;
    ctx.fillStyle = rgb(C.teal, 0.8 * a); ctx.fillText(t("landing_tu_estrategia_corta"), rx, yt + 8);
    ctx.fillStyle = rgb(C.mudo, a); ctx.fillText(t("landing_sp500"), rx, ys + 8);
  }

  // --- Liga: todas salen del mismo día y cada línea acaba tumbada en su fila -----------------------
  function dibujarLiga(tt: number, liga: number) {
    const lineas = DIAS * tramo(tt, T.otras0, T.otras1 + 0.3);
    const enFila = new Map(FILAS.filter((f) => f.estrategia).map((f) => [f.estrategia!, f]));
    for (const s of SERIES.todas) {
      const yo = s.indice === -1, f = enFila.get(s);
      const p = f ? entradaSalida(tramo(tt, T.filas0 + 0.05 * f.j, T.filas0 + 0.05 * f.j + 1.3)) : 0;
      let a = yo ? 1 : (s.casa ? 0.5 : 0.3) * liga;
      if (!f) a *= 1 - tramo(tt, T.filas0, T.filas0 + 0.6);
      if (a <= 0.01) continue;
      const map: Mapeo = f && p > 0 ? (d, v) => {
        const [px, py] = xy(d, v);
        return [lerp(px, f.x + (f.w * d) / DIAS, p), lerp(py, f.y + f.h - 1, p)];
      } : xy;
      ctx.lineWidth = yo ? (ANCHO ? 3 : 2.5) : 1;
      ctx.strokeStyle = yo ? rgb(C.teal, a) : rgb(C.tinta2, a * (1 - 0.6 * tramo(p, 0.5, 1)));
      trazar(s.serie, yo ? DIAS : Math.min(lineas, DIAS), map);
      ctx.stroke();
    }
    if (tt >= T.filas0) dibujarFilas(tt);
  }

  function redondo(rx: number, ry: number, rw: number, rh: number, r: number) {
    ctx.beginPath(); ctx.moveTo(rx + r, ry); ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r); ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
    ctx.arcTo(rx, ry + rh, rx, ry, r); ctx.arcTo(rx, ry, rx + rw, ry, r); ctx.closePath();
  }
  const nombreDe = (s: Estrategia) => (s.indice === -1 ? t("landing_nombre_estrategia") : nombresLiga[s.indice] ?? "");
  const movimiento = (s: Estrategia) => (s.puestoAntes > s.puesto ? t("landing_sube", { cuantos: s.puestoAntes - s.puesto })
    : s.puestoAntes < s.puesto ? t("landing_baja", { cuantos: s.puesto - s.puestoAntes }) : "");

  function dibujarFilas(tt: number) {
    const fin = tramo(tt, T.D - 3.6, T.D - 2.6);
    for (const f of FILAS) {
      const p = entradaSalida(tramo(tt, T.filas0 + 0.05 * f.j, T.filas0 + 0.05 * f.j + 1.3));
      const fondo = tramo(p, 0.45, 1), texto = tramo(p, 0.6, 1) * (1 - 0.55 * fin);
      if (fondo <= 0.01) continue;
      ctx.save();
      const cy = f.y + (f.h - 2) / 2;
      if (!f.estrategia) {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = rgb(C.tinta2, 0.45 * fondo); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(f.x, f.y + f.h / 2); ctx.lineTo(f.x + f.w, f.y + f.h / 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `600 ${ANCHO ? 12 : 11}px ${F.dato}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
        const etiqueta = t("landing_sp_fila", { valor: porcentaje(f.valor, 1, locale) }), tw = ctx.measureText(etiqueta).width;
        ctx.fillStyle = rgb(C.suelo); ctx.fillRect(f.x + f.w / 2 - tw / 2 - 10, f.y + f.h / 2 - 9, tw + 20, 18);
        ctx.fillStyle = rgb(C.tinta2, texto); ctx.fillText(etiqueta, f.x + f.w / 2, f.y + f.h / 2);
        ctx.restore();
        continue;
      }
      const s = f.estrategia, yo = s.indice === -1;
      redondo(f.x, f.y, f.w, f.h - 2, 12);
      ctx.fillStyle = yo ? `rgba(63,199,191,${0.13 * fondo})` : rgb(C.panel, 0.92 * fondo); ctx.fill();
      ctx.strokeStyle = yo ? rgb(C.teal, 0.9 * fondo) : rgb(C.tinta, 0.1 * fondo); ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = texto;
      ctx.textBaseline = "middle"; ctx.textAlign = "left";
      ctx.font = `700 ${ANCHO ? 13 : 12}px ${F.dato}`; ctx.fillStyle = rgb(yo ? C.teal : C.tinta2);
      ctx.fillText(String(s.puesto), f.x + 12, cy);
      const nx = f.x + (ANCHO ? 48 : 40);
      ctx.font = `700 ${ANCHO ? 15 : 13.5}px ${F.ui}`; ctx.fillStyle = rgb(C.tinta);
      ctx.fillText(nombreDe(s), nx, cy - 7);
      ctx.font = `400 ${ANCHO ? 11.5 : 10.5}px ${F.dato}`; ctx.fillStyle = rgb(C.mudo);
      const sub = yo ? `${t("landing_tu")}  ${movimiento(s)}` : s.casa ? t("landing_casa") : s.alias ?? "";
      ctx.fillText(sub.trim(), nx, cy + 9);
      ctx.textAlign = "right";
      ctx.font = `700 ${ANCHO ? 16 : 14}px ${F.dato}`; ctx.fillStyle = rgb(f.valor >= 0 ? C.bien : C.mal);
      ctx.fillText(porcentaje(f.valor, 1, locale), f.x + f.w - 12, cy - 7);
      ctx.font = `400 ${ANCHO ? 11.5 : 10.5}px ${F.dato}`; ctx.fillStyle = rgb(C.mudo);
      ctx.fillText(fraseVsIndice(t, f.valor - SERIES.sp[DIAS], locale), f.x + f.w - 12, cy + 9);
      ctx.restore();
    }
    const a = tramo(tt, T.filas0 + 0.6, T.filas0 + 1.2) * (1 - 0.55 * fin);
    for (const f of FILAS) {
      if (!f.corte || a <= 0.01) continue;
      ctx.fillStyle = rgb(C.mudo, a); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `700 12px ${F.dato}`;
      ctx.fillText("···", f.x + f.w / 2, f.y - 8);
    }
  }

  // --- Fotograma ---------------------------------------------------------------------------------
  function dibujar(tt: number) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = rgb(C.suelo); ctx.fillRect(0, 0, W, H);
    const fondo = 0.07 * suave(tramo(tt, T.lista0 - 0.4, T.lista0 + 1.2));
    if (fondo > 0.003 && FONDO) { ctx.globalAlpha = fondo; ctx.drawImage(FONDO, 0, 0, W, H); ctx.globalAlpha = 1; }
    GOLPES = [];
    if (tt < T.origen1 + 0.3) dibujarMercado(tt);
    dibujarBarrido(tt);
    dibujarRotulosCartera(tt);
    dibujarGrafica(tt);
    const osc = 0.64 * suave(tramo(tt, T.oscurecer0, T.oscurecer1)) * (1 - suave(tramo(tt, T.aclarar0, T.aclarar1)))
      + 0.45 * suave(tramo(tt, T.D - 3.8, T.D - 2.6));
    if (osc > 0.003) { ctx.fillStyle = rgb(C.suelo, osc); ctx.fillRect(0, 0, W, H); }
    // Mientras el mapa llena la pantalla, la franja de texto necesita su sombra.
    const sombra = 0.9 * tramo(tt, T.cierre - 0.2, T.cierre + 0.4) * (1 - tramo(tt, T.alejar0, T.alejar1));
    if (sombra > 0.01) {
      const tz = franja.getBoundingClientRect(), st = escena.getBoundingClientRect();
      const grad = ANCHO ? ctx.createLinearGradient(0, 0, tz.right - st.left + 140, 0)
        : ctx.createLinearGradient(0, tz.top - st.top - 90, 0, H);
      grad.addColorStop(0, rgb(C.suelo, ANCHO ? sombra : 0)); grad.addColorStop(ANCHO ? 0.6 : 0.35, rgb(C.suelo, sombra * 0.85));
      grad.addColorStop(1, rgb(C.suelo, ANCHO ? 0 : sombra));
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
  }

  // --- Capas de texto ----------------------------------------------------------------------------
  const items = ITEMS.map(([n, ...tiempos]) => [raiz.querySelector<HTMLElement>(`[data-it="${n}"]`)!, ...tiempos] as const);
  const caracteres = [...pieza("tesis").querySelectorAll<HTMLElement>(".c")];
  const frases = [...pieza("tesis").querySelectorAll<HTMLElement>(".ph")];
  const reglas = piezas("regla"), pesos = piezas("peso");
  const cache = new WeakMap<HTMLElement, { o?: number; x?: number; y?: number }>();
  function estilo(el: HTMLElement, op: number, ty = 0, tx = 0) {
    const k = cache.get(el) ?? {};
    const o = Math.round(op * 1000) / 1000, y = Math.round(ty * 10) / 10, x2 = Math.round(tx * 10) / 10;
    if (k.o !== o) { el.style.opacity = String(o); el.style.visibility = o < 0.02 ? "hidden" : "visible"; k.o = o; }
    if (k.y !== y || k.x !== x2) { el.style.transform = `translate(${x2}px, ${y}px)`; k.y = y; k.x = x2; }
    cache.set(el, k);
  }
  const texto = (el: HTMLElement, s: string) => { if (el.textContent !== s) el.textContent = s; };

  function contarVivas(tt: number) {
    if (tt < T.regla[0][0]) return EMP.length;
    let n = 0;
    for (const e of EMP) {
      const k = EV.caida[e.id];
      if (k < 0) { n++; continue; }
      const b = e.id * 4, cx = L0.R[b] + L0.R[b + 2] / 2;
      if (tt < T.regla[k][0] + ((cx - P.x) / P.w) * T.barrido + 0.15) n++;
    }
    return n;
  }

  let escritas = -1, debajo = false;
  function actualizarDOM(tt: number) {
    for (const [el, a0, a1, b0, b1] of items) {
      const ent = salida(tramo(tt, a0, a1)), sal = suave(tramo(tt, b0, b1));
      estilo(el, ent * (1 - sal), (1 - ent) * 16 - sal * 12);
      el.classList.toggle("on", ent * (1 - sal) > 0.5);
    }
    // Reloj de Nueva York: la foto se toma al cierre.
    const cerrado = tt >= T.cierre;
    texto(pieza("relojTxt"), cerrado ? t("landing_reloj_cierre")
      : t("landing_reloj_vivo", { hora: `15:59:5${6 + Math.min(Math.floor(clamp(tt, 0, T.cierre)), 3)}` }));
    pieza("reloj").classList.toggle("cerrado", cerrado);
    estilo(pieza("reloj"), 1 - tramo(tt, 12.4, 13.0));
    const visor = pieza("visor");
    estilo(visor, tramo(tt, T.cierre, T.cierre + 0.45) * (1 - tramo(tt, T.lista0 - 0.6, T.lista0)));
    visor.style.scale = String(1 + 0.035 * (1 - salida(tramo(tt, T.cierre, T.cierre + 0.6))));
    const idea = tramo(tt, T.oscurecer0, T.oscurecer1) * (1 - tramo(tt, T.aclarar0, T.aclarar1));
    estilo(pieza("recuento"), tramo(tt, T.cierre + 0.2, T.cierre + 0.8) * (1 - tramo(tt, T.lista0 + 0.2, T.lista0 + 0.8)) * (1 - idea));
    texto(pieza("recuentoN"), miles(contarVivas(tt), locale));
    texto(pieza("recuentoL"), tt < T.regla[0][0] ? t("landing_recuento_foto") : t("landing_recuento_reglas"));
    // Tesis: se escribe sola y luego se subrayan las frases que se convierten en reglas.
    const n = Math.floor(caracteres.length * tramo(tt, T.escribir0, T.escribir1));
    if (n !== escritas) {
      caracteres.forEach((c, i) => { c.classList.toggle("v", i < n); c.classList.toggle("ult", i === n - 1 && n < caracteres.length); });
      escritas = n;
    }
    frases.forEach((ph) => {
      const k = Number(ph.dataset.k);
      ph.style.setProperty("--u", tramo(tt, 11.85 + 0.22 * k, 12.2 + 0.22 * k).toFixed(3));
    });
    // Reglas: entran una a una y se marcan mientras su barrido cruza el mapa.
    reglas.forEach((li, k) => {
      const e = salida(tramo(tt, 13.0 + 0.14 * k, 13.6 + 0.14 * k));
      estilo(li, e, 0, (1 - e) * -10);
      const a = T.regla[k][0];
      li.classList.toggle("activa", tt >= a - 0.1 && tt <= a + T.barrido + 0.2);
      estilo(li.querySelector<HTMLElement>('[data-p="reglaCuenta"]')!, tramo(tt, a + T.barrido, a + T.barrido + 0.3));
    });
    estilo(pieza("pista"), tramo(tt, T.retile1, T.retile1 + 0.5));
    pesos.forEach((li, k) => {
      const e = salida(tramo(tt, 25.7 + 0.12 * k, 26.4 + 0.12 * k));
      estilo(li, e, 0, (1 - e) * -10);
      li.querySelector<HTMLElement>("i")!.style.transform = `scaleX(${(e * Number(li.dataset.peso) / 35).toFixed(3)})`;
    });
    // Lectura de la gráfica mientras se dibuja.
    const hasta = DIAS * tramo(tt, T.trazo0, T.trazo1);
    const vt = valorEn(SERIES.tu, hasta), vs = valorEn(SERIES.sp, hasta);
    texto(pieza("lectJ"), t("landing_lectura_jornada", { numero: Math.min(6, Math.floor(hasta / SESIONES_JORNADA) + 1) }));
    texto(pieza("lectTu"), t("landing_lectura_tu", { valor: porcentaje(vt, 1, locale) }));
    texto(pieza("lectSp"), t("landing_lectura_sp", { valor: porcentaje(vs, 1, locale) }));
    if (hasta > 1 && hasta < DIAS) { if (vt < vs - 0.3) debajo = true; else if (vt > vs + 0.3) debajo = false; }
    if (hasta >= DIAS) debajo = false;
    texto(pieza("notaCap"), debajo ? t("landing_debajo_frase") : t("landing_nota_frase"));
    // Veredicto.
    const yo = SERIES.yo, dif = SERIES.tu[DIAS] - SERIES.sp[DIAS];
    const vf = pieza("verFrase");
    texto(vf, fraseVsIndice(t, dif, locale));
    vf.classList.toggle("dn", dif < 0);
    const mov = movimiento(yo);
    texto(pieza("verSub"), t("landing_veredicto_sub", { tu: porcentaje(SERIES.tu[DIAS], 1, locale),
      sp: porcentaje(SERIES.sp[DIAS], 1, locale), puesto: yo.puesto, total: SERIES.todas.length }) + (mov ? ` · ${mov}` : ""));
    // Aviso de que la película sigue bajando, hasta que se usa el scroll.
    estilo(pieza("desliza"), tramo(tt, T.intro - 0.6, T.intro) * (1 - tramo(scrollY - pelicula.offsetTop, 8, 60)));
  }

  function actualizarReglas() {
    texto(pieza("perTxt"), t("landing_regla_valor_per", { valor: PER }));
    selector.style.setProperty("--p", `${((PER - PER_MIN) / (PER_MAX - PER_MIN)) * 100}%`);
    reglas.forEach((li, k) => texto(li.querySelector<HTMLElement>('[data-p="reglaCuenta"]')!, miles(EV.cuenta[k + 1], locale)));
  }

  // --- Ficha de una empresa al tocarla: por qué cumple o no --------------------------------------
  function dato(e: Empresa, k: number): string | null {
    if (k === 0) return e.roe == null ? null : t("landing_dato_roe", { valor: decimal(e.roe, 0) });
    if (k === 1) return t("landing_dato_ventas", { valor: signo(e.ventas, 0, locale) });
    if (k === 2) return e.deuda == null ? null : e.deuda < 0 ? t("landing_dato_caja") : t("landing_dato_deuda", { valor: decimal(e.deuda, 1) });
    return e.per == null ? t("landing_sin_beneficio") : t("landing_dato_per", { valor: decimal(e.per, 0) });
  }
  function abrirFicha(e: Empresa, ex: number, ey: number, ew: number, eh: number) {
    const nombres = ["landing_regla_rentables", "landing_regla_ventas", "landing_regla_deuda", "landing_regla_barata"].map((k) => t(k));
    const pasa = [0, 1, 2, 3].map((k) => cumple(e, k, PER));
    const fallo = pasa.indexOf(false);
    const veredicto = EV.cartera.includes(e) ? t("landing_ficha_entra")
      : fallo < 0 ? t("landing_ficha_cumple", { puesto: EV.vivas.indexOf(e) + 1, total: EV.vivas.length })
        : t("landing_ficha_fuera", { regla: nombres[fallo] });
    const nodo = (tag: string, clase: string | null, txt: string) => {
      const el = document.createElement(tag); if (clase) el.className = clase; el.textContent = txt; return el;
    };
    const h3 = nodo("h3", null, e.nombre ?? ""); h3.append(nodo("span", null, e.ticker ?? ""));
    const ul = document.createElement("ul");
    pasa.forEach((ok, k) => {
      const d = dato(e, k);
      const li = nodo("li", ok ? "si" : d == null ? "sd" : "no", "");
      li.append(nodo("span", null, nombres[k]), nodo("b", null, d ?? t("landing_sin_dato")));
      ul.append(li);
    });
    ficha.replaceChildren(h3, nodo("p", null, `${sectores[e.sector] ?? ""} · ${veredicto}`), ul);
    ficha.hidden = false;
    const tw = ficha.offsetWidth, th = ficha.offsetHeight;
    let ty = ey + eh + 8;
    if (ty + th > H - 70) ty = Math.max(70, ey - th - 8);
    ficha.style.left = `${clamp(ex + ew / 2 - tw / 2, 12, W - tw - 12)}px`; ficha.style.top = `${ty}px`;
  }
  const cerrarFicha = () => { ficha.hidden = true; };

  // --- Reproducción: la apertura se ve sola y después manda el scroll ----------------------------
  let tVis = 0, ultimo = 0, marco = 0, espera = 0, desde = 0;
  const consulta = new URLSearchParams(location.search);
  // `?t=24` abre la película en ese segundo, para enlazar un momento concreto.
  const inicio = consulta.has("t") ? clamp(Number(consulta.get("t")) || 0, 0, T.D) : null;
  const largo = () => Math.max(1, pelicula.offsetHeight - innerHeight);
  const avance = () => clamp((scrollY - pelicula.offsetTop) / largo(), 0, 1);
  const scrollDe = (tt: number) => pelicula.offsetTop + clamp((tt - T.intro) / (T.D - T.intro), 0, 1) * largo();

  function bucle(ahora: number) {
    const dt = Math.min(0.05, (ahora - (ultimo || ahora)) / 1000); ultimo = ahora;
    if (!desde) desde = ahora;
    const apertura = inicio != null && inicio <= T.intro ? inicio : reducido ? T.intro : Math.min(T.intro, (ahora - desde) / 1000);
    const a = avance();
    const objetivo = a > 0 ? T.intro + a * (T.D - T.intro) : apertura;
    tVis = reducido ? objetivo : tVis + (objetivo - tVis) * (1 - Math.exp(-dt * 9));
    dibujar(tVis); actualizarDOM(tVis);
    marco = requestAnimationFrame(bucle);
  }

  function alCambiarPer() {
    PER = Number(selector.value);
    EV = evaluar(EMP, PER);
    SERIES = crearSeries(EV.cartera);
    fijarRangos(); maquetar(); actualizarReglas();
  }
  function rehacer() { F = fuentes(); medir(); fijarRangos(); maquetar(); pintarFondo(); posicionar(); }
  function posicionar() {
    const fija = (el: HTMLElement, px: number, py: number) => { el.style.left = `${px}px`; el.style.top = `${py}px`; };
    fija(pieza("recuento"), P.x + 14, P.y + 14);
    const visor = pieza("visor"); fija(visor, P.x - 7, P.y - 7);
    visor.style.width = `${P.w + 14}px`; visor.style.height = `${P.h + 14}px`;
    const reloj = pieza("reloj"); reloj.style.right = `${W - (P.x + P.w) + 12}px`; reloj.style.top = `${P.y + 16}px`;
  }
  function grano() {
    const c = document.createElement("canvas"); c.width = c.height = 180;
    const g = c.getContext("2d")!, img = g.createImageData(180, 180);
    for (let i = 0; i < img.data.length; i += 4) { const v = hash2(i, 5) * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    pieza("grano").style.backgroundImage = `url(${c.toDataURL()})`;
  }

  // --- Eventos -------------------------------------------------------------------------------------
  const alScroll = () => { if (!ficha.hidden) cerrarFicha(); };
  const alPulsarEscena = (ev: MouseEvent) => {
    if ((ev.target as HTMLElement).closest("a, button, input, label, [data-p='ficha']")) return;
    if (!ficha.hidden) { cerrarFicha(); return; }
    const r = escena.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    const golpe = GOLPES.find(([, gx, gy, gw, gh]) => px >= gx && px <= gx + gw && py >= gy && py <= gy + gh);
    if (golpe) abrirFicha(...golpe);
  };
  const alRedimensionar = () => { clearTimeout(espera); espera = window.setTimeout(rehacer, 120); };

  medir(); fijarRangos(); maquetar(); pintarFondo(); posicionar(); grano(); actualizarReglas();
  if (inicio != null && inicio > T.intro) window.scrollTo(0, scrollDe(inicio));
  tVis = inicio ?? 0;
  addEventListener("scroll", alScroll, { passive: true });
  addEventListener("resize", alRedimensionar);
  escena.addEventListener("click", alPulsarEscena);
  selector.addEventListener("input", alCambiarPer);
  document.fonts?.ready.then(() => { if (marco) rehacer(); });
  marco = requestAnimationFrame(bucle);

  return () => {
    cancelAnimationFrame(marco); marco = 0;
    clearTimeout(espera);
    removeEventListener("scroll", alScroll);
    removeEventListener("resize", alRedimensionar);
    escena.removeEventListener("click", alPulsarEscena);
    selector.removeEventListener("input", alCambiarPer);
  };
}
