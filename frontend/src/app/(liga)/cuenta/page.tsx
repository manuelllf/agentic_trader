"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { Marca } from "../_ui/Marca";
import { CuentaHub } from "./CuentaHub";
import { EstadoCuenta } from "./MarcoCuenta";

export default function Cuenta() {
  const t = useTranslations();
  const { yo, email } = useSesionRequerida("/cuenta");
  return <main className="sencilla">
    <header className="sencilla-top">
      <Link href="/" className="wordmark"><Marca /></Link><LanguageSelector />
    </header>
    <section className="sencilla-cuerpo arriba" aria-labelledby="titular">
      <h1 id="titular">{t("account_tu_cuenta")}</h1>
      <EstadoCuenta>{yo && <CuentaHub yo={yo} email={email} />}</EstadoCuenta>
    </section>
  </main>;
}
