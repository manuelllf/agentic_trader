// Exporta la curva como TARJETA lista para publicar (PNG), no como gráfica desnuda.
//
// Por qué tarjeta y no captura: cada imagen que sale de aquí acaba en X o LinkedIn, y el
// descargo legal tiene que VIAJAR DENTRO de la imagen — si va solo en el texto del post, se
// pierde en cuanto alguien reenvía la captura. Cabecera + cifras + gráfica + pie, siempre juntos.
//
// Por qué un formato por red: cada plataforma recorta a su ratio. X muestra las imágenes de
// publicación a 16:9 (1600×900) y LinkedIn a 1,91:1 (1200×627); exportar un tamaño único
// significa que una de las dos te recorta la cabecera o el pie — justo lo que no puede faltar.
//
// Por qué sin librerías: el gráfico YA es SVG, así que se clona del DOM, se compone dentro de
// una tarjeta SVG del tamaño exacto de destino y se rasteriza con canvas. html2canvas
// re-dibujaría el DOM (y sale borroso); esto mantiene el vector hasta el último momento.

export interface CardStat {
  label: string;
  value: string;
  color?: string;
}

/** Formatos de publicación. El PNG sale ya al tamaño que la red espera, sin recorte. */
export const CARD_PRESETS = {
  x: { w: 1600, h: 900, label: "X", nota: "16:9" },
  linkedin: { w: 1200, h: 627, label: "LinkedIn", nota: "1,91:1" },
} as const;

export type PresetKey = keyof typeof CARD_PRESETS;

export interface CardOptions {
  /** El <svg> del gráfico ya renderizado. Se clona: el original no se toca. */
  svg: SVGSVGElement;
  preset: PresetKey;
  title: string;
  subtitle: string;
  stats: CardStat[];
  footer: string;
  /** Nombre del fichero, sin extensión ni sufijo de red. */
  filename: string;
}

const BASE_W = 1200;   // ancho de referencia del diseño; todo escala con `w / BASE_W`
const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Compone la tarjeta en SVG (string) al tamaño exacto del formato elegido. */
function buildCardSvg(o: CardOptions): { markup: string; w: number; h: number } {
  const { w, h } = CARD_PRESETS[o.preset];
  const s = w / BASE_W;                      // factor de escala tipográfica y de márgenes
  const pad = Math.round(44 * s);

  const clone = o.svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  clone.removeAttribute("height");
  // Ocupa la caja disponible SIN deformarse: el viewBox del gráfico manda el ratio.
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const chart = new XMLSerializer().serializeToString(clone);

  const headH = Math.round(132 * s);
  const footH = Math.round(58 * s);
  const chartY = headH;
  const chartH = h - headH - footH;

  let x = pad;
  const statsMarkup = o.stats
    .map((st) => {
      const g = `<g transform="translate(${x},${Math.round(78 * s)})">
        <text font-size="${(13 * s).toFixed(1)}" fill="#94a3b8" font-weight="600" letter-spacing="${(0.6 * s).toFixed(2)}">${esc(st.label)}</text>
        <text y="${(30 * s).toFixed(1)}" font-size="${(29 * s).toFixed(1)}" font-weight="700" fill="${st.color ?? "#0f172a"}">${esc(st.value)}</text>
      </g>`;
      x += Math.round(Math.max(180, st.value.length * 19 + 96) * s);
      return g;
    })
    .join("");

  return {
    w, h,
    markup: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family='${FONT}'>
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <text x="${pad}" y="${(44 * s).toFixed(0)}" font-size="${(25 * s).toFixed(1)}" font-weight="700" fill="#0f172a">${esc(o.title)}</text>
  <text x="${pad}" y="${(68 * s).toFixed(0)}" font-size="${(16 * s).toFixed(1)}" fill="#64748b">${esc(o.subtitle)}</text>
  ${statsMarkup}
  <svg x="${pad}" y="${chartY}" width="${w - pad * 2}" height="${chartH}" overflow="visible">${chart}</svg>
  <line x1="${pad}" y1="${h - footH + Math.round(14 * s)}" x2="${w - pad}" y2="${h - footH + Math.round(14 * s)}" stroke="#e2e8f0" stroke-width="${Math.max(1, s).toFixed(1)}"/>
  <text x="${pad}" y="${h - Math.round(20 * s)}" font-size="${(14 * s).toFixed(1)}" fill="#94a3b8">${esc(o.footer)}</text>
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
