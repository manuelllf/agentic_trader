"use client";

// Portada sin sesión: una escena que corre sola al entrar y cabe justa en la pantalla, con un único
// ejemplo rotulado como tal. Con sesión no enseña nada y redirige a /liga, sin parpadeo.

import { useTranslations } from "next-intl";
import Link from "next/link";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { useRedirigirSiHaySesion } from "../_sesion/SesionContext";
import { Marca } from "../_ui/Marca";
import { Pelicula } from "./Pelicula";

export function Portada() {
  const t = useTranslations();
  const sesion = useRedirigirSiHaySesion();

  if (sesion !== "fuera") return null;

  return (
    <main className="pel-portada">
      <header className="pel-cabecera">
        <span className="wordmark"><Marca /></span>
        <nav><LanguageSelector />
          <Link href="/liga" className="pel-enlace">
            <span className="largo">{t("landing_ver_liga")}</span><span className="corto">{t("landing_liga_corto")}</span>
          </Link>
          <Link href="/entrar" className="pel-btn small">{t("landing_entrar")}</Link>
        </nav>
      </header>

      <Pelicula />
    </main>
  );
}
