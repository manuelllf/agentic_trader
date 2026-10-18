"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { Posicion } from "@/lib/liga/api";
import { fecha, porcentaje } from "@/lib/liga/format";
import { ListaEmpresas } from "./ListaEmpresas";

export function CarteraOmega({ posiciones }: { posiciones: Posicion[] }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [ticker, setTicker] = useState<string | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const posicion = posiciones.find(p => p.ticker === ticker);
  useEffect(() => {
    const d = dialogo.current;
    if (!posicion || !d) return;
    d.showModal();
    const desbordamiento = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { d.close(); document.body.style.overflow = desbordamiento; };
  }, [posicion]);

  if (posiciones.length === 0) return null;

  return <>
    <ListaEmpresas conPrecio columnaRetorno={t("strategies_col_since_entry")} alAbrir={setTicker}
      filas={posiciones.map(p => ({
        ticker: p.ticker, peso: p.peso ?? 0, precio: p.precio ?? null, retorno: p.retorno ?? null,
      }))} />
    <dialog ref={dialogo} className="lecturas-modal empresa-modal" aria-label={t("strategies_company_dialog", { ticker: ticker ?? "" })} onCancel={() => setTicker(null)}>
      <header className="lecturas-cab"><h2>{ticker}</h2><button type="button" className="lecturas-cerrar" autoFocus aria-label={t("strategies_close_company")} onClick={() => setTicker(null)}>×</button></header>
      <div className="lecturas-cuerpo">{posicion && <>
        <p>{t("strategies_price_label")}: {posicion.precio == null ? "-" : posicion.precio.toLocaleString(locale)}</p>
        <p>{t("strategies_since_entry_return")}: {posicion.retorno == null ? "-" : porcentaje(posicion.retorno, 1, locale)}</p>
        <p className="fine">{t("strategies_omega_entry_line", {
          date: posicion.entrada_dia == null ? "-" : fecha(posicion.entrada_dia, undefined, locale),
          price: posicion.entrada_precio == null ? "-" : posicion.entrada_precio.toLocaleString(locale),
        })}</p>
        {posicion.salida_dia != null && <p className="fine">{t("strategies_omega_exit_line", {
          date: fecha(posicion.salida_dia, undefined, locale),
          price: posicion.salida_precio == null ? "-" : posicion.salida_precio.toLocaleString(locale),
        })}</p>}
      </>}</div>
    </dialog>
  </>;
}
