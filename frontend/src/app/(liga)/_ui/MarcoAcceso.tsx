"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { ArteAcceso } from "./ArteAcceso";
import { Marca } from "./Marca";

/* Entrar, crear cuenta y los trámites: cabecera con la marca y el idioma, el formulario centrado
   y un pie con lo legal. Sin planes ni propuesta de valor: quien se registra solo ve lo que necesita. */
export function MarcoAcceso({ pestana, children, modo = "completo", titular }: {
  pestana?: "entrar" | "crear"; children: ReactNode; modo?: "completo" | "codigo" | "tramite"; titular?: string;
}) {
  const t = useTranslations();
  const codigo = modo === "codigo";
  const solo = modo !== "completo";
  return <main className={`acc${solo ? " acc-solo" : ""}`}>
    {!solo && <ArteAcceso variante="fondo" />}
    <header className="acc-cabecera">
      <Link href="/" className="wordmark"><Marca /></Link>
      <LanguageSelector />
    </header>
    <div className="acc-centro">
      <h1 id="acc-titular">{solo ? (titular ?? t("auth_tu_codigo")) : t(pestana === "entrar" ? "auth_entrar" : "auth_crear_cuenta")}</h1>
      {!solo && <nav className="acc-seg" aria-label={t("auth_pestanas")}>
        <Link href="/entrar" className={pestana === "entrar" ? "on" : undefined}
          aria-current={pestana === "entrar" ? "page" : undefined}>{t("auth_entrar")}</Link>
        <Link href="/registrar" className={pestana === "crear" ? "on" : undefined}
          aria-current={pestana === "crear" ? "page" : undefined}>{t("auth_crear_cuenta")}</Link>
      </nav>}
      <div className="acc-formulario">{children}</div>
      {!solo && <p className="acc-cambio">
        {t(pestana === "entrar" ? "auth_sin_cuenta_pregunta" : "auth_con_cuenta_pregunta")}{" "}
        <Link href={pestana === "entrar" ? "/registrar" : "/entrar"}>
          {t(pestana === "entrar" ? "auth_crear_cuenta" : "auth_entrar")}
        </Link>
      </p>}
    </div>
    <footer className="acc-pie-pagina">
      {codigo ? <p>{t("auth_codigo_cambia")}</p> : <>
        <nav aria-label={t("auth_legal")}>
          <Link href="/legal/terminos">{t("auth_terminos")}</Link>
          <Link href="/legal/privacidad">{t("auth_privacidad")}</Link>
          <Link href="/legal/cookies">{t("auth_cookies")}</Link>
        </nav>
        <p>{t("auth_pie_papel")}</p>
      </>}
    </footer>
  </main>;
}
