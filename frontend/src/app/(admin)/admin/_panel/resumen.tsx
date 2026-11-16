"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { get } from "@/lib/api";
import type { ResumenAdminOut } from "../liga/resumen/Resumen";
import type { ClaveSeccion } from "./salas";

// Una sola llamada al resumen para el raíl (cuentas) y para el inicio de Vennett (valores y pendientes).
export interface EstadoResumen {
  datos: ResumenAdminOut | null;
  fallo: boolean;
}

const Contexto = createContext<EstadoResumen>({ datos: null, fallo: false });

export function useResumenPanel(): EstadoResumen {
  return useContext(Contexto);
}

/** Suma los pendientes del endpoint por sección del panel. */
export function cuentasPorSeccion(pendientes: ResumenAdminOut["pendientes"]): Partial<Record<ClaveSeccion, number>> {
  const cuentas: Partial<Record<ClaveSeccion, number>> = {};
  for (const p of pendientes) cuentas[p.seccion] = (cuentas[p.seccion] ?? 0) + p.cuantos;
  return cuentas;
}

/** Se vuelve a pedir en cada cambio de ruta, para que las cuentas del raíl sigan al día. */
export function ResumenPanelProvider({ ruta, children }: { ruta: string; children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoResumen>({ datos: null, fallo: false });
  useEffect(() => {
    let vigente = true;
    get<ResumenAdminOut>("/liga/admin/panel/resumen")
      .then(datos => { if (vigente) setEstado({ datos, fallo: false }); })
      .catch(() => { if (vigente) setEstado({ datos: null, fallo: true }); });
    return () => { vigente = false; };
  }, [ruta]);
  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>;
}
