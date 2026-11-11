"use client";

import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { escudoCasa } from "../_ui/Escudo";
import type { EquipoPublico, JornadaDetalle } from "@/lib/liga/api";
import { fecha, porcentaje } from "@/lib/liga/format";
import { ListaRanking, type EntradaRanking } from "./ListaRanking";

export function etiquetaEquipo(e: EquipoPublico, miAlias: string | null, t: (key: string) => string): string {
  if (e.casa) return t("league_equipo_casa");
  if (miAlias && e.autor === miAlias) return t("league_equipo_tuya");
  return t("league_equipo_comunidad");
}

// «Esta semana» (maqueta v12): las estrategias con cifra, numeradas de mejor a peor, con su gráfica de
// la semana y la diferencia con el S&P. Sin grupos: el color de la píldora ya dice quién va ganando.
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
  // Los puntos de la semana (3, 1 o 0 según la banda de ±0,2 pp) van en la línea de debajo, como en la clasificación.
  const entradas: EntradaRanking[] = conDatos.map((f, i) => ({
    clave: f.equipo.id ?? `p${i}`,
    puesto: i + 1,
    nombre: f.equipo.nombre,
    sub: [etiquetaEquipo(f.equipo, miAlias, (key) => t(key)),
      f.puntos == null ? null : t("strategies_points", { count: f.puntos })].filter(Boolean).join(" · "),
    escudo: f.equipo.casa ? escudoCasa(f.equipo.casa) : f.equipo.escudo,
    casa: f.equipo.casa,
    serie: f.serie,
    vs: f.dif_sp == null ? null : Number(f.dif_sp),
    rentabilidad: Number(f.rentabilidad),
    puntos: f.puntos,
    tuya: !f.equipo.casa && !!miAlias && f.equipo.autor === miAlias,
    onAbrir: () => onAbrir(f.equipo.id),
  }));
  const sp = detalle.jornada.sp_rentabilidad;
  return (
    <>
      {detalle.provisional && detalle.hasta && (
        <p className="lv-nota">
          {detalle.en_vivo ? t("league_cotizaciones_provisionales") : t("league_ultimo_cierre", { date: formatDate(detalle.hasta) })}
          {detalle.actualizado && t("league_consultado_a", { time: formatTime(detalle.actualizado) })}
          {t("league_actualiza_y_cierre")}
        </p>
      )}
      <ListaRanking
        cabecera={<>{t("league_este_mes")} · S&amp;P <b className="num">{sp == null ? "-" : porcentaje(Number(sp), 1, locale)}</b></>}
        modos={["vs", "rent"]}
        etiquetas={{ vs: t("league_modo_vs"), rent: t("league_orden_rentabilidad"), pts: t("league_modo_puntos") }}
        entradas={entradas} />
    </>
  );
}
