"use client";
import { Bloque } from "../../_marco/ui";
import { dolares } from "../../_marco/formato";

import { useLocale, useTranslations } from "next-intl";
import { type FichaPanel } from "./panel";

export function CosteIA({ ia }: { ia: FichaPanel["ia"] }) {
  const t = useTranslations();
  const locale = useLocale();
  const dinero = (valor: string) => dolares(valor, locale);
  const filas = [
    [t("admin_panel_ai_converter"), `${t("admin_panel_ai_calls", { count: ia.mes.conversor_llamadas })} · ${dinero(ia.mes.conversor_usd)}`],
    [t("admin_panel_ai_question"), `${t("admin_panel_ai_calls", { count: ia.mes.pregunta_llamadas })} · ${dinero(ia.mes.pregunta_usd)}`],
    [t("admin_panel_ai_reading"), `${t("admin_panel_ai_calls", { count: ia.mes.lectura_llamadas })} · ${dinero(ia.mes.lectura_usd)}`],
    [t("admin_panel_ai_calls", { count: ia.mes.llamadas }), dinero(ia.mes.total_usd)],
    [t("admin_panel_ai_cache"), ia.mes.cache],
    [t("admin_panel_ai_history"), dinero(ia.historico_usd)],
  ];
  return (
    <Bloque titulo={t("admin_panel_section_ai")}>
      <dl>{filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="admin-par adm-usuarios-par">
          <dt className="adm-nota">{etiqueta}</dt>
          <dd>{valor}</dd>
        </div>
      ))}</dl>
    </Bloque>
  );
}
