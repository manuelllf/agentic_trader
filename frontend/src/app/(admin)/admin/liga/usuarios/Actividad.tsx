"use client";
import { Bloque, Boton } from "../../_marco/ui";
import { fechaHora, hace } from "../../_marco/formato";

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

  const hora = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
  const tiempo = horasMinutos(actividad.tiempo_30d_seg);
  const total = dias.reduce((suma, dia) => suma + dia.visitas, 0);
  const max = Math.max(0, ...dias.map(dia => dia.visitas));
  const filas = [
    [t("admin_panel_visits"), actividad.visitas_total],
    [t("admin_panel_last_visit"), actividad.ultima_visita ? hace(actividad.ultima_visita, locale) : t("admin_user_no_visits")],
    [t("admin_panel_last_activity"), actividad.ultima_actividad ? hace(actividad.ultima_actividad, locale) : t("admin_user_no_activity")],
    [t("admin_panel_time"), t("admin_panel_time_value", { hours: tiempo.horas, minutes: tiempo.minutos })],
  ];

  return (
    <Bloque titulo={t("admin_panel_section_activity")}>
      <dl>{filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="admin-par adm-usuarios-par">
          <dt className="adm-nota">{etiqueta}</dt>
          <dd>{valor}</dd>
        </div>
      ))}</dl>
      <p className="mt-3">{t("admin_panel_chart")}</p>
      <svg viewBox="0 0 280 64" className="w-full h-auto" role="img" aria-label={t("admin_panel_chart_aria", { total, days: 14 })}>
        <line x1="0" y1="48" x2="280" y2="48" stroke="var(--line)" />
        {dias.map((dia, i) => {
          const altura = max === 0 ? 0 : Math.round(dia.visitas / max * 40);
          return <rect key={dia.dia} x={i * 20} y={48 - altura} width={14} height={altura} fill="var(--accent)" />;
        })}
        <text x="0" y="62" fill="var(--muted)" fontSize="10">{t("admin_panel_chart_from")}</text>
        <text x="280" y="62" textAnchor="end" fill="var(--muted)" fontSize="10">{t("admin_panel_chart_today")}</text>
      </svg>
      <p className="mt-3">{t("admin_panel_recent")}</p>
      {historial === null ? <p>{t("admin_loading")}</p> : historial.filas.length === 0 ? (
        <p>{t("admin_user_history_empty")}</p>
      ) : (
        <>
          {historial.filas.map(visita => (
            <div key={visita.inicio} className="border-b py-2 tabular-nums">
              {t("admin_panel_until", { start: fechaHora(visita.inicio, locale), end: hora.format(new Date(visita.ultima_actividad)) })}
            </div>
          ))}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Boton variante="sec" type="button" disabled={desde === 0} onClick={() => onPagina(desde - 10)}
              className="min-h-[44px] rounded border px-2 disabled:opacity-40">{t("admin_previous")}</Boton>
            <span className="tabular-nums">{t("admin_panel_pager", { from: desde + 1, to: Math.min(desde + 10, historial.total), total: historial.total })}</span>
            <Boton variante="sec" type="button" disabled={desde + 10 >= historial.total} onClick={() => onPagina(desde + 10)}
              className="min-h-[44px] rounded border px-2 disabled:opacity-40">{t("admin_next")}</Boton>
          </div>
        </>
      )}
    </Bloque>
  );
}
