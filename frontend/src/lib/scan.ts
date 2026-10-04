import { localeTag, type Locale } from "../i18n/locale";
// Modelado del embudo del escaneo, SIN pintar nada.
//
// Las dos salas enseñan lo mismo con lenguajes visuales opuestos (sombra clara, real oscura),
// así que lo que se comparte es el CÁLCULO, no el componente: aquí se decide qué números
// cuenta el panel y cómo se llaman; cada sala los dibuja a su manera.

import type { ScanReport } from "./api";

/** Un escaneo visto desde la traza de auditoría (agregado; el detalle solo llega con sesión). */
export interface FunnelScan {
  at: string;
  pre: number;
  deep: number;
  sel: number;
  funded: number;
  sin_datos: number;
  prescore_error: number;
  /** Finalistas cuyo informe profundo no parseó: llegaron al profundo y fallaron AHÍ. */
  deep_error: number;
  sectores: { sector: string; pre: number; deep: number; sel: number; funded: number }[];
  nombres?: {
    ticker: string; sector: string; prescore: number | null; deep_score: number | null;
    stage: string; price: number | null; weight_pct: number | null;
  }[];
}

/** Un peldaño de la cascada: cuántos nombres sobrevivieron y qué proporción del anterior. */
export type ScanText = {
  t: (key: string, values?: Record<string, string | number>) => string;
  prefix: "alpha" | "beta"; locale: Locale;
};

export interface Step {
  id: "estudiados" | "a_fondo" | "finalistas" | "en_cartera";
  label: string;
  value: number;
  /** % sobre el peldaño anterior; null en el primero. */
  pctOfPrev: number | null;
  hint: string;
}

/** La cascada del embudo: de todo el universo estudiado a los que acaban en cartera.
 *  Prefiere la traza de auditoría (`scan`) y cae al informe si aún no hay traza. */
export function cascada(report: ScanReport | null, scan: FunnelScan | null, text: ScanText): Step[] {
  const pre = scan?.pre ?? report?.prescored ?? 0;
  const deep = scan?.deep ?? report?.deep ?? 0;
  const sel = scan?.sel ?? 0;
  const funded = scan?.funded ?? 0;
  if (!pre) return [];

  const raw: [Step["id"], number, string][] = [
    ["estudiados", pre, "estudiados_ayuda"],
    ["a_fondo", deep, "a_fondo_ayuda"],
    ["finalistas", sel, "finalistas_ayuda"],
    ["en_cartera", funded, "en_cartera_ayuda"],
  ];
  // Un observatorio no decide cartera: sus dos últimos peldaños son 0 y sobran (enseñar
  // "0 en cartera" haría pensar que algo falló, cuando es que ese escaneo no tocaba decidir).
  const steps = raw.filter(([, v], i) => i < 2 || v > 0);
  return steps.map(([id, value, hint], i) => ({
    id, label: text.t(`${text.prefix}_scan_${id}`), value, hint: text.t(`${text.prefix}_scan_${hint}`),
    pctOfPrev: i === 0 || !steps[i - 1][1] ? null : (value / steps[i - 1][1]) * 100,
  }));
}

/** Cómo describir la procedencia del universo en una línea. `tone` guía el color. */
export function universoLinea(report: ScanReport | null, text: ScanText):
    { texto: string; detalle: string; tone: "ok" | "warn" } | null {
  const u = report?.universe;
  if (!u) return null;
  const t = (key: string, values?: Record<string, string | number>) => text.t(`${text.prefix}_scan_${key}`, values);
  const count = fmtNum(u.size, text.locale);
  if (u.fuente === "seed") return { texto: t("emergencia", { count }), detalle: t("emergencia_ayuda"), tone: "warn" };
  if (u.fuente === "vivo") return { texto: t("vivo", { count }), detalle: t("vivo_ayuda"), tone: "warn" };
  const dias = u.dias ?? 0;
  const cuando = dias <= 0 ? t("ultimo_cierre") : dias === 1 ? t("ayer") : t("dias", { count: dias });
  const sobra = u.sobre_suelo && u.sobre_suelo > u.size
    ? t("suelo", { count: fmtNum(u.sobre_suelo, text.locale) }) : "";
  return { texto: t("nombres", { count }), detalle: cuando + sobra, tone: dias > 4 ? "warn" : "ok" };
}

/** Sectores ordenados por presencia, con los que llegaron a fondo primero en caso de empate. */
export function sectoresTop(scan: FunnelScan | null, n = 6) {
  if (!scan?.sectores?.length) return [];
  return [...scan.sectores].sort((a, b) => b.deep - a.deep || b.pre - a.pre).slice(0, n);
}

export const fmtScanCost = (c: ScanReport["cost"], text: ScanText) =>
  c ? text.t(`${text.prefix}_scan_coste`, {
    cost: c.cost_usd.toLocaleString(localeTag(text.locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    count: c.calls,
  }) : null;

export const fmtNum = (n: number, locale: Locale = "es") => n.toLocaleString(localeTag(locale));
