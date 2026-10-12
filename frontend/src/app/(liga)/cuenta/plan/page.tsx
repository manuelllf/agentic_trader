"use client";

import { useTranslations } from "next-intl";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { MarcoCuenta } from "../MarcoCuenta";
import { PlanCuenta } from "../PlanCuenta";

export default function Plan() {
  const t = useTranslations();
  const { yo } = useSesionRequerida("/cuenta/plan");
  return <MarcoCuenta titulo={t("account_grupo_plan")}>{yo && <PlanCuenta yo={yo} />}</MarcoCuenta>;
}
