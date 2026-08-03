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
export interface Step {
  label: string;
  value: number;
  /** % sobre el peldaño anterior; null en el primero. */
  pctOfPrev: number | null;
  hint: string;
}

/** La cascada del embudo: de todo el universo estudiado a los que acaban en cartera.
 *  Prefiere la traza de auditoría (`scan`) y cae al informe si aún no hay traza. */
export function cascada(report: ScanReport | null, scan: FunnelScan | null): Step[] {
  const pre = scan?.pre ?? report?.prescored ?? 0;
  const deep = scan?.deep ?? report?.deep ?? 0;
  const sel = scan?.sel ?? 0;
  const funded = scan?.funded ?? 0;
  if (!pre) return [];

  const raw: [string, number, string][] = [
    ["estudiados", pre, "puntuados por el modelo rápido"],
    ["a fondo", deep, "informe completo del modelo razonador"],
    ["finalistas", sel, "los mejores por score, al constructor"],
    ["en cartera", funded, "con peso asignado"],
  ];
  // Un observatorio no decide cartera: sus dos últimos peldaños son 0 y sobran (enseñar
  // "0 en cartera" haría pensar que algo falló, cuando es que ese escaneo no tocaba decidir).
  const steps = raw.filter(([, v], i) => i < 2 || v > 0);
  return steps.map(([label, value, hint], i) => ({
    label, value, hint,
    pctOfPrev: i === 0 || !steps[i - 1][1] ? null : (value / steps[i - 1][1]) * 100,
  }));
}

/** Cómo describir la procedencia del universo en una línea. `tone` guía el color. */
export function universoLinea(report: ScanReport | null):
    { texto: string; detalle: string; tone: "ok" | "warn" } | null {
  const u = report?.universe;
  if (!u) return null;
  if (u.fuente === "seed") {
    return { texto: `${fmtNum(u.size)} nombres de emergencia`,
             detalle: "NASDAQ no respondió y no había foto del cierre", tone: "warn" };
  }
  if (u.fuente === "vivo") {
    return { texto: `${fmtNum(u.size)} nombres, tomados en vivo`,
             detalle: "sin foto del cierre: con el mercado abierto el universo sale recortado",
             tone: "warn" };
  }
  const dias = u.dias ?? 0;
  const cuando = dias <= 0 ? "foto del último cierre"
    : dias === 1 ? "foto de ayer" : `foto de hace ${dias} días`;
  const sobra = u.sobre_suelo && u.sobre_suelo > u.size
    ? ` · ${fmtNum(u.sobre_suelo)} pasaban el suelo de liquidez, se escanean los de más volumen`
    : "";
  return { texto: `${fmtNum(u.size)} nombres`, detalle: cuando + sobra,
           tone: dias > 4 ? "warn" : "ok" };
}

/** Sectores ordenados por presencia, con los que llegaron a fondo primero en caso de empate. */
export function sectoresTop(scan: FunnelScan | null, n = 6) {
  if (!scan?.sectores?.length) return [];
  return [...scan.sectores].sort((a, b) => b.deep - a.deep || b.pre - a.pre).slice(0, n);
}

export const fmtScanCost = (c: ScanReport["cost"]) =>
  c ? `$${c.cost_usd.toFixed(2)} · ${c.calls.toLocaleString("es-ES")} llamadas` : null;

export const fmtNum = (n: number) => n.toLocaleString("es-ES");
