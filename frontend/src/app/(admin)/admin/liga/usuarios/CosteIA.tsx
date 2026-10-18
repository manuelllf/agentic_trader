"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatoUsd, type FichaPanel } from "./panel";

export function CosteIA({ ia }: { ia: FichaPanel["ia"] }) {
  const t = useTranslations();
  const locale = useLocale();
  const dinero = (valor: string) => formatoUsd(locale).format(Number(valor));
  const filas = [
    [t("admin_panel_ai_converter"), `${t("admin_panel_ai_calls", { count: ia.mes.conversor_llamadas })} · ${dinero(ia.mes.conversor_usd)}`],
    [t("admin_panel_ai_question"), `${t("admin_panel_ai_calls", { count: ia.mes.pregunta_llamadas })} · ${dinero(ia.mes.pregunta_usd)} · ${t("admin_panel_ai_collected", { value: dinero(ia.mes.cobrado_pregunta_usd) })}`],
    [t("admin_panel_ai_reading"), `${t("admin_panel_ai_calls", { count: ia.mes.lectura_llamadas })} · ${dinero(ia.mes.lectura_usd)} · ${t("admin_panel_ai_collected", { value: dinero(ia.mes.cobrado_lectura_usd) })}`],
    [t("admin_panel_ai_calls", { count: ia.mes.llamadas }), t("admin_panel_ai_total", { paid: dinero(ia.mes.total_usd), collected: dinero(ia.mes.cobrado_usd) })],
    [t("admin_panel_ai_cache"), ia.mes.cache],
    [t("admin_panel_ai_history"), dinero(ia.historico_usd)],
  ];
  return (
    <section className="mt-5" style={{ color: "#c3c2b7", overflowWrap: "anywhere" }}>
      <h2 className="font-bold text-white">{t("admin_panel_section_ai")}</h2>
      {filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="admin-par border-b py-2 flex justify-between gap-2" style={{ borderColor: "#303030" }}>
          <span style={{ color: "#898781" }}>{etiqueta}</span>
          <span className="min-w-0 tabular-nums">{valor}</span>
        </div>
      ))}
      <p className="mt-2 text-xs" style={{ color: "#898781" }}>{t("admin_panel_ai_note")}</p>
    </section>
  );
}
