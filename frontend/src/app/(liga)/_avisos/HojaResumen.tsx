"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Aviso } from "@/lib/liga/api";
import { porcentaje } from "@/lib/liga/format";
import type { Locale } from "@/i18n/locale";

export function HojaResumen({ aviso, onCerrar }: { aviso: Aviso; onCerrar: () => void }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const hoja = useRef<HTMLDivElement>(null);
  const numero = typeof aviso.datos.numero === "number" || typeof aviso.datos.numero === "string" ? aviso.datos.numero : "";
  const estrategia = typeof aviso.datos.estrategia === "string" ? aviso.datos.estrategia : "";
  const rent = aviso.datos.rentabilidad == null ? null : porcentaje(Number(aviso.datos.rentabilidad), 1, locale);
  const sp = aviso.datos.sp == null ? null : porcentaje(Number(aviso.datos.sp), 1, locale);
  const puesto = typeof aviso.datos.puesto_general === "number" ? aviso.datos.puesto_general : null;
  const provisional = aviso.datos.provisional === true;
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrarRef.current?.focus();
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
      if (e.key === "Tab") {
        const botones = hoja.current?.querySelectorAll<HTMLElement>("button, a[href]");
        const primero = botones?.[0];
        const ultimo = botones?.[botones.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
      }
    }
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("keydown", tecla); document.body.style.overflow = overflow; anterior?.focus(); };
  }, [onCerrar]);
  return <div className="cartera-hoja-velo" onClick={onCerrar}>
    <div ref={hoja} className="sheet cartera-hoja" role="dialog" aria-modal="true" aria-label={t("avisos_hoja_titulo", { numero })} onClick={e => e.stopPropagation()}>
      <div className="sheet-h"><button ref={cerrarRef} type="button" className="back" onClick={onCerrar}>{t("avisos_hoja_cerrar")}</button></div>
      <div className="sheet-b">
        <h2 className="hoja-res-t">{t("avisos_hoja_titulo", { numero })}</h2>
        <dl className="hoja-res">
          <div><dt>{t("avisos_hoja_estrategia")}</dt><dd>{estrategia || "-"}</dd></div>
          <div><dt>{t("avisos_hoja_rentabilidad")}</dt><dd className="num">{rent ?? "-"}</dd></div>
          <div><dt>{t("avisos_hoja_sp")}</dt><dd className="num">{sp ?? "-"}</dd></div>
          <div><dt>{t("avisos_hoja_puesto")}</dt><dd className="num">{puesto ?? "-"}</dd></div>
        </dl>
        {provisional && <p className="hoja-res-nota">{t("avisos_hoja_provisional")}</p>}
        <Link href="/mias" className="btn pri wide">{t("avisos_hoja_ir")}</Link>
      </div>
    </div>
  </div>;
}
