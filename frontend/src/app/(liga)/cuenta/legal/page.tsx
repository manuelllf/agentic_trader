"use client";

import { useTranslations } from "next-intl";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { MarcoCuenta } from "../MarcoCuenta";
import { FilaCuenta } from "../CuentaHub";

export default function LegalCuenta() {
  const t = useTranslations();
  useSesionRequerida("/cuenta/legal");
  return <MarcoCuenta titulo={t("account_legal")}>
    <ul className="ajustes-lista">
      <FilaCuenta href="/legal/aviso" nombre={t("account_aviso_legal")} />
      <FilaCuenta href="/legal/privacidad" nombre={t("account_privacidad")} />
      <FilaCuenta href="/legal/terminos" nombre={t("account_terminos")} />
      <FilaCuenta href="/legal/cookies" nombre={t("account_cookies")} />
    </ul>
  </MarcoCuenta>;
}
