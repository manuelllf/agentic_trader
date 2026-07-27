// Exporta una vista como TARJETA lista para publicar (PNG), no como captura.
//
// Por qué tarjeta y no captura: cada imagen que sale de aquí acaba en X o LinkedIn, y el
// descargo legal tiene que VIAJAR DENTRO de la imagen — si va solo en el texto del post, se
// pierde en cuanto alguien reenvía la captura. Cabecera + contenido + pie, siempre juntos.
//
// Por qué un formato por red: cada plataforma recorta a su ratio. X muestra las imágenes de
// publicación a 16:9 (1600×900) y LinkedIn a 1,91:1 (1200×627); exportar un tamaño único
// significa que una de las dos te recorta la cabecera o el pie — justo lo que no puede faltar.
//
// Por qué sin librerías: el contenido YA es SVG, así que se compone dentro de una tarjeta SVG
// del tamaño exacto de destino y se rasteriza con canvas. html2canvas re-dibujaría el DOM (y
// sale borroso); esto mantiene el vector hasta el último momento.
//
// El marco imita el lenguaje visual de la web: fondo slate, paneles blancos redondeados con
// sombra suave, el logo de la app, píldoras de contexto y el pie centrado. Todo se dibuja en
// unidades de diseño de 1200 de ancho y se escala de golpe con un `<g transform="scale()">`,
// así el código se lee como una maqueta y no como una lista de multiplicaciones.

export type BadgeTone = "neutral" | "green" | "amber";

export interface CardBadge {
  text: string;
  tone?: BadgeTone;
}

export interface CardStat {
  label: string;
  value: string;
  color?: string;
}

export interface CardPanel {
  /** Rótulo en versalitas de la esquina del panel. */
  label?: string;
  /** Apostilla gris junto al rótulo (contexto que no merece píldora). */
  note?: string;
  /** Cifras grandes dentro del panel, sobre el cuerpo. */
  stats?: CardStat[];
  /** El <svg> ya renderizado en pantalla (se clona) o markup SVG con su propio viewBox. */
  body?: SVGSVGElement | string;
  /** Reparto del ancho entre paneles (por defecto, a partes iguales). */
  weight?: number;
}

/** Formatos de publicación. El PNG sale ya al tamaño que la red espera, sin recorte. */
export const CARD_PRESETS = {
  x: { w: 1600, h: 900, label: "X", nota: "16:9" },
  linkedin: { w: 1200, h: 627, label: "LinkedIn", nota: "1,91:1" },
} as const;

export type PresetKey = keyof typeof CARD_PRESETS;

export interface CardOptions {
  preset: PresetKey;
  title: string;
  subtitle: string;
  badges?: CardBadge[];
  panels: CardPanel[];
  footer: string;
  /** Nombre del fichero, sin extensión ni sufijo de red. */
  filename: string;
}

const BASE_W = 1200;   // lienzo de diseño; el preset solo cambia la escala y el alto útil
const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const PAD = 44;        // margen de la tarjeta
const HEAD_H = 78;     // banda de cabecera (logo + título + píldoras)
const FOOT_H = 52;     // banda del pie legal (holgada: si roza el panel, se lee como error)
const GAP = 20;        // separación entre paneles
const IN = 26;         // padding interno de cada panel

const TONE: Record<BadgeTone, { bg: string; border: string; fg: string }> = {
  neutral: { bg: "#ffffff", border: "#e2e8f0", fg: "#64748b" },
  green: { bg: "#ecfdf5", border: "#a7f3d0", fg: "#047857" },
  amber: { bg: "#fffbeb", border: "#fde68a", fg: "#b45309" },
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Ancho aproximado de un texto. Basta para colocar píldoras y cifras: no hay que medir bien,
 *  hay que no solaparse. */
const textW = (s: string, size: number) => s.length * size * 0.54;

/** Recorta un texto al ancho disponible. Sin esto una apostilla larga se sale del panel y la
 *  tarjeta —que es la imagen que se publica— sale rota. */
function fit(s: string, maxW: number, size: number): string {
  const max = Math.floor(maxW / (size * 0.54));
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

/** Parte un texto en líneas que caben en `maxW`. Aproximado a posta: sobra para prosa. */
export function wrapLines(text: string, maxW: number, size: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of text.split(/\s+/)) {
    const cand = actual ? `${actual} ${palabra}` : palabra;
    if (textW(cand, size) > maxW && actual) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = cand;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/** Una cita larga (la tesis del modelo) con filete verde, encajada en la caja disponible.
 *  El cuerpo se encoge hasta que cabe ENTERA: recortar la tesis sería vender como "íntegra"
 *  algo que no lo es. */
export function quoteSvg(text: string, W = 560, H = 400): string {
  let size = 19;
  let lineas = wrapLines(text, W - 30, size);
  while (size > 12 && lineas.length * (size * 1.55) > H) {
    size -= 1;
    lineas = wrapLines(text, W - 30, size);
  }
  const lh = size * 1.55;
  const alto = lineas.length * lh;
  const top = Math.max(0, (H - alto) / 2);
  const tspans = lineas
    .map((l, i) => `<tspan x="26" y="${(top + (i + 0.85) * lh).toFixed(1)}">${esc(l)}</tspan>`)
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="${top.toFixed(1)}" width="3" height="${alto.toFixed(1)}" rx="1.5" fill="#10b981"/>
    <text font-size="${size}" font-style="italic" fill="#334155">${tspans}</text>
  </svg>`;
}

/** El logo de la app, tal cual está en `components/Logo.tsx` (misma marca que la web). */
function logoSvg(x: number, y: number, size: number): string {
  const k = size / 96;
  return `<g transform="translate(${x},${y}) scale(${k.toFixed(4)})">
    <circle cx="48" cy="48" r="46" fill="#059669"/>
    <g fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" transform="translate(48,48)">
      <path d="M-28 16 L-9 -3 L3 9 L25 -13"/>
      <path d="M15 -13 L28 -13 L28 0"/>
    </g>
  </g>`;
}

/** Píldoras de contexto, alineadas a la derecha y en el orden dado. */
function badgesSvg(badges: CardBadge[], right: number, cy: number): string {
  const h = 34;
  const fs = 14;
  const sizes = badges.map((b) => Math.round(textW(b.text, fs) + 34));
  let x = right - sizes.reduce((a, b) => a + b, 0) - (badges.length - 1) * 10;
  return badges
    .map((b, i) => {
      const w = sizes[i];
      const t = TONE[b.tone ?? "neutral"];
      const g = `<g>
    <rect x="${x}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.bg}" stroke="${t.border}"/>
    <text x="${x + w / 2}" y="${cy + 5}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${t.fg}">${esc(b.text)}</text>
  </g>`;
      x += w + 10;
      return g;
    })
    .join("\n");
}

function bodyMarkup(body: SVGSVGElement | string): string {
  if (typeof body === "string") return body;
  const clone = body.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  clone.removeAttribute("height");
  // Ocupa la caja disponible SIN deformarse: el viewBox del contenido manda el ratio.
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return new XMLSerializer().serializeToString(clone);
}

function panelSvg(p: CardPanel, x: number, y: number, w: number, h: number): string {
  let cursor = y + IN;
  const partes: string[] = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="#ffffff" stroke="#eef2f7" filter="url(#sombra)"/>`,
  ];

  if (p.label) {
    cursor += 12;
    partes.push(
      `<text x="${x + IN}" y="${cursor}" font-size="12.5" font-weight="700" letter-spacing="1.3" fill="#94a3b8">${esc(p.label)}</text>`,
    );
    if (p.note) {
      const nx = x + IN + textW(p.label, 12.5) + 1.3 * p.label.length + 14;
      partes.push(
        `<text x="${nx}" y="${cursor}" font-size="12.5" fill="#cbd5e1">${esc(fit(p.note, x + w - IN - nx, 12.5))}</text>`,
      );
    }
    cursor += 14;
  }

  if (p.stats?.length) {
    cursor += 26;
    let sx = x + IN;
    for (const st of p.stats) {
      partes.push(`<g transform="translate(${sx},${cursor})">
    <text font-size="12.5" font-weight="600" letter-spacing="0.7" fill="#94a3b8">${esc(st.label)}</text>
    <text y="34" font-size="34" font-weight="700" fill="${st.color ?? "#0f172a"}">${esc(st.value)}</text>
  </g>`);
      sx += Math.max(150, textW(st.value, 34) + 46);
    }
    cursor += 48;
  }

  if (p.body) {
    const by = cursor + 8;
    partes.push(
      `<svg x="${x + IN}" y="${by}" width="${w - IN * 2}" height="${Math.max(40, y + h - IN - by)}" overflow="visible">${bodyMarkup(p.body)}</svg>`,
    );
  }
  return partes.join("\n  ");
}

/** Compone la tarjeta en SVG (string) al tamaño exacto del formato elegido. */
function buildCardSvg(o: CardOptions): { markup: string; w: number; h: number } {
  const { w, h } = CARD_PRESETS[o.preset];
  const s = w / BASE_W;          // toda la maqueta se escribe a 1200 y se escala de una vez
  const DW = BASE_W;
  const DH = h / s;

  const panelsY = PAD + HEAD_H;
  const panelsH = DH - panelsY - FOOT_H - 8;
  const pesos = o.panels.map((p) => p.weight ?? 1);
  const total = pesos.reduce((a, b) => a + b, 0);
  const libre = DW - PAD * 2 - GAP * (o.panels.length - 1);

  let px = PAD;
  const panels = o.panels
    .map((p, i) => {
      const pw = Math.round((pesos[i] / total) * libre);
      const g = panelSvg(p, px, panelsY, pw, panelsH);
      px += pw + GAP;
      return g;
    })
    .join("\n  ");

  return {
    w, h,
    markup: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family='${FONT}'>
  <defs>
    <linearGradient id="fondo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbfcfe"/><stop offset="1" stop-color="#eef2f7"/>
    </linearGradient>
    <filter id="sombra" x="-8%" y="-8%" width="116%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="7" flood-color="#0f172a" flood-opacity="0.05"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#fondo)"/>
  <g transform="scale(${s})">
  ${logoSvg(PAD, PAD - 2, 50)}
  <text x="${PAD + 66}" y="${PAD + 20}" font-size="27" font-weight="700" fill="#0f172a">${esc(o.title)}</text>
  <text x="${PAD + 66}" y="${PAD + 42}" font-size="14" fill="#94a3b8">${esc(o.subtitle)}</text>
  ${o.badges?.length ? badgesSvg(o.badges, DW - PAD, PAD + 24) : ""}
  ${panels}
  <text x="${DW / 2}" y="${DH - 26}" text-anchor="middle" font-size="13.5" fill="#94a3b8">${esc(o.footer)}</text>
  </g>
</svg>`,
  };
}

/** Compone la tarjeta y dispara la descarga del PNG. Lanza si el navegador no puede rasterizar. */
export async function downloadChartCard(o: CardOptions): Promise<void> {
  const { markup, w, h } = buildCardSvg(o);
  // Data-URI en base64 (no encodeURIComponent): el markup lleva comillas y '#' de los colores,
  // que rompen la URI sin escapar. `unescape(encodeURIComponent(...))` mete el UTF-8 en btoa,
  // que solo admite latin-1 — sin eso, los acentos del pie revientan la codificación.
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("No se pudo componer la imagen."));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = w;                       // ya es el tamaño nativo que pide la red
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no permite exportar la imagen.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("El navegador no permite exportar la imagen.");

  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${o.filename}-${o.preset}.png`;
  a.click();
  URL.revokeObjectURL(href);
}
