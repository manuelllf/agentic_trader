"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Celda, ChipFiltro, Chips, Grupo, Vacio } from "../_panel/ui";
import { Carga } from "./Comun";
import { fecha } from "./formato";
import type { ResumenInforme, TipoInforme } from "./tipos";
import { useCarga } from "./useCarga";

export const TIPOS_INFORME: TipoInforme[] = ["parte_diario", "decision", "semanal", "mensual", "aviso"];

/** Agrupa por mes, del más reciente al más antiguo (la API ya llega ordenada por fecha). */
export function porMes(items: ResumenInforme[]): { mes: string; items: ResumenInforme[] }[] {
  const grupos: { mes: string; items: ResumenInforme[] }[] = [];
  for (const it of items) {
    const mes = it.fecha_ny.slice(0, 7);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.mes === mes) ultimo.items.push(it); else grupos.push({ mes, items: [it] });
  }
  return grupos;
}

export default function VistaInformes() {
  const t = useTranslations();
  const locale = useLocale();
  const [tipo, setTipo] = useState<TipoInforme | null>(null);
  const carga = useCarga<{ items: ResumenInforme[] }>(`/v1/informes${tipo ? `?tipo=${tipo}` : ""}`);

  return (
    <>
      <Chips etiqueta={t("pnl_agente_inf_tipo_aria")}>
        <ChipFiltro activo={tipo === null} onClick={() => setTipo(null)}>{t("pnl_agente_inf_tipo_todo")}</ChipFiltro>
        {TIPOS_INFORME.map(k => (
          <ChipFiltro key={k} activo={tipo === k} onClick={() => setTipo(k)}>{t(`pnl_agente_inf_tipo_${k}`)}</ChipFiltro>
        ))}
      </Chips>
      <Carga {...carga} filas={4}>
        {({ items }) => items.length === 0 ? (
          <Vacio titulo={t("pnl_agente_inf_vacio_titulo")} texto={t("pnl_agente_inf_vacio_texto")} />
        ) : (
          <>
            {porMes(items).map(g => (
              <Grupo key={g.mes} cabecera={new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${g.mes}-01T00:00:00Z`))}>
                {g.items.map(r => (
                  <Celda key={r.id} titulo={r.titulo} href={`/admin/agente/informes/${r.id}`}
                    subtitulo={`${fecha(r.fecha_ny, locale)} · ${t(`pnl_agente_inf_tipo_${r.tipo}`)}`} />
                ))}
              </Grupo>
            ))}
            <p className="pnl-pie-grupo">{t("pnl_agente_inf_pie")}</p>
          </>
        )}
      </Carga>
    </>
  );
}
