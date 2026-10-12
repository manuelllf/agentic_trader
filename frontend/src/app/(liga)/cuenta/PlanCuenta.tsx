"use client";

import { useEffect, useRef, useState } from "react";
import type { Yo } from "@/lib/liga/api";
import { abrirPago, cambiarPlan, cancelarSuscripcion, leerSuscripcion, reanudarSuscripcion,
  type ProductoPago, type Suscripcion } from "@/lib/liga/pagos";
import { useSesion } from "../_sesion/SesionContext";
import { PlanCuentaVista } from "./PlanCuentaVista";

export function PlanCuenta({ yo }: { yo: Yo }) {
  const { refrescarYo } = useSesion();
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);
  const [pedido, setPedido] = useState<{
    destino: Exclude<ProductoPago, "pack_liga">; intentos: number;
  } | null>(null);
  const refrescar = useRef(refrescarYo);
  useEffect(() => { refrescar.current = refrescarYo; }, [refrescarYo]);

  // El webhook confirma el cambio: la cuenta se relee hasta ver el nuevo producto.
  useEffect(() => {
    if (!pedido) return;
    if (yo.plan_pago === pedido.destino) { setPedido(null); return; }
    if (pedido.intentos >= 5) return;
    const id = window.setTimeout(() => {
      setPedido((p) => p ? { ...p, intentos: p.intentos + 1 } : p);
      refrescar.current();
    }, 3000);
    return () => window.clearTimeout(id);
  }, [pedido, yo.plan_pago]);

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

  async function gestionar(accion: typeof cancelarSuscripcion) {
    const res = await accion();
    if ("ok" in res) {
      refrescarYo();
      const lectura = await leerSuscripcion();
      setSuscripcion("error" in lectura ? null : lectura);
    }
    return res;
  }

  async function cambiar(producto: Exclude<ProductoPago, "pack_liga">) {
    const res = await cambiarPlan(producto);
    if ("ok" in res) setPedido({ destino: producto, intentos: 0 });
    return res;
  }

  return <PlanCuentaVista yo={yo} suscripcion={suscripcion} comprar={abrirPago}
    cambiar={cambiar} pedido={pedido !== null}
    cancelar={() => gestionar(cancelarSuscripcion)}
    reanudar={() => gestionar(reanudarSuscripcion)} />;
}
