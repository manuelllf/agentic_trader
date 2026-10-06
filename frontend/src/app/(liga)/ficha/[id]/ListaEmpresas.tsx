"use client";

import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { claseSigno, porcentaje } from "@/lib/liga/format";

export type EmpresaFila = {
  ticker: string;
  peso: number;
  /** Solo hay columna de precio si alguna fila lo trae. */
  precio?: number | null;
  retorno: number | null;
};

/** Cartera de una estrategia: una línea por empresa y cabecera de columnas. */
export function ListaEmpresas({ filas, conPrecio, columnaRetorno, alAbrir }: {
  filas: EmpresaFila[];
  conPrecio: boolean;
  /** Título de la última columna: «Mes» con cotizaciones del mes, «Periodo» con el retorno de la foto. */
  columnaRetorno: string;
  alAbrir: (ticker: string) => void;
}) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const peso = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <div className={`cartera-lista${conPrecio ? " con-precio" : ""}`}>
      <div className="cartera-cab" aria-hidden="true">
        <span>{t("strategies_company")}</span><span>{t("strategies_weight")}</span>
        {conPrecio && <span>{t("strategies_price")}</span>}<span>{columnaRetorno}</span>
      </div>
      {filas.map((f) => (
        <button type="button" className="cartera-fila" key={f.ticker} onClick={() => alAbrir(f.ticker)}>
          <b>{f.ticker}</b>
          <span className="num">{peso.format(f.peso)} %</span>
          {conPrecio && <span className="num">{f.precio == null ? "—" : f.precio.toLocaleString(locale, { maximumFractionDigits: 4 })}</span>}
          <span className={`num ret ${f.retorno == null ? "fl" : claseSigno(f.retorno)}`}>
            {f.retorno == null ? "—" : porcentaje(f.retorno, 1, locale)}
          </span>
        </button>
      ))}
    </div>
  );
}
