"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { useSesion } from "../_sesion/SesionContext";
import { Cargando } from "../_ui/Cargando";
import { ErrorLiga } from "../_ui/ErrorLiga";
import { Marca } from "../_ui/Marca";

export function ChevronCuenta({ volver = false }: { volver?: boolean }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d={volver ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"} stroke="currentColor" strokeWidth="1.5" />
  </svg>;
}

export function EstadoCuenta({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { yo, yoFallo, refrescarYo } = useSesion();
  return yo ? children : yoFallo ? <ErrorLiga titulo={t("account_error_cargar")}
    mensaje={t("account_error_reintentar")}
    accion={{ texto: t("account_reintentar"), onClick: refrescarYo }} /> : <Cargando filas={2} />;
}

export function MarcoCuenta({ titulo, children }: { titulo: string; children: ReactNode }) {
  const t = useTranslations();
  return <main className="sencilla">
    <header className="sencilla-top">
      <Link href="/" className="wordmark"><Marca /></Link><LanguageSelector />
    </header>
    <section className="sencilla-cuerpo arriba" aria-labelledby="titular">
      <div className="ajustes">
        <Link href="/cuenta" className="ajustes-volver"><ChevronCuenta volver />{t("account_volver")}</Link>
        <h1 id="titular">{titulo}</h1>
        <EstadoCuenta>{children}</EstadoCuenta>
      </div>
    </section>
  </main>;
}
