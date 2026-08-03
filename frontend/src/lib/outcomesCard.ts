// La lectura de la auditoría dibujada en SVG, SOLO para exportar (en pantalla es tabla HTML).
//
// Mismo lenguaje que el resto de tarjetas: un solo acento (lo que "gana"), un segundo acento
// SOLO para la referencia (el S&P), el resto neutro. Ningún ticker aparece: son agregados por
// grupo y puntos sin identificar — cómo se comporta el criterio es público, qué nombres toca no.
//
// El color se recibe, no se decide aquí: `palette` (ver `CardPalette` en `exportCard.ts`) ya
// trae resuelto si esto se pinta para el dark de X o el claro de LinkedIn.

import { wrapLines, type CardPalette } from "./exportCard";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export interface GroupBar {
  label: string;
  value: number;              // retorno medio del grupo, en %
  n?: number;                 // tamaño del grupo (se pinta junto al rótulo)
  kind?: "acento" | "indice" | "neutro";
}

/** Barras horizontales por grupo, con eje en el cero: los retornos pueden ser negativos y
 *  una barra "desde la izquierda" mentiría sobre el signo. `pie` = lectura en una frase. */
export function groupBarsSvg(grupos: GroupBar[], palette: CardPalette, pie = ""): string {
  if (!grupos.length) return "";
  const W = 440;
  const H = 400;
  const lineas = pie ? wrapLines(pie, W, 16) : [];
  const pieH = lineas.length ? lineas.length * 22 + 16 : 0;
  const util = H - pieH;

  const maxAbs = Math.max(...grupos.map((g) => Math.abs(g.value)), 0.5);
  const hayNeg = grupos.some((g) => g.value < 0);
  // Con negativos, dominio simétrico y cero al centro; si todo es positivo, el cero al borde.
  const x0 = hayNeg ? W / 2 : 0;
  const escala = (hayNeg ? W / 2 : W) / maxAbs;

  const rowH = Math.min(96, util / grupos.length);
  const top = (util - rowH * grupos.length) / 2;

  const filas = grupos
    .map((g, i) => {
      const y = top + i * rowH;
      const w = Math.max(3, Math.abs(g.value) * escala);
      const bx = g.value >= 0 ? x0 : x0 - w;
      const fill = g.kind === "acento" ? palette.accent : g.kind === "indice" ? palette.accent2 : palette.neutral;
      const vcolor = g.value >= 0 ? palette.ink : palette.bad;
      return `<g>
    <text x="0" y="${y + 22}" font-size="18" fill="${palette.ink2}">${esc(g.label)}${g.n ? ` <tspan fill="${palette.ink2}">· ${g.n}</tspan>` : ""}</text>
    <text x="${W}" y="${y + 26}" text-anchor="end" font-size="32" font-weight="700" fill="${vcolor}">${fmtPct(g.value)}</text>
    <rect x="0" y="${y + 40}" width="${W}" height="11" rx="5.5" fill="${palette.carril}"/>
    <rect x="${bx.toFixed(1)}" y="${y + 40}" width="${w.toFixed(1)}" height="11" rx="5.5" fill="${fill}"/>
    ${hayNeg ? `<rect x="${x0 - 0.75}" y="${y + 37}" width="1.5" height="17" fill="${palette.ink2}"/>` : ""}
  </g>`;
    })
    .join("\n");

  const pieSvg = lineas
    .map((l, i) => `<text x="0" y="${util + 22 + i * 22}" font-size="16" fill="${palette.ink2}">${esc(l)}</text>`)
    .join("\n");

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${filas}${pieSvg}</svg>`;
}

export interface ScorePoint {
  score: number;
  ret: number;
  funded?: boolean;
}

/** Score profundo (x) contra retorno desde el escaneo (y). Cada punto es un análisis a fondo,
 *  sin identificar; los del acento son los que acabaron en el libro. Responde de un vistazo a
 *  "¿puntuar más alto significa rendir mejor?" — si la nube no sube hacia la derecha, no. */
export function scatterSvg(puntos: ScorePoint[], palette: CardPalette, W = 440, H = 400): string {
  if (!puntos.length) return "";
  const L = 44;              // hueco para las etiquetas del eje y
  const B = 34;              // hueco para las del eje x
  const iw = W - L;
  const ih = H - B;

  const xs = puntos.map((p) => p.score);
  const ys = puntos.map((p) => p.ret);
  const xmin = Math.floor((Math.min(...xs) - 2) / 5) * 5;
  const xmax = Math.ceil((Math.max(...xs) + 2) / 5) * 5;
  const yAbs = Math.max(...ys.map(Math.abs), 1);
  const ymax = Math.ceil(yAbs * 1.15);

  const px = (s: number) => L + ((s - xmin) / Math.max(1, xmax - xmin)) * iw;
  const py = (r: number) => (ih / 2) * (1 - r / ymax);

  const dots = puntos
    .map((p) => `<circle cx="${px(p.score).toFixed(1)}" cy="${py(p.ret).toFixed(1)}" r="${p.funded ? 7 : 5.5}" fill="${p.funded ? palette.accent : palette.neutral}" fill-opacity="${p.funded ? 1 : 0.85}"/>`)
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <line x1="${L}" y1="${py(0)}" x2="${W}" y2="${py(0)}" stroke="${palette.ink2}" stroke-width="1.5"/>
    <line x1="${L}" y1="0" x2="${L}" y2="${ih}" stroke="${palette.carril}" stroke-width="1.5"/>
    <text x="${L - 8}" y="${py(ymax) + 12}" text-anchor="end" font-size="14" fill="${palette.ink2}">+${ymax}%</text>
    <text x="${L - 8}" y="${py(0) + 5}" text-anchor="end" font-size="14" fill="${palette.ink2}">0</text>
    <text x="${L - 8}" y="${py(-ymax) - 2}" text-anchor="end" font-size="14" fill="${palette.ink2}">−${ymax}%</text>
    ${dots}
    <text x="${L}" y="${H - 8}" font-size="14" fill="${palette.ink2}">score ${xmin}</text>
    <text x="${W}" y="${H - 8}" text-anchor="end" font-size="14" fill="${palette.ink2}">${xmax}</text>
  </svg>`;
}
