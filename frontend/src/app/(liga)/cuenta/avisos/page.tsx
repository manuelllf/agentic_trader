"use client";

import { useTranslations } from "next-intl";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { MarcoCuenta } from "../MarcoCuenta";
import { AvisosDispositivo } from "../AvisosDispositivo";

export default function Avisos() {
  const t = useTranslations();
  useSesionRequerida("/cuenta/avisos");
  return <MarcoCuenta titulo={t("account_avisos")}><AvisosDispositivo /></MarcoCuenta>;
}
