"use client";

import { useEffect, useId, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Lectura } from "@/lib/liga/api";
import { richText } from "@/lib/richText";
import { esInformeEnEspanol, textoInforme } from "./informe";

export function LecturasModal({ abierto, tickers, activo, lecturas, leyendo, error, onSeleccionar, onCerrar }: {
  abierto: boolean; tickers: string[]; activo: string | null; lecturas: Lectura[];
  leyendo: string | null; error: string | null;
  onSeleccionar: (ticker: string) => void; onCerrar: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useId();
  const informe = lecturas.find((l) => l.ticker === activo);
  useEffect(() => {
    const d = dialogo.current;
    if (!abierto || !d) return;
    d.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { d.close(); document.body.style.overflow = overflow; };
  }, [abierto]);

  return (
    <dialog ref={dialogo} className="lecturas-modal" aria-labelledby={titulo}
      onCancel={onCerrar}>
      <header className="lecturas-cab">
        <div>
          <p className="lecturas-kicker">{t("builder_reading_notebook")}</p>
          <h2 id={titulo}>{tickers.length > 1 ? t("builder_portfolio_in_depth") : activo}</h2>
        </div>
        <button type="button" className="lecturas-cerrar" onClick={onCerrar} autoFocus aria-label={t("builder_close_report")}>×</button>
      </header>
      {tickers.length > 1 && (
        <nav className="lecturas-selector" aria-label={t("builder_portfolio_reports")}>
          {tickers.map((ticker) => <button type="button" key={ticker} aria-pressed={activo === ticker}
            onClick={() => onSeleccionar(ticker)}>{ticker}{lecturas.some((l) => l.ticker === ticker) && <span aria-label={t("builder_report_available")}> ·</span>}</button>)}
        </nav>
      )}
      <div className="lecturas-cuerpo" key={activo}>
        {leyendo && <p className="lecturas-estado" role="status">{t("builder_preparing_reports", { ticker: leyendo, ready: lecturas.length, total: tickers.length })}</p>}
        {error && <p className="lecturas-error" role="alert">{error}</p>}
        {informe ? (
          <article>
            <p className="lecturas-kicker">{informe.ticker} / {t("builder_report")}</p>
            {locale === "en" && esInformeEnEspanol(informe.texto) && <p className="lecturas-nota">{t("builder_report_in_spanish")}</p>}
            <div className="lecturas-texto">{richText(textoInforme(informe.texto, locale))}</div>
            <footer className="lecturas-nota">{t("builder_report_disclaimer")}</footer>
          </article>
        ) : <p className="lecturas-vacio">{leyendo ? t("builder_report_will_appear") : t("builder_report_not_available")}</p>}
      </div>
    </dialog>
  );
}
