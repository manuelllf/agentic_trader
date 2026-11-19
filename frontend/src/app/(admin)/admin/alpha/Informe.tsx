"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Celda, Grupo, Vacio } from "../_panel/ui";
import { AgenteError } from "./api";
import { Carga, Pagina, TextoAgente } from "./Comun";
import { fecha } from "./formato";
import type { EstadoInforme, InformeDetalle } from "./tipos";
import { useCarga } from "./useCarga";

const PASOS: EstadoInforme[] = ["borrador", "ejecutado", "publicado"];

/** Las cifras del informe son un objeto libre: solo se enseñan las que son texto o número. */
export function cifrasLegibles(cifras: Record<string, unknown> | null | undefined): [string, string][] {
  return Object.entries(cifras ?? {}).flatMap(([k, v]) =>
    typeof v === "string" || typeof v === "number" ? [[k.replace(/_/g, " "), String(v)] as [string, string]] : []);
}

export default function Informe({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const carga = useCarga<InformeDetalle>(`/v1/informes/${encodeURIComponent(id)}`);
  const [copiado, setCopiado] = useState(false);
  const noExiste = carga.error instanceof AgenteError && carga.error.estado === 404;

  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); } catch { setCopiado(false); }
  };

  return (
    <Pagina atras="/admin/alpha?v=informes">
      {noExiste ? <Vacio titulo={t("pnl_agente_inf_no_existe")} /> : (
        <Carga {...carga} filas={5}>
          {r => {
            const hecho = PASOS.indexOf(r.estado);
            const cifras = cifrasLegibles(r.cifras);
            return (
              <>
                <p className="pa-meta">{t("pnl_agente_inf_meta", { tipo: t(`pnl_agente_inf_tipo_${r.tipo}`), fecha: fecha(r.fecha_ny, locale) })}</p>
                <h2 className="pa-h1">{r.titulo}</h2>
                <ol className="pa-pasos" aria-label={t("pnl_agente_inf_estado_aria")}>
                  {PASOS.map((p, i) => <li key={p} className={i <= hecho ? "hecho" : ""} aria-current={i === hecho ? "step" : undefined}>{t(`pnl_agente_inf_estado_${p}`)}</li>)}
                </ol>
                <TextoAgente texto={r.cuerpo} />
                {cifras.length > 0 && (
                  <Grupo cabecera={t("pnl_agente_inf_cifras")}>
                    {cifras.map(([k, v]) => <Celda key={k} titulo={k} valor={v} />)}
                  </Grupo>
                )}
                <Grupo>
                  {r.decision_id !== null && <Celda titulo={t("pnl_agente_inf_ver_decision")} href={`/admin/alpha/decisiones/${r.decision_id}`} />}
                  <Celda titulo={copiado ? t("pnl_agente_inf_copiado") : t("pnl_agente_inf_copiar")} tono="accion" onClick={() => copiar(`${r.titulo}\n\n${r.cuerpo}`)} />
                </Grupo>
                <p className="pnl-pie-grupo">{t("pnl_agente_inf_pie_detalle", { modelo: r.modelo ?? "-" })}</p>
              </>
            );
          }}
        </Carga>
      )}
    </Pagina>
  );
}
