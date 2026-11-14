"use client";

import { Fragment, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CicloAprender } from "@/lib/aprender";
import { Hora } from "./Hora";

export function RelojCierre({ ciclo, zona }: { ciclo: CicloAprender; zona?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  const hitos = [
    { iso: ciclo.escaneo, titulo: t("learn_g3_escaneo_t"), texto: t("learn_g3_escaneo_d"), clave: false },
    { iso: ciclo.cierre_jornada, titulo: t("learn_g3_cierre_t"), texto: t("learn_g3_cierre_d"), clave: false },
    { iso: ciclo.corte, titulo: t("learn_g3_corte_t"), texto: t("learn_g3_corte_d"), clave: true },
    { iso: ciclo.cierre_cambios, titulo: t("learn_g3_cambios_t"), texto: t("learn_g3_cambios_d"), clave: true },
    { iso: ciclo.apertura, titulo: t("learn_g3_apertura_t"), texto: t("learn_g3_apertura_d"), clave: false },
  ].filter((h): h is typeof h & { iso: string } => h.iso !== null);
  const diaLocal = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" });
  const horaNY = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/New_York" });
  const grupos = new Map<string, typeof hitos>();
  for (const h of hitos) {
    const dia = diaLocal.format(new Date(h.iso));
    const grupo = grupos.get(dia) ?? [];
    grupo.push(h);
    grupos.set(dia, grupo);
  }
  return <>{Array.from(grupos, ([dia, grupo]) => <Fragment key={dia}>
    <p className="cu-cab"><Hora iso={grupo[0].iso} formato="dia" zona={zona} /></p>
    <ul className="cu-grupo reloj">{grupo.map(h => <Fragment key={h.iso}>
      <li><div className={`cu-celda hito${h.clave ? " clave" : ""}`}>
        <span className="h"><Hora iso={h.iso} formato="hora" zona={zona} /><small>{t("learn_g3_ny", { hora: horaNY.format(new Date(h.iso)) })}</small></span>
        <span className="t"><b>{h.titulo}</b><small>{h.texto}</small></span>
      </div></li>
      {h.iso === ciclo.corte && <li><div className="cu-celda ventana">{t("learn_g3_ventana")}</div></li>}
    </Fragment>)}</ul>
  </Fragment>)}</>;
}
