"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { SelectorIdioma } from "@/components/SelectorIdioma";
import { useLanguage } from "@/i18n/Provider";
import { Marca } from "./Marca";
import "./acceso-v3.css";

/* Entrar, crear cuenta y el código de verificación: marca e idioma arriba, las pestañas, el formulario
   y lo legal abajo. Sin planes ni propuesta de valor: quien se registra solo ve lo que necesita.
   Los trámites (confirmar, recuperar, completar) conservan su diseño anterior. */
export function MarcoAcceso({ pestana, children, modo = "completo", titular, sinCambio = false }: {
  pestana?: "entrar" | "crear"; children: ReactNode; modo?: "completo" | "codigo" | "tramite"; titular?: string;
  // La persona aún no puede entrar hasta confirmar el correo.
  sinCambio?: boolean;
}) {
  const t = useTranslations();
  const { locale, changing, selectLocale } = useLanguage();
  const tramite = modo === "tramite";
  const sinPestanas = modo !== "completo";
  const claseTitulo = tramite ? undefined : modo === "codigo" ? "v3-codigo-titulo" : "v3-sr";
  return <main className={`acc${tramite ? " acc-solo" : " acc-v3"}`}>
    <header className={tramite ? "acc-cabecera" : "v3-cabecera"}>
      <Link href="/" className="wordmark"><Marca /></Link>
      <SelectorIdioma actual={locale} etiqueta={t("auth_idioma")} deshabilitado={changing} onElegir={selectLocale} />
    </header>
    <div className="acc-centro">
      <h1 id="acc-titular" className={claseTitulo}>
        {sinPestanas ? (titular ?? t("auth_tu_codigo")) : t(pestana === "entrar" ? "auth_entrar" : "auth_crear_cuenta")}
      </h1>
      {!sinPestanas && !sinCambio && <nav className="v3-seg" data-activo={pestana} aria-label={t("auth_pestanas")}>
        <span className="v3-pulgar" aria-hidden="true" />
        <Link href="/entrar" aria-current={pestana === "entrar" ? "page" : undefined}>{t("auth_entrar")}</Link>
        <Link href="/registrar" aria-current={pestana === "crear" ? "page" : undefined}>{t("auth_crear_cuenta")}</Link>
      </nav>}
      <div className="acc-formulario">{children}</div>
    </div>
    <footer className="acc-pie-pagina v3-pie">
      <nav aria-label={t("auth_legal")}>
        <Link href="/legal/terminos">{t("auth_terminos")}</Link>
        <Link href="/legal/privacidad">{t("auth_privacidad")}</Link>
        <Link href="/legal/cookies">{t("auth_cookies")}</Link>
      </nav>
      <p>{t("auth_pie_papel")}</p>
    </footer>
  </main>;
}
