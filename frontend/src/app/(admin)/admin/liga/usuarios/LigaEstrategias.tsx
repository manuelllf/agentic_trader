"use client";

import { useTranslations } from "next-intl";
import type { FichaPanel } from "./panel";

export function LigaEstrategias({ liga }: { liga: FichaPanel["liga"] }) {
  const t = useTranslations();
  const filas = [
    [t("admin_panel_league_strategies"), t("admin_panel_league_playing", { total: liga.estrategias, playing: liga.estrategias_jugando })],
    [t("admin_panel_league_entries"), liga.inscripciones],
    [t("admin_panel_league_private"), t("admin_panel_league_private_value", { owned: liga.ligas_propias, member: liga.ligas_miembro })],
    [t("admin_panel_reports"), t("admin_panel_reports_value", { made: liga.reportes_hechos, received: liga.reportes_recibidos })],
  ];
  return (
    <section className="mt-5" style={{ color: "#c3c2b7", overflowWrap: "anywhere" }}>
      <h2 className="font-bold text-white">{t("admin_panel_section_league")}</h2>
      {filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="admin-par border-b py-2 flex justify-between gap-2" style={{ borderColor: "#303030" }}>
          <span style={{ color: "#898781" }}>{etiqueta}</span>
          <span className="min-w-0 tabular-nums">{valor}</span>
        </div>
      ))}
    </section>
  );
}
