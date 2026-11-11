"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ActividadItem } from "@/lib/liga/api";
import { fecha } from "@/lib/liga/format";
import { Vacio } from "./Vacio";

export function Actividad({ items }: { items: ActividadItem[] }) {
  const t = useTranslations();
  const locale = useLocale() === "en" ? "en" : "es";
  const lista = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });

  if (items.length === 0) {
    return <Vacio titulo={t("actividad_vacia_titulo")} texto={t("actividad_vacia_texto")} />;
  }

  return (
    <ul className="lv-actividad">
      {items.map((item, indice) => {
        const texto = item.tipo === "puesto"
          ? t((item.saltos ?? 0) > 0 ? "actividad_sube" : "actividad_baja", {
            equipo: item.equipo, n: Math.abs(item.saltos ?? 0),
          })
          : item.entradas.length && item.salidas.length
            ? t("actividad_cambio_ambos", {
              equipo: item.equipo, salidas: lista.format(item.salidas), entradas: lista.format(item.entradas),
            })
            : item.entradas.length
              ? t("actividad_cambio_entran", { equipo: item.equipo, entradas: lista.format(item.entradas) })
              : t("actividad_cambio_salen", { equipo: item.equipo, salidas: lista.format(item.salidas) });
        const inicioEquipo = texto.indexOf(item.equipo);
        return (
          <li key={`${item.dia}:${item.tipo}:${indice}`}>
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {texto.slice(0, inicioEquipo)}<b>{item.equipo}</b>{texto.slice(inicioEquipo + item.equipo.length)}
            </span>
            <time className="num" dateTime={item.dia}>
              {fecha(item.dia, new Date(), locale)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
