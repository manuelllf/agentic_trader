import Link from "next/link";
import type { ReactNode } from "react";
import { VERSION_LEGAL } from "./datos";
import { getLocale, getTranslations } from "next-intl/server";
import { normalizeLocale, localeTag } from "@/i18n/locale";

// Envoltorio de las páginas legales. `resumen` es la primera capa: lo esencial en pocas líneas.
export async function PlantillaLegal({
  titulo, resumen, children,
}: { titulo: string; resumen?: ReactNode[]; children: ReactNode }) {
  const t = await getTranslations();
  const locale = normalizeLocale(await getLocale()) ?? "es";
  return (
    <main className="sencilla legal-page">
      <header className="sencilla-top">
        <Link href="/" className="wordmark">Vennett</Link>
      </header>

      <div className="legal-cuerpo">
        <h1>{titulo}</h1>
        <p className="legal-fecha">{t("legal_last_updated", { date: new Intl.DateTimeFormat(localeTag(locale), { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${VERSION_LEGAL}T00:00:00Z`)), version: VERSION_LEGAL })}</p>
        {resumen && (
          <section className="legal-resumen" aria-label={t("legal_summary_aria")}>
            <h2>{t("legal_summary_heading")}</h2>
            <ul>
              {resumen.map((linea, i) => <li key={i}>{linea}</li>)}
            </ul>
          </section>
        )}
        {children}
        <nav className="legal-nav" aria-label={t("legal_other_documents_aria")}>
          <Link href="/legal/aviso">{t("legal_notice_title")}</Link>
          <Link href="/legal/privacidad">{t("legal_privacy_title")}</Link>
          <Link href="/legal/terminos">{t("legal_terms_short")}</Link>
          <Link href="/legal/cookies">{t("legal_cookies_title")}</Link>
        </nav>
      </div>
    </main>
  );
}
