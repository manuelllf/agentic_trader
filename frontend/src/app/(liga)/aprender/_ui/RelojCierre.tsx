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
  const mesDe = (dia: string) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${dia}T12:00:00Z`));
  const hitos = [
    { iso: ciclo.escaneo, titulo: t("learn_g3_escaneo_t"), texto: t("learn_g3_escaneo_d"), clave: false },
    { iso: ciclo.cierre_jornada, titulo: t("learn_g3_cierre_t", { mes: mesDe(ciclo.jornada.dia_base) }), texto: t("learn_g3_cierre_d"), clave: false },
    { iso: ciclo.corte, titulo: t("learn_g3_corte_t"), texto: t("learn_g3_corte_d", { mes: mesDe(ciclo.jornada.dia_inicio) }), clave: true },
    { iso: ciclo.cierre_cambios, titulo: t("learn_g3_cambios_t"), texto: t("learn_g3_cambios_d"), clave: true },
    { iso: ciclo.apertura, titulo: t("learn_g3_apertura_t"), texto: t("learn_g3_apertura_d"), clave: false },
  ];
  const diaLocal = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" });
  const horaNY = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/New_York" });
  const grupos = new Map<string, typeof hitos>();
  for (const h of hitos) {
    const dia = diaLocal.format(new Date(h.iso));
    const grupo = grupos.get(dia) ?? [];
    grupo.push(h);
    grupos.set(dia, grupo);
  }
  return <ol className="apr-reloj">{Array.from(grupos, ([dia, grupo]) => <Fragment key={dia}>
    <li className="apr-dia"><Hora iso={grupo[0].iso} formato="dia" zona={zona} /></li>
    {grupo.map(h => <Fragment key={h.iso}>
      <li className={`apr-hito${h.clave ? " clave" : ""}`}>
        <span className="apr-h num"><Hora iso={h.iso} formato="hora" zona={zona} /><span className="apr-ny">{t("learn_g3_ny", { hora: horaNY.format(new Date(h.iso)) })}</span></span>
        <div><b>{h.titulo}</b><p>{h.texto}</p></div>
      </li>
      {h.iso === ciclo.corte && <li className="apr-ventana">{t("learn_g3_ventana")}</li>}
    </Fragment>)}
  </Fragment>)}</ol>;
}
