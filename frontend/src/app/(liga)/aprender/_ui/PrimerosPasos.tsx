"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { CicloAprender } from "@/lib/aprender";
import { getPrimerosPasos, type PrimerosPasos as EstadoPasos } from "@/lib/liga/api";
import { useSesion } from "../../_sesion/SesionContext";
import { Hora } from "./Hora";

function Check({ si }: { si: boolean }) {
  return <span className={`pg-check${si ? " si" : ""}`} aria-hidden="true">
    {si && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
  </span>;
}

export function PrimerosPasos({ ciclo }: { ciclo: CicloAprender | null }) {
  const { estado } = useSesion();
  const t = useTranslations();
  const [pasos, setPasos] = useState<EstadoPasos | null>(null);
  useEffect(() => {
    if (estado !== "dentro") return;
    let vivo = true;
    void getPrimerosPasos().then(r => { if (vivo && typeof r !== "string") setPasos(r); });
    return () => { vivo = false; };
  }, [estado]);
  if (estado !== "dentro" || !pasos || (pasos.estrategia && pasos.apuntada && pasos.jornada_cerrada)) return null;
  return <>
    <p className="cu-cab">{t("learn_pasos_titulo")}</p>
    <ul className="cu-grupo reqs">
      <li><div className="cu-celda req"><Check si /><span className="t"><b>{t("learn_paso_cuenta")}</b></span><span /><span /></div></li>
      <li><div className="cu-celda req"><Check si={pasos.estrategia} />
        <span className="t"><b>{t("learn_paso_estrategia")}</b><small>{t("learn_paso_estrategia_nota")}</small></span>
        {pasos.estrategia ? <span /> : <Link className="pg-mini" href="/crear">{t("learn_crear")}</Link>}<span /></div></li>
      <li><div className="cu-celda req"><Check si={pasos.apuntada} />
        <span className="t"><b>{t("learn_paso_apuntar")}</b>{ciclo && <small>{t.rich("learn_paso_apuntar_nota", { fecha: () => <Hora iso={ciclo.corte} formato="fecha" />, hora: () => <Hora iso={ciclo.corte} formato="hora" /> })}</small>}</span>
        <span /><span /></div></li>
      <li><div className="cu-celda req"><Check si={pasos.jornada_cerrada} />
        <span className="t"><b>{t("learn_paso_jornada")}</b>{ciclo && <small>{t.rich("learn_paso_jornada_nota", { fecha: () => <Hora iso={`${ciclo.jornada.dia_fin}T12:00:00Z`} formato="fecha" zona="UTC" /> })}</small>}</span>
        <span /><span /></div></li>
    </ul>
  </>;
}
