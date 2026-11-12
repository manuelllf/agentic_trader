"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Hoja } from "../_ui/Hoja";

/** La hoja «Tu cartera hoy» que abre la barra de abajo: solo se cierra, no cambia nada. */
export function CarteraHoja({ abierta, onCerrar, children }: { abierta: boolean; onCerrar: () => void; children: ReactNode }) {
  const t = useTranslations();
  return <Hoja abierta={abierta} titulo={t("builder_live_title")} accion={t("builder_listo")} onCerrar={onCerrar}>
    <div className="cr-hoja-pad">{children}</div>
  </Hoja>;
}
