"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { miles, porcentaje } from "@/lib/liga/format";

export type EmpresaViva = { ticker: string; nombre: string | null; peso: number };
export type CarteraVivaProps = {
  elegidas: EmpresaViva[]; pasan: number | null; huecos: number;
  entran: string[]; salen: EmpresaViva[];
};

export function CarteraViva({ elegidas, pasan, huecos, entran, salen }: CarteraVivaProps) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [recientes, setRecientes] = useState(true);
  useEffect(() => {
    setRecientes(true);
    const timer = setTimeout(() => setRecientes(false), 6000);
    return () => clearTimeout(timer);
  }, [entran, salen]);
  return <section className="cartera-viva" aria-label={t("builder_live_title")}>
    <h2>{t("builder_live_title")}</h2>
    <p className="fine num">{t("builder_live_count", { selected: miles(elegidas.length, locale), passed: pasan === null ? "—" : miles(pasan, locale) })}</p>
    <ul>
      {elegidas.map(e => <li key={e.ticker} className={recientes && entran.includes(e.ticker) ? "entra" : undefined}>
        <b className="num">{e.ticker}</b><span>{e.nombre ?? e.ticker}</span>
        <span className="num">{porcentaje(e.peso, 1, locale).replace(/^\+/, "")}</span>
      </li>)}
      {recientes && salen.map(e => <li key={e.ticker} className="sale">
        <s className="num">{e.ticker}</s><s>{e.nombre ?? e.ticker}</s><span>{t("builder_live_leaves")}</span>
      </li>)}
      {huecos > 0 && <li className="hueco"><span>—</span><span>{t("builder_live_cash", { count: huecos })}</span></li>}
    </ul>
  </section>;
}
