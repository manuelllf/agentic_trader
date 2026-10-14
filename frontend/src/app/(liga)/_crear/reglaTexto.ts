import type { ReglaCatalogo, ReglaElegida } from "@/lib/liga/api";
import { signo } from "@/lib/liga/format";
import type { Locale } from "@/i18n/locale";

// Reglas cuyo único parámetro es un techo; el resto pide un mínimo.
export const MAXIMOS = new Set(["barata", "pb", "ev_ebitda", "deuda", "deuda_pn", "payout", "beta", "cortos"]);
export const PORCENTAJES = new Set(["fcf", "rentables", "roa", "margen", "margen_neto", "crecen", "deuda_pn",
  "dividendo", "payout", "castigadas_pct", "fuerza_sp", "directivos", "cortos"]);

type Traducir = (clave: string, valores?: Record<string, string>) => string;

function cifra(valor: number, locale: Locale): string {
  const decimales = Number.isInteger(valor) ? 0 : Number.isInteger(valor * 10) ? 1 : 2;
  return signo(valor, decimales, locale).replace(/^\+/, "");
}

/** El valor elegido en palabras cortas: «mín. 15 %», «máx. 25», «300–2.000 M$» o los sectores. */
export function valorRegla(def: ReglaCatalogo, regla: ReglaElegida, sectores: Record<string, string>,
  t: Traducir, locale: Locale = "es"): string {
  const valor = (nombre: string) => regla.params[nombre] ?? def.parametros.find(p => p.nombre === nombre)?.defecto;
  if (regla.clave === "tamano") {
    const p = def.parametros.find(x => x.nombre === "hasta");
    const desde = Number(valor("desde")), hasta = Number(valor("hasta"));
    const tope = p?.valores?.at(-1) ?? p?.maximo ?? Infinity;
    const suelo = def.parametros.find(x => x.nombre === "desde")?.valores?.[0] ?? 0;
    if (hasta >= tope) return t("builder_regla_minimo", { valor: `${cifra(desde, locale)} M$` });
    if (desde <= suelo) return t("builder_regla_maximo", { valor: `${cifra(hasta, locale)} M$` });
    return t("builder_regla_rango", { desde: cifra(desde, locale), hasta: cifra(hasta, locale) });
  }
  const partes = def.parametros.map(p => {
    const v = valor(p.nombre);
    if (Array.isArray(v)) return v.map(s => sectores[String(s)] ?? String(s)).join(", ");
    if (typeof v !== "number") return v == null ? "" : String(v);
    return cifra(v, locale) + (PORCENTAJES.has(regla.clave) ? " %" : "");
  }).filter(Boolean);
  if (partes.length !== 1 || def.parametros[0]?.tipo === "sectores") return partes.join(" · ");
  return t(MAXIMOS.has(regla.clave) ? "builder_regla_maximo" : "builder_regla_minimo", { valor: partes[0] });
}

/** La regla entera para leerla de un vistazo: título y, si tiene, su valor. */
export function textoRegla(def: ReglaCatalogo, regla: ReglaElegida, sectores: Record<string, string>,
  t: Traducir, locale: Locale = "es"): string {
  const valor = valorRegla(def, regla, sectores, t, locale);
  return valor ? `${def.titulo} · ${valor}` : def.titulo;
}
