"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { CicloAprender } from "@/lib/aprender";
import { getPrimerosPasos, type PrimerosPasos as EstadoPasos } from "@/lib/liga/api";
import { useSesion } from "../../_sesion/SesionContext";
import { Hora } from "./Hora";

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
  return <section className="apr-sec" aria-labelledby="apr-pasos">
    <h2 id="apr-pasos">{t("learn_pasos_titulo")}</h2>
    <ul className="apr-pasos">
      <li className="hecho"><span className="apr-marca" aria-hidden="true" /><div><b>{t("learn_paso_cuenta")}</b></div><span /></li>
      <li className={pasos.estrategia ? "hecho" : undefined}><span className="apr-marca" aria-hidden="true" /><div><b>{t("learn_paso_estrategia")}</b><small>{t("learn_paso_estrategia_nota")}</small></div>{pasos.estrategia ? <span /> : <Link href="/crear" className="btn pri apr-btn">{t("learn_crear")}</Link>}</li>
      <li className={pasos.apuntada ? "hecho" : undefined}><span className="apr-marca" aria-hidden="true" /><div><b>{t("learn_paso_apuntar")}</b>{ciclo && <small>{t.rich("learn_paso_apuntar_nota", { fecha: () => <Hora iso={ciclo.corte} formato="fecha" />, hora: () => <Hora iso={ciclo.corte} formato="hora" /> })}</small>}</div><span /></li>
      <li className={pasos.jornada_cerrada ? "hecho" : undefined}><span className="apr-marca" aria-hidden="true" /><div><b>{t("learn_paso_jornada")}</b>{ciclo && <small>{t.rich("learn_paso_jornada_nota", { fecha: () => <Hora iso={`${ciclo.jornada.dia_fin}T12:00:00Z`} formato="fecha" zona="UTC" /> })}</small>}</div><span /></li>
    </ul>
  </section>;
}
