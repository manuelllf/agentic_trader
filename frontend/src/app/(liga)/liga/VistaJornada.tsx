"use client";

import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { escudoCasa } from "../_ui/Escudo";
import { FilaJornada } from "../_ui/FilaJornada";
import type { EquipoPublico, JornadaDetalle } from "@/lib/liga/api";
import { fecha } from "@/lib/liga/format";

export function etiquetaEquipo(e: EquipoPublico, miAlias: string | null, t: (key: string) => string): string {
  if (e.casa) return t("league_equipo_casa");
  if (miAlias && e.autor === miAlias) return t("league_equipo_tuya");
  return t("league_equipo_comunidad");
}

export function VistaJornada({
  detalle, miAlias, onAbrir,
}: { detalle: JornadaDetalle; miAlias: string | null; onAbrir: (id: string | null) => void }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const formatDate = (value: string) => fecha(value, new Date(), locale);
  const formatTime = (value: string) => new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const conDatos = detalle.filas.filter((f) => f.rentabilidad !== null);
  if (conDatos.length === 0) {
    return (
      <p className="callout" style={{ marginTop: 20 }}>
        {t("league_jornada_sin_cierres")}
      </p>
    );
  }
  const grupos: Record<"G" | "E" | "P", typeof conDatos> = { G: [], E: [], P: [] };
  for (const f of conDatos) {
    const dif = f.dif_sp ?? 0;
    grupos[dif > 0.2 ? "G" : dif >= -0.2 ? "E" : "P"].push(f);
  }
  const fila = (f: (typeof conDatos)[number]) => (
    <FilaJornada key={f.equipo.id ?? `p${detalle.filas.indexOf(f)}`} nombre={f.equipo.nombre}
      escudo={f.equipo.casa ? escudoCasa(f.equipo.casa) : f.equipo.escudo} casa={f.equipo.casa}
      etiqueta={etiquetaEquipo(f.equipo, miAlias, (key) => t(key))}
      puestoEscritorio={conDatos.indexOf(f) + 1} diferenciaEscritorio={f.dif_sp}
      rentabilidad={f.rentabilidad ?? 0} propia={!!miAlias && f.equipo.autor === miAlias}
      onAbrir={() => onAbrir(f.equipo.id)} />
  );
  return (
    <div className="sec" style={{ marginTop: 20 }}>
      {detalle.provisional && detalle.hasta && (
        <p className="meta">
          {detalle.en_vivo ? t("league_cotizaciones_provisionales") : t("league_ultimo_cierre", { date: formatDate(detalle.hasta) })}
          {detalle.actualizado && t("league_consultado_a", { time: formatTime(detalle.actualizado) })}
          {t("league_actualiza_y_cierre")}
        </p>
      )}
      {grupos.G.length > 0 && <>
        <p className="grp">{t("league_ganando_mes")} <small>{grupos.G.length}</small></p>
        {grupos.G.map(fila)}
      </>}
      {grupos.E.length > 0 && <>
        <p className="grp">{t("league_empatando")} <small>{t("league_empate_ayuda")}</small></p>
        {grupos.E.map(fila)}
      </>}
      {grupos.P.length > 0 && <>
        <p className="grp">{t("league_perdiendo")} <small>{grupos.P.length}</small></p>
        {grupos.P.map(fila)}
      </>}
    </div>
  );
}
