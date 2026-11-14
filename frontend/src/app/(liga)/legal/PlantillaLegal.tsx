import Link from "next/link";
import type { ReactNode } from "react";
import { VERSION_LEGAL, fechaLegal } from "./datos";
import { getLocale, getTranslations } from "next-intl/server";
import { normalizeLocale } from "@/i18n/locale";
import { BarraPestanas } from "../_ui/BarraPestanas";
import { CabeceraPagina } from "../_ui/CabeceraPagina";
import { Chevron } from "../cuenta/marco";
import "../liga/ranking.css";
import "../_ui/grupos.css";
import "../_ui/paginas.css";

export type DocumentoLegal = "aviso" | "privacidad" | "terminos" | "cookies" | "bases-premio";

const DOCUMENTOS: [DocumentoLegal, string][] = [
  ["aviso", "legal_notice_title"],
  ["privacidad", "legal_privacy_title"],
  ["terminos", "legal_terms_short"],
  ["cookies", "legal_cookies_title"],
  ["bases-premio", "legal_bases_title"],
];

// Envoltorio de las páginas legales. `resumen` es la primera capa: lo esencial en pocas líneas.
export async function PlantillaLegal({
  titulo, tituloCorto, actual, resumen, children,
}: { titulo: string; tituloCorto: string; actual: DocumentoLegal; resumen?: ReactNode[]; children: ReactNode }) {
  const t = await getTranslations();
  const locale = normalizeLocale(await getLocale()) ?? "es";
  return (
    <main className="scroll lv-pagina pg-pagina">
      <CabeceraPagina titulo={tituloCorto} />
      <div className="pg pg-legal">
        <h1>{titulo}</h1>
        <p className="legal-fecha">{t("legal_last_updated", { date: fechaLegal(locale), version: VERSION_LEGAL })}</p>
        {resumen && (
          <section className="legal-resumen" aria-label={t("legal_summary_aria")}>
            <h2>{t("legal_summary_heading")}</h2>
            <ul>
              {resumen.map((linea, i) => <li key={i}>{linea}</li>)}
            </ul>
          </section>
        )}
        {children}
        <p className="cu-cab">{t("legal_other_documents_aria")}</p>
        <ul className="cu-grupo">
          {DOCUMENTOS.filter(([doc]) => doc !== actual).map(([doc, clave]) => (
            <li key={doc}>
              <Link className="cu-celda" href={`/legal/${doc}`}><span>{t(clave)}</span><span /><Chevron /></Link>
            </li>
          ))}
        </ul>
      </div>
      <BarraPestanas />
    </main>
  );
}
