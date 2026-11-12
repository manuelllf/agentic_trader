"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { normalizeLocale } from "@/i18n/locale";
import { precargarFicha } from "@/lib/liga/ficha";
import type { Clasificacion, FilaClasificacion } from "@/lib/liga/api";
import { porcentaje } from "@/lib/liga/format";
import { escudoCasa } from "../_ui/Escudo";
import { ListaRanking, type EntradaRanking, type FilaRanking } from "./ListaRanking";

// La clasificación de la temporada (maqueta v12): las mismas filas que la semana, con el S&P de la
// temporada en la cabecera, los puestos movidos y los huecos hasta la tuya. Los puntos van en la píldora.
export function ListaClasificacion({ clasificacion, miAlias, onAbrir, premio }: {
  clasificacion: Clasificacion;
  miAlias: string | null;
  onAbrir: (id: string | null) => void;
  premio?: ReactNode;
}) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const { filas, mias, total, sp_temporada: sp } = clasificacion;
  const ultima = filas.length ? filas[filas.length - 1].posicion : 0;
  const ultimaVisible = mias.length ? mias[mias.length - 1].posicion : ultima;
  const huecoHastaTuya = mias.length ? mias[0].posicion - ultima - 1 : 0;
  const huecoResto = total - ultimaVisible;

  const fila = (f: FilaClasificacion): FilaRanking => {
    const id = f.equipo.id;
    return {
      clave: id ?? `p${f.posicion}`,
      puesto: f.posicion,
      movimiento: f.movimiento,
      nombre: f.equipo.nombre,
      sub: "",
      escudo: f.equipo.casa ? escudoCasa(f.equipo.casa) : f.equipo.escudo,
      casa: f.equipo.casa,
      serie: f.serie,
      vs: f.acumulado ? Number(f.acumulado.diferencia_pp) : null,
      rentabilidad: f.acumulado ? Number(f.acumulado.rentabilidad) : null,
      puntos: f.puntos,
      tuya: !f.equipo.casa && !!miAlias && f.equipo.autor === miAlias,
      onAbrir: () => onAbrir(id),
      alAcercar: id ? () => precargarFicha(id) : undefined,
    };
  };

  const entradas: EntradaRanking[] = [
    ...filas.map(fila),
    ...(huecoHastaTuya > 0 ? [{ hueco: t("league_hueco_hasta_tuya", { count: huecoHastaTuya }) }] : []),
    ...mias.map(fila),
    ...(huecoResto > 0 ? [{ hueco: t("league_mas_filas", { count: huecoResto }) }] : []),
  ];

  const cabecera = sp != null
    ? <>{t("league_lista_temporada")} · S&amp;P <b className="num">{porcentaje(Number(sp), 1, locale)}</b></>
    : t("league_lista_temporada");

  return (
    <>
      {clasificacion.jornada_provisional != null && <p className="lv-nota">
        {t("liga_clasificacion_provisional_nota", { numero: clasificacion.jornada_provisional, total: clasificacion.temporada.n_jornadas })}
      </p>}
      <ListaRanking cabecera={cabecera} modos={["vs", "rent", "pts"]}
        etiquetas={{ vs: t("league_modo_vs"), rent: t("league_orden_rentabilidad"), pts: t("league_modo_puntos") }}
        entradas={entradas} />
      {premio}
      <p className="lv-pie">{t("league_pie_orden")}</p>
    </>
  );
}
