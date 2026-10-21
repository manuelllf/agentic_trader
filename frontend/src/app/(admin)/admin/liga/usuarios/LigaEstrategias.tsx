"use client";
import { Bloque } from "../../_marco/ui";

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
    <Bloque titulo={t("admin_panel_section_league")}>
      <dl>{filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="admin-par adm-usuarios-par">
          <dt className="adm-nota">{etiqueta}</dt>
          <dd>{valor}</dd>
        </div>
      ))}</dl>
    </Bloque>
  );
}
