import Link from "next/link";
import type { Locale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";

// Datos del titular y versión de los textos legales, en un solo sitio.
export const TITULAR = {
  nombre: "Manuel Llao Freire",
  ubicacion: "Galicia, España",
  // Con correo, todos los textos lo enseñan; sin él, remiten a la propia app.
  correo: null as string | null,
};

export const VERSION_LEGAL = "2026-10-03";
export function fechaLegal(locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-ES", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${VERSION_LEGAL}T00:00:00Z`));
}

/** Cómo contactar con el titular: el correo si existe; si no, la propia aplicación. */
export async function Contacto() {
  const t = await getTranslations();
  if (TITULAR.correo) return <a href={`mailto:${TITULAR.correo}`}>{TITULAR.correo}</a>;
  return (
    <>
      {t("legal_contact_in_app_before")} (<Link href="/cuenta">{t("legal_account_link")}</Link>{t("legal_contact_in_app_after")})
    </>
  );
}
