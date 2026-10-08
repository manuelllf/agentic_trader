"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { ArteAcceso } from "./ArteAcceso";
import { Marca } from "./Marca";

export function MarcoAcceso({ pestana, children, modo = "completo" }: {
  pestana: "entrar" | "crear"; children: ReactNode; modo?: "completo" | "codigo";
}) {
  const t = useTranslations();
  const codigo = modo === "codigo";
  return <main className={`sencilla acc${codigo ? " acc-codigo" : ""}`}>
    {!codigo && <ArteAcceso variante="fondo" />}
    <div className="acc-portada">
      <header className="sencilla-top">
        <Link href="/" className="wordmark"><Marca /></Link>
        <LanguageSelector />
      </header>
      <section className="acc-intro" aria-labelledby="acc-titular">
        {codigo ? <h1 id="acc-titular">{t("auth_tu_codigo")}</h1> : <>
          <ArteAcceso variante="bloque" />
          <h1 id="acc-titular">
            <span className="acc-t-movil">{t(pestana === "entrar" ? "auth_entrar" : "auth_crear_cuenta")}</span>
            <span className="acc-t-esc">{t("auth_titular")}</span>
          </h1>
          <p className="acc-sub">{t("auth_subtitulo")}</p>
          <ul className="acc-puntos">
            <li>{t("auth_punto_1")}</li>
            <li>{t("auth_punto_2")}</li>
            <li>{t("auth_punto_3")}</li>
          </ul>
        </>}
      </section>
    </div>
    <div className="acc-panel">
      {!codigo && <nav className="acc-seg" aria-label={t("auth_pestanas")}>
        <Link href="/entrar" className={pestana === "entrar" ? "on" : undefined}
          aria-current={pestana === "entrar" ? "page" : undefined}>{t("auth_entrar")}</Link>
        <Link href="/registrar" className={pestana === "crear" ? "on" : undefined}
          aria-current={pestana === "crear" ? "page" : undefined}>{t("auth_crear_cuenta")}</Link>
      </nav>}
      {children}
      {!codigo && <p className="acc-cambio">
        {t(pestana === "entrar" ? "auth_sin_cuenta_pregunta" : "auth_con_cuenta_pregunta")}{" "}
        <Link href={pestana === "entrar" ? "/registrar" : "/entrar"}>
          {t(pestana === "entrar" ? "auth_crear_cuenta" : "auth_entrar")}
        </Link>
      </p>}
      <footer className="acc-pie">
        {codigo ? <p>{t("auth_codigo_cambia")}</p> : <>
          <p>{t("auth_pie_papel")}</p>
          <div><Link href="/legal/terminos">{t("auth_terminos")}</Link><span aria-hidden="true"> · </span>
            <Link href="/legal/privacidad">{t("auth_privacidad")}</Link></div>
        </>}
      </footer>
    </div>
  </main>;
}
