"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export function CarteraHoja({ abierta, onCerrar, children }: { abierta: boolean; onCerrar: () => void; children: ReactNode }) {
  const t = useTranslations();
  const cerrarRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!abierta) return;
    const anterior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrarRef.current?.focus();
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
      if (e.key === "Tab") { e.preventDefault(); cerrarRef.current?.focus(); }
    }
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("keydown", tecla); document.body.style.overflow = overflow; anterior?.focus(); };
  }, [abierta, onCerrar]);
  if (!abierta) return null;
  return <div className="cartera-hoja-velo" onClick={onCerrar}>
    <div id="cartera-hoja" className="sheet cartera-hoja" role="dialog" aria-modal="true" aria-label={t("builder_live_title")} onClick={e => e.stopPropagation()}>
      <div className="sheet-h"><button ref={cerrarRef} type="button" className="back" onClick={onCerrar}>{t("builder_live_close")}</button></div>
      <div className="sheet-b">{children}</div>
    </div>
  </div>;
}
