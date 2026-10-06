"use client";

// Portada sin sesión: una pantalla que se juega sola, con un único ejemplo rotulado como tal.
// Con sesión no enseña nada y redirige a /liga, sin parpadeo.

import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import Link from "next/link";
import { Escena } from "./_portada/Escena";
import { ejemploLocalizado } from "./_portada/ideas";
import { useRedirigirSiHaySesion } from "./_sesion/SesionContext";
import { Marca } from "./_ui/Marca";

export default function Portada() {
  const t = useTranslations();
  const sesion = useRedirigirSiHaySesion();

  if (sesion !== "fuera") return null;

  return (
    <main className="lnd">
      <header className="lnd-top">
        <span className="wordmark"><Marca /></span>
        <nav className="lnd-nav"><LanguageSelector />
          <Link href="/liga" className="btn discreto small">{t("landing_ver_liga")}</Link>
          <Link href="/entrar" className="btn discreto small">{t("landing_entrar")}</Link>
        </nav>
      </header>

      <div className="lnd-cab">
        <h1>{t("landing_titular")}</h1>
        <p className="lnd-sub">
          {t("landing_descripcion")}
        </p>
      </div>

      <div className="lnd-centro">
        <Escena idea={ejemploLocalizado(t)} />
      </div>

      <div className="lnd-cta">
        <Link href="/entrar?next=/crear" className="btn pri">{t("landing_crea_tuya")}</Link>
      </div>

      <p className="lnd-legal">
        <span>{t("landing_aviso_ejemplo")}</span>
        <Link href="/como-funciona">{t("landing_como_funciona")}</Link>
        <Link href="/legal/aviso">{t("landing_aviso_legal")}</Link>
        <Link href="/legal/privacidad">{t("landing_privacidad")}</Link>
        <Link href="/legal/terminos">{t("landing_terminos")}</Link>
        <Link href="/legal/cookies">{t("landing_cookies")}</Link>
      </p>
    </main>
  );
}
