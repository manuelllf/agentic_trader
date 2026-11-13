"use client";

import { useTranslations } from "next-intl";
import { PLANES_VISIBLES } from "@/lib/liga/planes";
import { useSesion } from "../_sesion/SesionContext";
import { PlanCuenta } from "./PlanCuenta";
import { BarraCuenta, CuerpoCuenta } from "./marco";

export function PlanPantalla() {
  const t = useTranslations();
  const { yo } = useSesion();
  if (!PLANES_VISIBLES || !yo) return null;
  return <>
    <BarraCuenta titulo={t("account_grupo_plan")} />
    <CuerpoCuenta><PlanCuenta yo={yo} /></CuerpoCuenta>
  </>;
}
