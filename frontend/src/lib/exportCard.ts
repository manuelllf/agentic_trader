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
// Por qué un tema por red, no solo un formato: X en 2026-2027 se lee en dark casi siempre, y una
// tarjeta clara ahí desentona como una captura de otra época; LinkedIn sigue siendo mayormente
// claro. Así que el mismo layout se pinta con DOS paletas (`CARD_THEMES`), una por preset — el
// dark lleva acento esmeralda + un segundo acento cian para la referencia (el S&P), con
// contención: dos acentos, nunca arcoíris. Todo color que antes vivía suelto en el SVG (fondo,
// panel, texto, píldora, pie, filete de cita) sale de esta paleta para que ningún fichero tenga
// que saber si está pintando para X o para LinkedIn — solo recibe la paleta ya resuelta.
//
// Por qué sin librerías: el contenido YA es SVG, así que se compone dentro de una tarjeta SVG
// del tamaño exacto de destino y se rasteriza con canvas. html2canvas re-dibujaría el DOM (y
// sale borroso); esto mantiene el vector hasta el último momento.
//
// El marco imita el lenguaje visual de la web: fondo degradado, paneles redondeados con sombra
// (o glow, en dark) suave, el logo de la app, píldoras de contexto y el pie centrado. Todo se
// dibuja en unidades de diseño de 1200 de ancho y se escala de golpe con un `<g transform="scale()">`,
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
  /** Un escalón por debajo del stat principal (la referencia: S&P, alpha…). En una tarjeta
   *  el titular es siempre lo que lleva la cartera; la comparación acompaña, no compite. */
  secondary?: boolean;
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

/** Todo lo que un color puede necesitar en una tarjeta: fondo, panel, texto en tres pesos,
 *  dos acentos (el segundo SOLO para la referencia — S&P, índice — nunca para un tercer tema),
 *  neutro/carril para lo que no protagoniza y negativo para retornos en rojo. Un fichero que
 *  dibuja una tarjeta nunca decide el color: recibe la paleta ya resuelta y la usa. */
export interface CardPalette {
  bgFrom: string;
  bgTo: string;
  panelFill: string;
  panelBorder: string;
  /** Sombra (claro) o glow (dark): color, opacidad y geometría del `feDropShadow`. */
  shadowColor: string;
  shadowOpacity: number;
  shadowDy: number;
  shadowBlur: number;
  ink: string;        // texto principal: título, cifras grandes
  ink2: string;        // texto secundario: subtítulo, rótulos, ejes, pie
  faint: string;       // apostillas de contexto (un peso menos que ink2)
  quoteText: string;   // el cuerpo de una cita larga (la tesis) — más peso que ink2, menos que ink
  accent: string;       // acento primario: lo que "gana" (cartera, en cartera, positivo)
  accent2: string;      // acento secundario: la referencia (S&P 500 / índice), nunca un tercer tono
  neutral: string;      // barras/puntos sin protagonismo
  carril: string;       // fondo de una barra de progreso
  bad: string;          // retorno negativo / alerta
  badge: Record<BadgeTone, { bg: string; border: string; fg: string }>;
}

export const CARD_THEMES: Record<"dark" | "light", CardPalette> = {
  // LinkedIn: el diseño de siempre, solo movido a la paleta — misma retícula que el dark.
  light: {
    bgFrom: "#fbfcfe", bgTo: "#eef2f7",
    panelFill: "#ffffff", panelBorder: "#eef2f7",
    shadowColor: "#0f172a", shadowOpacity: 0.05, shadowDy: 3, shadowBlur: 7,
    ink: "#0f172a", ink2: "#94a3b8", faint: "#cbd5e1", quoteText: "#334155",
    accent: "#059669", accent2: "#475569", neutral: "#cbd5e1", carril: "#f1f5f9",
    bad: "#e11d48",
    badge: {
      neutral: { bg: "#ffffff", border: "#e2e8f0", fg: "#64748b" },
      green: { bg: "#ecfdf5", border: "#a7f3d0", fg: "#047857" },
      amber: { bg: "#fffbeb", border: "#fde68a", fg: "#b45309" },
    },
  },
  // X: slate muy profundo + neón con contención (esmeralda + cian, dos acentos y ya).
  dark: {
    bgFrom: "#0b1220", bgTo: "#131c2e",
    panelFill: "#0f172a", panelBorder: "rgba(148,163,184,0.15)",
    // Glow, no sombra: flood-color del acento a baja opacidad y sin desplazamiento (dy 0) — una
    // sombra negra sobre fondo ya oscuro no se vería, y sin ella el panel flotaría sin peso.
    shadowColor: "#10b981", shadowOpacity: 0.22, shadowDy: 0, shadowBlur: 16,
    ink: "#f1f5f9", ink2: "#94a3b8", faint: "#64748b", quoteText: "#cbd5e1",
    accent: "#10b981", accent2: "#22d3ee", neutral: "#475569", carril: "rgba(148,163,184,0.12)",
    bad: "#fb7185",
    badge: {
      neutral: { bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.28)", fg: "#cbd5e1" },
      green: { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.4)", fg: "#34d399" },
      amber: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.4)", fg: "#fbbf24" },
    },
  },
};

/** Qué tema lleva cada red. X vive en dark casi siempre en 2026-2027; LinkedIn sigue en claro. */
export const themeForPreset = (preset: PresetKey): keyof typeof CARD_THEMES =>
  preset === "x" ? "dark" : "light";

const BASE_W = 1200;   // lienzo de diseño; el preset solo cambia la escala y el alto útil
const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const PAD = 44;        // margen de la tarjeta
const HEAD_H = 78;     // banda de cabecera (logo + título + píldoras)
const FOOT_H = 52;     // banda del pie legal (holgada: si roza el panel, se lee como error)
const GAP = 20;        // separación entre paneles
const IN = 26;         // padding interno de cada panel

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

/** Una cita larga (la tesis del modelo) con filete del acento, encajada en la caja disponible.
 *  El cuerpo se encoge hasta que cabe ENTERA: recortar la tesis sería vender como "íntegra"
 *  algo que no lo es. Arranca grande y no baja de 14: la tarjeta se lee EN EL MÓVIL del
 *  timeline, no en un monitor — con 19/12 la tesis salía ilegible. */
export function quoteSvg(text: string, palette: CardPalette, W = 560, H = 400): string {
  let size = 24;
  let lineas = wrapLines(text, W - 30, size);
  while (size > 14 && lineas.length * (size * 1.55) > H) {
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
    <rect x="0" y="${top.toFixed(1)}" width="3" height="${alto.toFixed(1)}" rx="1.5" fill="${palette.accent}"/>
    <text font-size="${size}" font-style="italic" fill="${palette.quoteText}">${tspans}</text>
  </svg>`;
}

/** El logo de la app, tal cual está en `components/Logo.tsx` (misma marca que la web). La marca
 *  no cambia con el tema: es el mismo círculo verde en dark y en claro, como en el resto de la web. */
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
function badgesSvg(badges: CardBadge[], right: number, cy: number, palette: CardPalette): string {
  const h = 38;
  const fs = 15.5;
  const sizes = badges.map((b) => Math.round(textW(b.text, fs) + 34));
  let x = right - sizes.reduce((a, b) => a + b, 0) - (badges.length - 1) * 10;
  return badges
    .map((b, i) => {
      const w = sizes[i];
      const t = palette.badge[b.tone ?? "neutral"];
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

function panelSvg(p: CardPanel, x: number, y: number, w: number, h: number, palette: CardPalette): string {
  let cursor = y + IN;
  const partes: string[] = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="${palette.panelFill}" stroke="${palette.panelBorder}" filter="url(#sombra)"/>`,
  ];

  if (p.label) {
    cursor += 13;
    partes.push(
      `<text x="${x + IN}" y="${cursor}" font-size="14" font-weight="700" letter-spacing="1.3" fill="${palette.ink2}">${esc(p.label)}</text>`,
    );
    if (p.note) {
      // La nota se parte en una SEGUNDA línea (ancho completo del panel) antes que recortarse:
      // truncar una apostilla que da contexto deja la tarjeta diciendo menos de lo que debía.
      const nx = x + IN + textW(p.label, 14) + 1.3 * p.label.length + 14;
      const lineas = wrapLines(p.note, x + w - IN - nx, 14);
      partes.push(
        `<text x="${nx}" y="${cursor}" font-size="14" fill="${palette.faint}">${esc(lineas[0] ?? "")}</text>`,
      );
      if (lineas.length > 1) {
        cursor += 19;
        partes.push(
          `<text x="${x + IN}" y="${cursor}" font-size="14" fill="${palette.faint}">${esc(fit(lineas.slice(1).join(" "), w - IN * 2, 14))}</text>`,
        );
      }
    }
    cursor += 15;
  }

  if (p.stats?.length) {
    cursor += 28;
    let sx = x + IN;
    for (const st of p.stats) {
      // Los secundarios (S&P, alpha) van un cuerpo por debajo y alineados a la MISMA base
      // que el principal: se leen como contexto del titular, no como tres titulares iguales.
      const fs = st.secondary ? 25 : 36;
      partes.push(`<g transform="translate(${sx},${cursor})">
    <text font-size="${st.secondary ? 12.5 : 14}" font-weight="600" letter-spacing="0.7" fill="${palette.ink2}">${esc(st.label)}</text>
    <text y="36" font-size="${fs}" font-weight="700" fill="${st.color ?? palette.ink}">${esc(st.value)}</text>
  </g>`);
      sx += Math.max(st.secondary ? 120 : 160, textW(st.value, fs) + (st.secondary ? 36 : 48));
    }
    cursor += 52;
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
  const palette = CARD_THEMES[themeForPreset(o.preset)];
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
      const g = panelSvg(p, px, panelsY, pw, panelsH, palette);
      px += pw + GAP;
      return g;
    })
    .join("\n  ");

  return {
    w, h,
    markup: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family='${FONT}'>
  <defs>
    <linearGradient id="fondo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.bgFrom}"/><stop offset="1" stop-color="${palette.bgTo}"/>
    </linearGradient>
    <filter id="sombra" x="-8%" y="-8%" width="116%" height="120%">
      <feDropShadow dx="0" dy="${palette.shadowDy}" stdDeviation="${palette.shadowBlur}" flood-color="${palette.shadowColor}" flood-opacity="${palette.shadowOpacity}"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#fondo)"/>
  <g transform="scale(${s})">
  ${logoSvg(PAD, PAD - 2, 50)}
  <text x="${PAD + 66}" y="${PAD + 21}" font-size="30" font-weight="700" fill="${palette.ink}">${esc(o.title)}</text>
  <text x="${PAD + 66}" y="${PAD + 44}" font-size="16" fill="${palette.ink2}">${esc(o.subtitle)}</text>
  ${o.badges?.length ? badgesSvg(o.badges, DW - PAD, PAD + 24, palette) : ""}
  ${panels}
  <text x="${DW / 2}" y="${DH - 24}" text-anchor="middle" font-size="16" fill="${palette.ink2}">${esc(o.footer)}</text>
  </g>
</svg>`,
  };
}

/** Compone la tarjeta y dispara la descarga del PNG. Lanza si el navegador no puede rasterizar. */
export async function downloadChartCard(o: CardOptions): Promise<void> {
  const { markup, w, h } = buildCardSvg(o);
  const palette = CARD_THEMES[themeForPreset(o.preset)];
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
  // Relleno de respaldo del tema (no blanco fijo): si el rasterizado deja algún borde sin cubrir
  // por redondeo, que asome el fondo de SU tarjeta y no un destello claro en una tarjeta dark.
  ctx.fillStyle = palette.bgTo;
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
