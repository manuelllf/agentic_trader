"use client";

import { useTranslations } from "next-intl";
import { BarraCuenta, CeldaEnlace, CuerpoCuenta, Grupo } from "./marco";

export function LegalCuenta() {
  const t = useTranslations();
  return <>
    <BarraCuenta titulo={t("account_legal")} />
    <CuerpoCuenta>
      <Grupo>
        <CeldaEnlace href="/legal/aviso" texto={t("account_aviso_legal")} />
        <CeldaEnlace href="/legal/privacidad" texto={t("account_privacidad")} />
        <CeldaEnlace href="/legal/terminos" texto={t("account_terminos")} />
        <CeldaEnlace href="/legal/cookies" texto={t("account_cookies")} />
        <CeldaEnlace href="/legal/bases-premio" texto={t("legal_bases_title")} />
      </Grupo>
    </CuerpoCuenta>
  </>;
}
