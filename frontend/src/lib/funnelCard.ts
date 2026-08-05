// El embudo dibujado en SVG, SOLO para exportar (en pantalla el panel es HTML y así se queda).
//
// Por qué no reutilizar el panel: la tarjeta sale a 16:9 o 1,91:1 y el panel vive en una columna
// estrecha. Rasterizar el HTML del panel daría una imagen apaisada con todo apelotonado a la
// izquierda; aquí el mismo dato se reparte a lo ancho, que es lo que pide una imagen de post.
//
// Lo que se pinta son AGREGADOS por etapa y sector: cuántos nombres sobreviven a cada corte.
// Ningún ticker aparece, ni debe — cómo se comporta el embudo es público, qué elige no.
//
// Dos decisiones que vienen de mirar la tarjeta y no entenderla:
//  · UN solo acento. Antes cada peldaño tenía su color en una rampa gris→verde que no
//    significaba nada; ahora el verde marca solo lo que acabó en el libro y el resto es neutro.
//  · SIN "% del anterior". Un 11% suelto no dice si eso es mucho o poco; la barra ya cuenta la
//    proporción, y el pie la traduce a lenguaje humano ("1 de cada 85").
//
// El color ya no vive aquí: X pinta en dark y LinkedIn en claro, y esta función no sabe (ni le
// importa) para cuál de las dos se está dibujando — recibe la paleta ya resuelta (`CardPalette`,
// ver `exportCard.ts`) y solo decide QUÉ campo de esa paleta usa cada trazo.

import { fmtNum, type Step } from "./scan";
import { wrapLines, type CardPalette } from "./exportCard";
import type { ProposalItem, TradeAction } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** La cascada del embudo. `pie` es la lectura en una frase (ratio final, sectores más mirados). */
export function funnelCascadeSvg(pasos: Step[], palette: CardPalette, pie = ""): string {
  if (!pasos.length) return "";
  const W = 440;
  const H = 400;
  // 16px, no 14: el pie es la LECTURA del embudo y en el móvil del timeline era lo ilegible.
  const lineas = pie ? wrapLines(pie, W, 16) : [];
  const pieH = lineas.length ? lineas.length * 22 + 16 : 0;
  const util = H - pieH;

  const max = Math.max(...pasos.map((p) => p.value), 1);
  const rowH = Math.min(104, util / pasos.length);
  const top = (util - rowH * pasos.length) / 2;

  const filas = pasos
    .map((p, i) => {
      const y = top + i * rowH;
      const w = Math.max(9, Math.round((p.value / max) * W));
      // El acento es del libro: solo el último peldaño de una decisión se lo lleva.
      const fill = p.label === "en cartera" ? palette.accent : palette.neutral;
      return `<g>
    <text x="0" y="${y + 24}" font-size="18" fill="${palette.ink2}">${esc(p.label)}</text>
    <text x="${W}" y="${y + 28}" text-anchor="end" font-size="36" font-weight="700" fill="${palette.ink}">${fmtNum(p.value)}</text>
    <rect x="0" y="${y + 42}" width="${W}" height="11" rx="5.5" fill="${palette.carril}"/>
    <rect x="0" y="${y + 42}" width="${w}" height="11" rx="5.5" fill="${fill}"/>
  </g>`;
    })
    .join("\n");

  const pieSvg = lineas
    .map((l, i) => `<text x="0" y="${util + 22 + i * 22}" font-size="16" fill="${palette.ink2}">${esc(l)}</text>`)
    .join("\n");

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${filas}${pieSvg}</svg>`;
}

/** La frase que traduce el embudo: cuánto se estrecha, qué se cayó por fallo de datos y qué
 *  sectores se miraron más.
 *
 *  Las bajas por datos van aquí a propósito: "¿cuánto se pierde por fallos de datos?" es una de
 *  las preguntas del backlog, el dato ya se guarda, y publicar el embudo sin ellas contaría un
 *  filtro más limpio de lo que fue. */
export function funnelPie(pasos: Step[],
                          sectores: { sector: string; deep: number }[],
                          caidas = 0): string {
  const partes: string[] = [];
  const primero = pasos[0]?.value ?? 0;
  const ultimo = pasos[pasos.length - 1]?.value ?? 0;
  if (primero && ultimo && pasos.length > 1) {
    partes.push(`sobrevive 1 de cada ${Math.round(primero / ultimo)}`);
  }
  partes.push(caidas > 0
    ? `${fmtNum(caidas)} cayeron antes de puntuar (sin datos o informe ilegible)`
    : "ninguno se cayó por falta de datos");
  const top = sectores.filter((s) => s.deep > 0).slice(0, 3);
  if (top.length) {
    partes.push("más mirados: " + top.map((s) => `${s.sector} ${s.deep}`).join(" · "));
  }
  return partes.join(" · ");
}

const ROTATION_LABEL: Record<TradeAction, string> = {
  comprar: "nueva", ampliar: "amplía", mantener: "se mantiene",
  recortar: "recorta", vender: "sale",
};

/** El embudo es una constante estructural (el mismo hoy que en enero); lo que cambia mes a mes
 *  es ESTO. Se traduce a "X mirados · Y a fondo · Z al constructor" y se omite "en cartera": ese
 *  dato ya son las filas de arriba, repetirlo en el pie sería la misma cifra dos veces. */
function miniFunnelLine(pasos: Step[]): string {
  const etiqueta: Record<string, string> = {
    estudiados: "mirados", "a fondo": "a fondo", finalistas: "al constructor",
  };
  return pasos
    .filter((p) => p.label !== "en cartera")
    .map((p) => `${fmtNum(p.value)} ${etiqueta[p.label] ?? p.label}`)
    .join(" · ");
}

/** El panel de una DECISIÓN mensual: no el embudo (constante mes a mes) sino la rotación —
 *  qué entra, qué sale, qué se amplía, qué se mantiene. Con nombres a propósito: esta tarjeta
 *  se publica para explicar la decisión, no para enseñar el método (eso ya lo hace la del
 *  martes). El embudo no desaparece, baja a una línea de contexto al pie.
 *
 *  `items` es la propuesta completa (incluye los "vender", que son las salidas); `pasos` es la
 *  misma cascada que dibuja `funnelCascadeSvg`, reutilizada tal cual para el pie. */
export function rotationSvg(items: ProposalItem[], pasos: Step[], palette: CardPalette): string {
  const cartera = items.filter((i) => i.action !== "vender");
  const salidas = items.filter((i) => i.action === "vender");
  if (!cartera.length && !salidas.length) return "";

  const W = 440;
  const H = 400;
  const contexto = pasos.length ? miniFunnelLine(pasos) : "";
  const lineas = contexto ? wrapLines(contexto, W, 13) : [];
  const pieH = lineas.length ? lineas.length * 17 + 12 : 0;

  // La línea de salidas ENVUELVE: con cuatro ventas cabe, pero un mes de seis con símbolos
  // largos se salía del panel (el resto del texto de la tarjeta ya pasaba por `wrapLines`).
  const salidasLineas = salidas.length
    ? wrapLines(`salen: ${salidas.map((s) => s.ticker).join(" · ")}`, W, 13)
    : [];
  const HEAD_H = 60;
  const SAL_H = salidasLineas.length ? salidasLineas.length * 17 + 13 : 0;
  const util = Math.max(0, H - HEAD_H - SAL_H - pieH);
  const rowH = cartera.length ? Math.min(58, util / cartera.length) : util;
  const top = HEAD_H + Math.max(0, (util - rowH * cartera.length) / 2);

  // Cuántas de las posiciones objetivo son estreno frente al mes anterior: la cifra que se
  // entiende de un vistazo, sin tener que leer las cinco filas.
  // Un mes sin estrenos NO es un mes sin decisión: "0 nuevas de 5" se lee como si no hubiera
  // pasado nada, cuando sostener la cartera entera es justamente lo que se decidió.
  const nuevas = cartera.filter((i) => i.action === "comprar").length;
  const titular = nuevas
    ? `${nuevas} nueva${nuevas === 1 ? "" : "s"} de ${cartera.length}`
    : `las ${cartera.length} se mantienen`;
  const cabecera = `<text x="0" y="18" font-size="13" font-weight="700" letter-spacing="1.1" fill="${palette.ink2}">ROTACIÓN DE LA CARTERA</text>
    <text x="0" y="50" font-size="30" font-weight="700" fill="${palette.accent}">${esc(titular)}</text>`;

  const colorAccion = (a: TradeAction) =>
    a === "comprar" || a === "ampliar" ? palette.accent
    : a === "recortar" ? palette.bad
    : palette.ink2;

  const filas = cartera
    .map((it, i) => {
      const y = top + i * rowH;
      const linea = i < cartera.length - 1
        ? `<rect x="0" y="${(y + rowH - 1).toFixed(1)}" width="${W}" height="1" fill="${palette.carril}"/>`
        : "";
      return `<g>
    <text x="0" y="${y + 24}" font-size="19" font-weight="700" fill="${palette.ink}">${esc(it.ticker)}</text>
    <text x="0" y="${y + 41}" font-size="12.5" fill="${colorAccion(it.action)}">${esc(ROTATION_LABEL[it.action])}</text>
    <text x="${W}" y="${y + 31}" text-anchor="end" font-size="23" font-weight="700" fill="${palette.ink}">${it.target_weight_pct}%</text>
    ${linea}
  </g>`;
    })
    .join("\n");

  const salidasY = top + cartera.length * rowH + 20;
  const salidasSvg = salidasLineas
    .map((l, i) => `<text x="0" y="${salidasY + i * 17}" font-size="13" fill="${palette.bad}">${esc(l)}</text>`)
    .join("\n");

  const pieSvg = lineas
    .map((l, i) => `<text x="0" y="${H - pieH + 15 + i * 17}" font-size="13" fill="${palette.faint}">${esc(l)}</text>`)
    .join("\n");

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${cabecera}${filas}${salidasSvg}${pieSvg}</svg>`;
}
