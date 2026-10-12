"use client";

import { useEffect, useState } from "react";
import type { Yo } from "@/lib/liga/api";
import { abrirPago, leerSuscripcion, type Suscripcion } from "@/lib/liga/pagos";
import { PlanCuentaVista } from "./PlanCuentaVista";

export function PlanCuenta({ yo }: { yo: Yo }) {
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);

  useEffect(() => {
    let vigente = true;
    setSuscripcion(null);
    if (yo.plan_pago) {
      leerSuscripcion().then((res) => {
        if (vigente) setSuscripcion("error" in res ? null : res);
      });
    }
    return () => { vigente = false; };
  }, [yo.plan_pago]);

  return <PlanCuentaVista yo={yo} suscripcion={suscripcion} comprar={abrirPago} />;
}
