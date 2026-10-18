"use client";

import type { JSX } from "react";
import { useLocale, useTranslations } from "next-intl";
import { horasMinutos, type DiasPanel, type FichaPanel } from "./panel";

export type Historial = { total: number; filas: { inicio: string; ultima_actividad: string }[] };

export function Actividad({ actividad, dias, historial, desde, onPagina }: {
  actividad: FichaPanel["actividad"];
  dias: DiasPanel["dias"];
  historial: Historial | null;
  desde: number;
  onPagina: (nuevoDesde: number) => void;
}): JSX.Element {
  const t = useTranslations();
  const locale = useLocale();
  const fechaHora = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const hora = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
  const tiempo = horasMinutos(actividad.tiempo_30d_seg);
  const total = dias.reduce((suma, dia) => suma + dia.visitas, 0);
  const max = Math.max(0, ...dias.map(dia => dia.visitas));
  const filas = [
    [t("admin_panel_visits"), actividad.visitas_total],
    [t("admin_panel_last_visit"), actividad.ultima_visita ? fechaHora.format(new Date(actividad.ultima_visita)) : t("admin_user_no_visits")],
    [t("admin_panel_last_activity"), actividad.ultima_actividad ? fechaHora.format(new Date(actividad.ultima_actividad)) : t("admin_user_no_activity")],
    [t("admin_panel_time"), t("admin_panel_time_value", { hours: tiempo.horas, minutes: tiempo.minutos })],
  ];

  return (
    <section className="mt-5" style={{ color: "#c3c2b7", overflowWrap: "anywhere" }}>
      <h2 className="font-bold text-white">{t("admin_panel_section_activity")}</h2>
      {filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="admin-par border-b py-2 flex justify-between gap-2" style={{ borderColor: "#303030" }}>
          <span style={{ color: "#898781" }}>{etiqueta}</span>
          <span className="min-w-0 tabular-nums">{valor}</span>
        </div>
      ))}
      <p className="mt-3">{t("admin_panel_chart")}</p>
      <svg viewBox="0 0 280 64" className="w-full h-auto" role="img" aria-label={t("admin_panel_chart_aria", { total, days: 14 })}>
        <line x1="0" y1="48" x2="280" y2="48" stroke="#303030" />
        {dias.map((dia, i) => {
          const altura = max === 0 ? 0 : Math.round(dia.visitas / max * 40);
          return <rect key={dia.dia} x={i * 20} y={48 - altura} width={14} height={altura} fill="#3987e5" />;
        })}
        <text x="0" y="62" fill="#898781" fontSize="10">{t("admin_panel_chart_from")}</text>
        <text x="280" y="62" textAnchor="end" fill="#898781" fontSize="10">{t("admin_panel_chart_today")}</text>
      </svg>
      <p className="mt-3">{t("admin_panel_recent")}</p>
      {historial === null ? <p style={{ color: "#898781" }}>{t("admin_loading")}</p> : historial.filas.length === 0 ? (
        <p style={{ color: "#898781" }}>{t("admin_user_history_empty")}</p>
      ) : (
        <>
          {historial.filas.map(visita => (
            <div key={visita.inicio} className="border-b py-2 tabular-nums" style={{ borderColor: "#303030" }}>
              {t("admin_panel_until", { start: fechaHora.format(new Date(visita.inicio)), end: hora.format(new Date(visita.ultima_actividad)) })}
            </div>
          ))}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button type="button" disabled={desde === 0} onClick={() => onPagina(desde - 10)}
              className="min-h-[44px] rounded border px-2 disabled:opacity-40"
              style={{ background: "#141413", borderColor: "#303030" }}>{t("admin_previous")}</button>
            <span className="tabular-nums">{t("admin_panel_pager", { from: desde + 1, to: Math.min(desde + 10, historial.total), total: historial.total })}</span>
            <button type="button" disabled={desde + 10 >= historial.total} onClick={() => onPagina(desde + 10)}
              className="min-h-[44px] rounded border px-2 disabled:opacity-40"
              style={{ background: "#141413", borderColor: "#303030" }}>{t("admin_next")}</button>
          </div>
        </>
      )}
    </section>
  );
}
