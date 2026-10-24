"use client";

// Portada sin sesión: una escena que corre sola al entrar y cabe justa en la pantalla, con un único
// ejemplo rotulado como tal. Con sesión no enseña nada y redirige a /liga, sin parpadeo.

import { PLANES_VISIBLES } from "@/lib/liga/planes";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { useRedirigirSiHaySesion } from "../_sesion/SesionContext";
import { Marca } from "../_ui/Marca";
import { Pelicula } from "./Pelicula";

export function Portada({ criptico }: { criptico: boolean }) {
  const t = useTranslations();
  const idioma = useLocale();
  const sesion = useRedirigirSiHaySesion();

  if (sesion !== "fuera") return null;

  return (
    <main className="pel-portada">
      <header className="pel-cabecera">
        <span className="wordmark"><Marca /></span>
        <nav><LanguageSelector />
          <Link href="/liga" className="pel-enlace pel-solo-escritorio">{t("landing_ver_liga")}</Link>
          {criptico && <Link href={idioma === "en" ? "/en/criptico" : "/criptico"} className="pel-enlace pel-solo-escritorio">{t("landing_criptico")}</Link>}
          {PLANES_VISIBLES && (<Link href="/planes" className="pel-enlace pel-solo-escritorio">{t("landing_planes")}</Link>)}
          <Link href="/entrar" className="pel-enlace">{t("landing_entrar")}</Link>
          <Link href="/entrar?next=/crear" className="pel-btn small pri">{t("landing_crea_tuya")}</Link>
        </nav>
      </header>

      <Pelicula />
    </main>
  );
}
