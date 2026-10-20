import type { Aviso } from "@/lib/liga/api";
import { porcentaje } from "@/lib/liga/format";
import type { Locale } from "@/i18n/locale";

export type Destino = { ir: "cartera" | "clasificacion" | "resumen"; href: string | null };
export type TextoAviso = { titulo: string; texto: string; destino: Destino };
type T = (clave: string, valores?: Record<string, string | number>) => string;

export function textoAviso(aviso: Aviso, t: T, locale: Locale, zona?: string): TextoAviso | null {
  const hora = (iso: string) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zona }).format(new Date(iso));
  const fecha = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: zona }).format(new Date(iso));
  const mes = (iso: string) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: zona }).format(new Date(iso));
  const cifra = (v: unknown) => v == null || v === "" ? null : porcentaje(Number(v), 1, locale);
  const texto = (v: unknown) => typeof v === "string" ? v : "";
  const cierra = texto(aviso.datos.cierra);
  const nombre = texto(aviso.datos.nombre);
  const numero = typeof aviso.datos.numero === "number" ? aviso.datos.numero : texto(aviso.datos.numero);
  const puesto = typeof aviso.datos.puesto_general === "number" ? aviso.datos.puesto_general : "-";
  const rent = cifra(aviso.datos.rentabilidad);
  const sp = cifra(aviso.datos.sp);
  const cartera: Destino = { ir: "cartera", href: "/mias" };
  switch (aviso.tipo) {
    case "cartera_lista":
      return cierra ? { titulo: t("aviso_cartera_lista_t", { mes: mes(cierra) }), texto: t("aviso_cartera_lista_d", { fecha: fecha(cierra), hora: hora(cierra) }), destino: cartera } : null;
    case "cambios_cierran":
      return cierra ? { titulo: t("aviso_cambios_cierran_t", { hora: hora(cierra) }), texto: t("aviso_cambios_cierran_d"), destino: cartera } : null;
    case "empieza":
      return { titulo: t("aviso_empieza_t"), texto: t("aviso_empieza_d"), destino: cartera };
    case "quitadas_vaciadas":
      return { titulo: t("aviso_quitadas_vaciadas_t"), texto: t("aviso_quitadas_vaciadas_d", { nombre }), destino: cartera };
    case "sin_pregunta":
      return { titulo: t("aviso_sin_pregunta_t"), texto: t("aviso_sin_pregunta_d", { nombre }), destino: cartera };
    case "resumen_semanal":
      return { titulo: t("aviso_resumen_semanal_t", { numero }), texto: rent && sp ? t("aviso_resumen_semanal_d", { rent, sp, puesto }) : t("aviso_resumen_sin_datos"), destino: { ir: "resumen", href: null } };
    case "resumen_cierre":
      return { titulo: t("aviso_resumen_cierre_t", { numero, puesto }), texto: rent && sp ? t("aviso_resumen_cierre_d", { rent, sp }) : t("aviso_resumen_sin_datos"), destino: { ir: "clasificacion", href: "/liga" } };
    default: return null;
  }
}

export function cuando(iso: string, ahora: Date, locale: Locale, zona?: string): string {
  const fecha = new Date(iso);
  const dia = (d: Date) => {
    const partes = new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric", timeZone: zona }).formatToParts(d);
    const valor = (tipo: string) => Number(partes.find(p => p.type === tipo)?.value);
    return Date.UTC(valor("year"), valor("month") - 1, valor("day"));
  };
  const dias = (dia(ahora) - dia(fecha)) / 86_400_000;
  const opciones: Intl.DateTimeFormatOptions = dias === 0
    ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    : dias > 0 && dias <= 6 ? { weekday: "short" } : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(locale, { ...opciones, timeZone: zona }).format(fecha).replace(/\.$/, "");
}
