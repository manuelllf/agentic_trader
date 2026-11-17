import type { useTranslations } from "next-intl";
import type { OperacionCorta, TipoDecision, Veredicto } from "./tipos";

export type Traducir = ReturnType<typeof useTranslations>;

const ZONA = "America/New_York";

/** «A, B y C»; con más de `max`, «A, B, C, D y 3 más». */
export function lista(xs: string[], locale: string, t: Traducir, max = 4): string {
  if (xs.length <= 1) return xs.join("");
  if (xs.length <= max) return new Intl.ListFormat(locale, { type: "conjunction" }).format(xs);
  return t("pnl_agente_pasos_lista_mas", { lista: xs.slice(0, max).join(", "), n: xs.length - max });
}

/** Título de una decisión: lo que hace con cada empresa («Compra RDDT y MSFT»), o su tipo si no opera. */
export function tituloDecision(ops: OperacionCorta[], tipo: TipoDecision, t: Traducir, locale: string): string {
  if (!ops.length) return t(`pnl_agente_dec_tipo_${tipo}`);
  const porLado = new Map<string, string[]>();
  ops.forEach(o => porLado.set(o.lado, [...(porLado.get(o.lado) ?? []), o.ticker]));
  const partes = [...porLado].map(([lado, ts]) => `${t(`pnl_agente_lado_${lado}`)} ${lista(ts, locale, t)}`);
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(partes);
}

export const veredicto = (v: Veredicto | null, t: Traducir) => (v ? t(`pnl_agente_ver_${v}`) : t("pnl_agente_dec_sin_revisor"));

/** «16 nov · Aprobada · En sombra», la línea de debajo de una decisión. */
export function subDecision(d: { veredicto: Veredicto | null; sombra: boolean }, t: Traducir, inicio: string): string {
  return [inicio, veredicto(d.veredicto, t), d.sombra ? t("pnl_agente_dec_en_sombra") : ""].filter(Boolean).join(" · ");
}

/** Día de Nueva York (AAAA-MM-DD) de un instante. */
export const diaNY = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(iso));

const mediodia = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
const mayuscula = (s: string, locale: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);

/** «Lunes, 16 nov». */
export const diaLargo = (ymd: string, locale: string) =>
  mayuscula(new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(mediodia(ymd)).replace(".", ""), locale);

/** «lun 16». */
export const diaCorto = (ymd: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(mediodia(ymd)).replace(".", "");

export const capitalizar = mayuscula;
/** Primera letra en minúscula para meter un título en una frase, sin tocar los tickers («compra RDDT»). */
export const enFrase = (s: string, locale: string) => s.charAt(0).toLocaleLowerCase(locale) + s.slice(1);

/** Hora de Nueva York con segundos. */
export const horaSegNY = (ms: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: ZONA }).format(new Date(ms));
