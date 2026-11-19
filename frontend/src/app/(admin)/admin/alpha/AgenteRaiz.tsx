"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Segmentado } from "../_panel/ui";
import { Pagina } from "./Comun";
import VistaAgente from "./VistaAgente";
import VistaControl from "./VistaControl";
import VistaHoy from "./VistaHoy";
import VistaInformes from "./VistaInformes";
import { VISTAS, type Vista } from "./vistas";

/** Raíz de la sala: cuatro vistas bajo un segmentado. La vista queda en la dirección para poder volver a ella. */
export default function AgenteRaiz({ inicial = "hoy" }: { inicial?: Vista }) {
  const t = useTranslations();
  const [vista, setVista] = useState<Vista>(inicial);
  const cambiar = (v: Vista) => {
    setVista(v);
    try { window.history.replaceState(null, "", v === "hoy" ? "/admin/alpha" : `/admin/alpha?v=${v}`); } catch { /* sin historial */ }
  };
  return (
    <Pagina>
      <Segmentado etiquetaGrupo={t("pnl_agente_vista_aria")} valor={vista} onChange={cambiar}
        opciones={VISTAS.map(v => ({ valor: v, etiqueta: t(`pnl_agente_vista_${v}`) }))} />
      {vista === "hoy" && <VistaHoy />}
      {vista === "informes" && <VistaInformes />}
      {vista === "agente" && <VistaAgente />}
      {vista === "control" && <VistaControl />}
    </Pagina>
  );
}
