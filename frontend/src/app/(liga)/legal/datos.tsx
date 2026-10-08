import { getLocale } from "next-intl/server";
import { localeTag, normalizeLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/locale";

// Datos del titular y versión de los textos legales, en un solo sitio.
export const TITULAR = { nombre: "Manuel Llao Freire" };

export const VERSION_LEGAL = "2026-10-08";
export function fechaLegal(locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${VERSION_LEGAL}T00:00:00Z`));
}

// Un alias por función. El de uso general cambia de idioma.
const CORREOS = {
  info: "info@vennett.app",
  legal: "legal@vennett.app",
  abuso: "abuse@vennett.app",
  general: { es: "hola@vennett.app", en: "hello@vennett.app" },
} as const;

/** Correo de contacto para una función concreta de los textos legales. */
export async function Contacto({ uso }: { uso: "info" | "legal" | "abuso" | "general" }) {
  const correo = uso === "general"
    ? CORREOS.general[normalizeLocale(await getLocale()) ?? "es"]
    : CORREOS[uso];
  return <a href={`mailto:${correo}`}>{correo}</a>;
}
