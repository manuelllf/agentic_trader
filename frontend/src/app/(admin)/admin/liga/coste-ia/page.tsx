"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get } from "@/lib/api";
import { Barras, Celda, Esqueleto, Grupo, Progreso } from "../../_panel/ui";
import { dolares, fechaCorta, numero, porcentajeSimple } from "../../_marco/formato";
import { diasDelMes } from "./diasDelMes";
import { mesActual, moverMes, nombreMes } from "./mes";
import "./coste.css";

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

const ICO_ATRAS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;
const ICO_ADELANTE = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function CosteIAPanel() {
  const t = useTranslations();
  const locale = useLocale();
  const currency = (v: string | number) => dolares(v, locale);
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

  // Umbral de aviso configurado en Ajustes; si no llega, simplemente no hay aviso.
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

  const total = datos ? Number(datos.total_pagado_usd) : 0;
  const tope = datos?.tope_mensual_usd != null ? Number(datos.tope_mensual_usd) : null;
  const pctUsado = tope != null && tope > 0 ? total / tope * 100 : 0;
  const gastoAlto = tope != null && avisoPct != null && total >= tope * avisoPct / 100;
  const dias = datos ? diasDelMes(mes, datos.por_dia) : [];
  const diasConGasto = dias.filter(d => d.pagado > 0).length;

  return (
    <div className="pnl-llega">
      <Grupo>
        <li className="ps-mes">
          <button type="button" aria-label={t("pnl_sistema_coste_mes_anterior")} onClick={() => setMes(moverMes(mes, -1))}>{ICO_ATRAS}</button>
          <strong aria-live="polite">{nombreMes(mes, locale)}</strong>
          <button type="button" aria-label={t("pnl_sistema_coste_mes_siguiente")} disabled={mes >= mesActual()} onClick={() => setMes(moverMes(mes, 1))}>{ICO_ADELANTE}</button>
        </li>
      </Grupo>
      {fallo && <p className="pnl-pie-grupo" role="alert">{fallo}</p>}
      {!datos && !fallo && <Esqueleto filas={4} etiqueta={t("pnl_sistema_cargando")} />}
      {datos && (
        <>
          <div className="ps-cifra">
            <small>{t("pnl_sistema_coste_etiqueta", { mes: nombreMes(mes, locale) })}</small>
            <b>{currency(datos.total_pagado_usd)}</b>
            <p>{tope != null
              ? t("admin_cost_cap_summary", { cap: currency(datos.tope_mensual_usd!), pct: porcentajeSimple(pctUsado, locale) })
              : t("admin_cost_monthly_cap_unset")}</p>
          </div>
          {tope != null && (
            <ul className="pnl-grupo ps-sep">
              <li className={`ps-uso${gastoAlto ? " alto" : ""}`}>
                <div className="ps-uso-fila">
                  <span>{t("pnl_sistema_coste_usado")}</span>
                  <span>{gastoAlto ? t("admin_cost_over_pct", { pct: avisoPct! }) : porcentajeSimple(pctUsado, locale)}</span>
                </div>
                <Progreso valor={pctUsado} etiqueta={t("pnl_sistema_coste_usado")} />
              </li>
            </ul>
          )}

          <Grupo cabecera={t("admin_cost_purpose")}>
            {datos.filas.map(f => (
              <Celda key={f.finalidad} titulo={etiquetas[f.finalidad]} valor={currency(f.pagado_usd)}
                subtitulo={t("pnl_sistema_coste_llamadas", { llamadas: numero(f.llamadas, locale), cache: numero(f.cache_hits, locale) })} />
            ))}
          </Grupo>

          <Grupo cabecera={t("admin_cost_breakdown_title")}>
            {datos.desglose.map(p => (
              <Celda key={`${p.parte}-${p.detalle}`} titulo={[partes[p.parte], ...(p.detalle?.split(" / ") ?? [])].join(" · ")}
                valor={currency(p.pagado_usd)} subtitulo={t("pnl_sistema_coste_solo_llamadas", { llamadas: numero(p.llamadas, locale) })} />
            ))}
          </Grupo>

          <h2 className="pnl-cab-grupo">{t("admin_cost_por_dia_titulo")}</h2>
          {diasConGasto === 0
            ? <Grupo><Celda titulo={t("admin_cost_por_dia_vacio")} /></Grupo>
            : <Barras valores={dias.map(d => d.pagado)} etiquetas={[fechaCorta(`${mes}-01`, locale), fechaCorta(`${mes}-${String(dias.length).padStart(2, "0")}`, locale)]}
                etiquetaAria={t("pnl_sistema_coste_dia_aria", { resumen: t("admin_cost_por_dia_resumen", { total: currency(datos.total_pagado_usd), dias: diasConGasto }) })} />}
          <p className="pnl-pie-grupo">{avisoPct != null ? t("pnl_sistema_coste_pie", { pct: avisoPct }) : t("pnl_sistema_coste_pie_sin_aviso")}</p>
        </>
      )}
    </div>
  );
}

export default function CosteIAAdmin() {
  return (
    <AuthGate>
      <CosteIAPanel />
    </AuthGate>
  );
}
