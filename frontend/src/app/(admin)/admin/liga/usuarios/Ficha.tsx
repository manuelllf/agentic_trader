"use client";
import { Bloque } from "../../_marco/ui";
import { fechaCorta } from "../../_marco/formato";

import { useLocale, useTranslations } from "next-intl";
import type { FichaPanel } from "./panel";

export function Ficha({ ficha }: { ficha: FichaPanel }) {
  const t = useTranslations();
  const locale = useLocale();
  const fecha = (valor: string | null) => valor === null ? "" : fechaCorta(valor, locale);
  const filas = [
    [t("admin_panel_email"), ficha.email ?? t("admin_panel_no_email")],
    [t("admin_panel_age"), ficha.edad === null ? t("admin_panel_no_age") : t("admin_panel_age_value", { age: ficha.edad, date: fecha(ficha.edad_declarada_en) })],
    [t("admin_panel_terms"), ficha.terminos.aceptado ? t("admin_panel_terms_value", { version: ficha.terminos.version, date: fecha(ficha.terminos.aceptado_en) }) : t("admin_panel_terms_missing", { version: ficha.terminos.version })],
    [t("admin_panel_deletion"), ficha.baja_solicitada === null ? t("admin_panel_no") : t("admin_panel_deletion_value", { date: fecha(ficha.baja_solicitada) })],
    [t("admin_panel_hidden"), t(ficha.oculto ? "admin_panel_yes" : "admin_panel_no")],
  ];
  return (
    <Bloque titulo={t("admin_panel_section_profile")}>
      <dl>{filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="admin-par adm-usuarios-par">
          <dt className="adm-nota">{etiqueta}</dt>
          <dd>{valor}</dd>
        </div>
      ))}</dl>
    </Bloque>
  );
}
