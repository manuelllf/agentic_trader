"use client";

import { notFound } from "next/navigation";
import { PLANES_VISIBLES } from "@/lib/liga/planes";
import { PaginaCuenta } from "../PaginaCuenta";

export default function PlanPagina() {
  if (!PLANES_VISIBLES) notFound();
  return <PaginaCuenta pantalla="plan" />;
}
