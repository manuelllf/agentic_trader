"use client";

import { useTranslations } from "next-intl";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { MarcoCuenta } from "../MarcoCuenta";
import { AvisosCuenta } from "../AvisosCuenta";

export default function Avisos() {
  const t = useTranslations();
  const { email } = useSesionRequerida("/cuenta/avisos");
  return <MarcoCuenta titulo={t("account_avisos")}><AvisosCuenta email={email} /></MarcoCuenta>;
}
