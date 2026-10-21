"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get } from "@/lib/api";
import { Barra, Bloque, Chip, Estado, Pagina } from "../../_marco/ui";
import { dolares, fechaCorta, numero, porcentajeSimple } from "../../_marco/formato";
import { diasDelMes, maximoDia } from "./diasDelMes";

type FilaCoste = {
  finalidad: "conversor" | "pregunta" | "lectura";
  pagado_usd: string; llamadas: number; cache_hits: number;
};
type ParteCoste = {
  parte: "pregunta_pruebas" | "pregunta_formacion" | "escaneo";
  detalle: string | null; pagado_usd: string; llamadas: number;
};
type CosteIA = {
  por_dia: { dia: string; pagado_usd: string }[];
  mes: string; filas: FilaCoste[]; desglose: ParteCoste[]; total_pagado_usd: string;
  tope_mensual_usd: string | null;
};

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const mesActual = () => new Date().toISOString().slice(0, 7);

function CosteIAPanel() {
  const t = useTranslations();
  const locale = useLocale();
  const currency = (v: string) => dolares(v, locale);
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const etiquetas: Record<string, string> = { conversor: t("admin_cost_converter"), pregunta: t("admin_cost_question"), lectura: t("admin_cost_reading") };
  const partes: Record<ParteCoste["parte"], string> = {
    pregunta_pruebas: t("admin_cost_part_question_tests"),
    pregunta_formacion: t("admin_cost_part_question_formation"),
    escaneo: t("admin_cost_part_scan"),
  };
  const [mes, setMes] = useState(mesActual());
  const [datos, setDatos] = useState<CosteIA | null>(null);
  const [fallo, setFallo] = useState("");
  const [avisoPct, setAvisoPct] = useState<number | null>(null);

  useEffect(() => {
    let vigente = true;
    get<{ clave: string; efectivo: unknown }[]>("/liga/admin/ajustes")
      .then((ajustes) => {
        const efectivo = ajustes.find((a) => a.clave === "panel.aviso_tope_ia_pct")?.efectivo;
        const porcentaje = efectivo == null ? null : Number(efectivo);
        if (vigente) setAvisoPct(porcentaje != null && Number.isFinite(porcentaje) ? porcentaje : null);
      })
      .catch(() => { if (vigente) setAvisoPct(null); });
    return () => { vigente = false; };
  }, []);
  useEffect(() => {
    let vigente = true;
    setDatos(null); setFallo("");
    get<CosteIA>(`/liga/admin/coste-ia?mes=${mes}`)
      .then(r => { if (vigente) setDatos(r); })
      .catch(e => { if (vigente) setFallo(errorText(e)); });
    return () => { vigente = false; };
  }, [mes, errorText]);
  const gastoAlto = datos?.tope_mensual_usd != null && avisoPct != null
    && Number(datos.total_pagado_usd) >= Number(datos.tope_mensual_usd) * avisoPct / 100;
  const dias = datos ? diasDelMes(mes, datos.por_dia) : [];
  const maximo = maximoDia(dias);
  const diasConGasto = dias.filter(d => d.pagado > 0).length;
  return <Pagina titulo={t("admin_cost_title")} accion={<input aria-label={t("admin_cost_month")} type="month" value={mes} onChange={e => { if (e.target.value) setMes(e.target.value); }} className="h-9 rounded-[var(--control-radius)] border border-[var(--line)] bg-[var(--surface)] px-3" />}>
    {fallo && <Estado tipo="error">{fallo}</Estado>}
    {!datos ? !fallo && <Estado tipo="cargando" /> : <>
      <Bloque>
        <div className="flex items-baseline gap-3"><strong className="adm-cifra-valor">{currency(datos.total_pagado_usd)}</strong><span className="adm-nota">{datos.tope_mensual_usd != null ? t("admin_cost_cap_summary", { cap: currency(datos.tope_mensual_usd), pct: porcentajeSimple(Number(datos.tope_mensual_usd) > 0 ? Number(datos.total_pagado_usd) / Number(datos.tope_mensual_usd) * 100 : 0, locale) }) : t("admin_cost_monthly_cap_unset")}</span></div>
        {datos.tope_mensual_usd != null && <Barra valor={Number(datos.total_pagado_usd)} maximo={Number(datos.tope_mensual_usd)} tono={gastoAlto ? "aviso" : undefined} />}
        {gastoAlto && <Chip tono="aviso">{t("admin_cost_over_pct", { pct: avisoPct! })}</Chip>}
      </Bloque>
      <Bloque titulo={t("admin_cost_por_dia_titulo")}>
        {diasConGasto === 0 ? <Estado tipo="vacio">{t("admin_cost_por_dia_vacio")}</Estado> : <>
          <div role="img" aria-label={t("admin_cost_por_dia_resumen", { total: currency(datos.total_pagado_usd), dias: diasConGasto })} className="flex h-[120px] items-end gap-[3px]">
            {dias.map(({ dia, pagado }) => <i key={dia} aria-hidden="true" className="flex-1 bg-[var(--accent)]" style={{ height: `${pagado / maximo * 100}%`, minHeight: pagado > 0 ? 2 : 0 }} />)}
          </div>
          <div className="adm-nota flex justify-between"><span>{fechaCorta(`${mes}-01`, locale)}</span><span>{fechaCorta(`${mes}-${dias.length}`, locale)}</span></div>
        </>}
      </Bloque>
      <Bloque titulo={t("admin_cost_purpose")}><table className="adm-tabla"><thead><tr><th>{t("admin_cost_purpose_column")}</th><th className="der">{t("admin_cost_calls_column")}</th><th className="der">{t("admin_cost_cache")}</th><th className="der">{t("admin_cost_spend")}</th></tr></thead><tbody>{datos.filas.map(f => <tr key={f.finalidad}><td>{etiquetas[f.finalidad]}</td><td className="der">{numero(f.llamadas, locale)}</td><td className="der">{numero(f.cache_hits, locale)}</td><td className="der">{currency(f.pagado_usd)}</td></tr>)}</tbody></table></Bloque>
      <Bloque titulo={t("admin_cost_breakdown_title")}><table className="adm-tabla"><thead><tr><th>{t("admin_cost_part")}</th><th className="der">{t("admin_cost_calls_column")}</th><th className="der">{t("admin_cost_spend")}</th></tr></thead><tbody>{datos.desglose.map(p => <tr key={`${p.parte}-${p.detalle}`}><td>{[partes[p.parte], ...(p.detalle?.split(" / ") ?? [])].join(" · ")}</td><td className="der">{numero(p.llamadas, locale)}</td><td className="der">{currency(p.pagado_usd)}</td></tr>)}</tbody></table></Bloque>
    </>}
  </Pagina>;
}

export default function CosteIAAdmin() {
  return (
    <AuthGate>
      <CosteIAPanel />
    </AuthGate>
  );
}
