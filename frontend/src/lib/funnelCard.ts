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

import { fmtNum, type Step } from "./scan";
import { wrapLines } from "./exportCard";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CARRIL = "#f1f5f9";
const NEUTRO = "#cbd5e1";
const ACENTO = "#059669";

/** La cascada del embudo. `pie` es la lectura en una frase (ratio final, sectores más mirados). */
export function funnelCascadeSvg(pasos: Step[], pie = ""): string {
  if (!pasos.length) return "";
  const W = 440;
  const H = 400;
  const lineas = pie ? wrapLines(pie, W, 14) : [];
  const pieH = lineas.length ? lineas.length * 20 + 16 : 0;
  const util = H - pieH;

  const max = Math.max(...pasos.map((p) => p.value), 1);
  const rowH = Math.min(104, util / pasos.length);
  const top = (util - rowH * pasos.length) / 2;

  const filas = pasos
    .map((p, i) => {
      const y = top + i * rowH;
      const w = Math.max(9, Math.round((p.value / max) * W));
      // El verde es del libro: solo el último peldaño de una decisión se lo lleva.
      const fill = p.label === "en cartera" ? ACENTO : NEUTRO;
      return `<g>
    <text x="0" y="${y + 24}" font-size="18" fill="#64748b">${esc(p.label)}</text>
    <text x="${W}" y="${y + 28}" text-anchor="end" font-size="36" font-weight="700" fill="#0f172a">${fmtNum(p.value)}</text>
    <rect x="0" y="${y + 42}" width="${W}" height="11" rx="5.5" fill="${CARRIL}"/>
    <rect x="0" y="${y + 42}" width="${w}" height="11" rx="5.5" fill="${fill}"/>
  </g>`;
    })
    .join("\n");

  const pieSvg = lineas
    .map((l, i) => `<text x="0" y="${util + 22 + i * 20}" font-size="14" fill="#94a3b8">${esc(l)}</text>`)
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
