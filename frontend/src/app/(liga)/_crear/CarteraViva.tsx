"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { miles, porcentaje } from "@/lib/liga/format";

export type EmpresaViva = { ticker: string; nombre: string | null; peso: number; sector?: string | null };
export type CarteraVivaProps = {
  elegidas: EmpresaViva[]; pasan: number | null; huecos: number;
  entran: string[]; salen: EmpresaViva[]; cajaPct?: number | null;
  sectores?: Record<string, string>;
};

/** Tu cartera de hoy en filas: las que acaban de entrar en petróleo y las que salen tachadas unos segundos. */
export function CarteraViva({ elegidas, pasan, huecos, entran, salen, cajaPct, sectores = {} }: CarteraVivaProps) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [recientes, setRecientes] = useState(true);
  useEffect(() => {
    setRecientes(true);
    const timer = setTimeout(() => setRecientes(false), 6000);
    return () => clearTimeout(timer);
  }, [entran, salen]);
  const peso = (v: number) => porcentaje(v, 0, locale).replace(/^\+/, "");
  const baldosa = (ticker: string, entra = false) =>
    <span className={`cr-tile${entra ? " entra" : ""}${ticker.length >= 5 ? " largo" : ""}`} aria-hidden="true">{ticker}</span>;
  return <section className="cartera-viva" aria-label={t("builder_live_title")}>
    <p className="cr-valor-sub num" style={{ marginTop: 4 }}>{t("builder_live_count", { selected: miles(elegidas.length, locale), passed: pasan === null ? "–" : miles(pasan, locale) })}</p>
    <ul className="cr-grupo" style={{ marginTop: 12 }}>
      {elegidas.map(e => {
        const entra = recientes && entran.includes(e.ticker);
        return <li key={e.ticker} className={`cr-celda con-tile${entra ? " entra" : ""}`}>{baldosa(e.ticker, entra)}
          <span className="t"><b className="normal">{e.nombre ?? e.ticker}</b>{e.sector && <small>{sectores[e.sector] ?? e.sector}</small>}</span>
          <span className="valor ink num">{peso(e.peso)}</span><span /></li>;
      })}
      {recientes && salen.map(e => <li key={e.ticker} className="cr-celda con-tile sale">{baldosa(e.ticker)}
        <span className="t"><b className="normal"><s>{e.ticker}</s> <s>{e.nombre ?? ""}</s></b></span>
        <span className="valor">{t("builder_live_leaves")}</span><span /></li>)}
      {huecos > 0 && <li className="cr-celda con-tile hueco"><span className="cr-tile" aria-hidden="true">–</span>
        <span className="t"><b className="normal suave">{t("builder_live_cash", { count: huecos })}</b></span>
        <span className="valor num">{cajaPct != null ? peso(cajaPct) : ""}</span><span /></li>}
      {!elegidas.length && !huecos && <li className="cr-celda"><span className="t"><small>{t("builder_cartera_viva_vacia")}</small></span></li>}
    </ul>
    <p className="cr-pie">{t("builder_cartera_viva_pie")}</p>
  </section>;
}
