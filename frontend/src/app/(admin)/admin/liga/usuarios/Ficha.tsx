"use client";

import { useLocale, useTranslations } from "next-intl";
import type { FichaPanel } from "./panel";

export function Ficha({ ficha }: { ficha: FichaPanel }) {
  const t = useTranslations();
  const locale = useLocale();
  const formato = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const fecha = (valor: string | null) => valor === null ? "" : formato.format(new Date(valor));
  const filas = [
    [t("admin_panel_email"), ficha.email ?? t("admin_panel_no_email")],
    [t("admin_panel_age"), ficha.edad === null ? t("admin_panel_no_age") : t("admin_panel_age_value", { age: ficha.edad, date: fecha(ficha.edad_declarada_en) })],
    [t("admin_panel_terms"), ficha.terminos.aceptado ? t("admin_panel_terms_value", { version: ficha.terminos.version, date: fecha(ficha.terminos.aceptado_en) }) : t("admin_panel_terms_missing", { version: ficha.terminos.version })],
    [t("admin_panel_deletion"), ficha.baja_solicitada === null ? t("admin_panel_no") : t("admin_panel_deletion_value", { date: fecha(ficha.baja_solicitada) })],
    [t("admin_panel_hidden"), t(ficha.oculto ? "admin_panel_yes" : "admin_panel_no")],
  ];
  return (
    <section className="mt-5" style={{ color: "#c3c2b7", overflowWrap: "anywhere" }}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-white">{t("admin_panel_section_profile")}</h2>
        <span className="text-xs" style={{ color: "#898781" }}>{t("admin_panel_readonly")}</span>
      </div>
      {filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="admin-par border-b py-2 flex justify-between gap-2" style={{ borderColor: "#303030" }}>
          <span style={{ color: "#898781" }}>{etiqueta}</span>
          <span className="min-w-0 break-words tabular-nums">{valor}</span>
        </div>
      ))}
    </section>
  );
}
