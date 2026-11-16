"use client";

// Los precios de una señal y su distancia al máximo y al último pico: los usa la pantalla de la señal y la hoja del historial.
import { useTranslations } from "next-intl";
import { dolares } from "../../_marco/formato";
import { Celda, Grupo } from "../../_panel/ui";
import { distAth, distPicoLocal, fmtRet } from "../helpers";
import { tonoRet, useIdioma } from "./ui";
import type { Senal } from "../types";

export function GrupoPrecios({ s, precioMostrado, etiquetaHoy, retorno, conCoste }:
  { s: Senal; precioMostrado: number; etiquetaHoy: string; retorno: number; conCoste?: boolean }) {
  const t = useTranslations();
  const locale = useIdioma();
  const da = distAth(s);
  const dp = distPicoLocal(s);
  const dolar = (n: number | string) => dolares(n, locale);
  return (
    <Grupo cabecera={t("pnl_omega_precios")}>
      <Celda titulo={t("omega_ui_senal_titulo")} valor={dolar(s.entry_price)} />
      {conCoste && s.posicion_abierta && <Celda titulo={t("pnl_omega_coste_medio")} valor={dolar(s.posicion_abierta.coste_medio)} />}
      <Celda titulo={etiquetaHoy} valor={dolar(precioMostrado)} />
      <Celda titulo={t("omega_ui_retorno")} valor={<span className={tonoRet(retorno)}>{fmtRet(retorno, locale)}</span>} />
      <Celda titulo={t("pnl_omega_bajo_referencia", { referencia: s.ref_label === "ATH_referencia" ? "ATH" : t("omega_last_peak") })}
        valor={<span className="po-mal">{fmtRet(-Number(s.caida_pct), locale)}</span>} subtitulo={dolar(s.ref_price)} />
      {da != null && <Celda titulo={t("pnl_omega_bajo_ath")} valor={<span className="po-mal">{fmtRet(-da, locale)}</span>} subtitulo={dolar(s.ath!)} />}
      {dp != null && <Celda titulo={t("pnl_omega_bajo_pico")} valor={<span className="po-mal">{fmtRet(-dp, locale)}</span>} subtitulo={dolar(s.ref_price_pico!)} />}
    </Grupo>
  );
}
