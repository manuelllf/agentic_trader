"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ProductoPago } from "@/lib/liga/pagos";

export type PlanPro = "mensual" | "media_temporada" | "temporada";
type Clave = "mensual" | "media" | "temporada" | "liga";

/** Parte de la clave del catálogo (`planes_<clave>_nombre`, `_precio`, `_periodo`, `_detalle`) de cada producto. */
export const CLAVE_PLAN: Record<ProductoPago, Clave> = {
  mensual: "mensual", media_temporada: "media", temporada: "temporada", pack_liga: "liga",
};
export const PLANES_PRO: PlanPro[] = ["mensual", "media_temporada", "temporada"];

/** Las cuatro opciones de compra, las mismas en la cuenta y en la página pública de planes; cada
 *  pantalla pone la acción de la fila (botón de pago o enlace). */
export function ListaPlanes({ accion }: { accion: (producto: ProductoPago) => ReactNode }) {
  const t = useTranslations();
  return (
    <ul className="cuenta-plan-lista">
      {PLANES_PRO.map((p) => (
        <li key={p} className="cuenta-plan-fila">
          <span className="cuenta-plan-fila-texto">
            <span className="cuenta-plan-fila-nombre">
              {t("planes_pro_titulo", { duracion: t(`planes_${CLAVE_PLAN[p]}_nombre` as Parameters<typeof t>[0]) })}
            </span>
            <span className="cuenta-plan-fila-detalle">
              {t(`planes_${CLAVE_PLAN[p]}_detalle` as Parameters<typeof t>[0])}
            </span>
          </span>
          {accion(p)}
        </li>
      ))}
      <li className="cuenta-plan-fila">
        <span className="cuenta-plan-fila-texto">
          <span className="cuenta-plan-fila-nombre">{t("planes_liga_nombre")}</span>
          <span className="cuenta-plan-fila-detalle">{t("planes_liga_detalle")}</span>
        </span>
        {accion("pack_liga")}
      </li>
    </ul>
  );
}
