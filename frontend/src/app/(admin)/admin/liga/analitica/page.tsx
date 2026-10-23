"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { get } from "@/lib/api";
import { Intenciones } from "../Intenciones";
import { Pagina, Bloque, Cifras, Cifra, Barra, Estado } from "../../_marco/ui";
import { numero, dolares, porcentajeSimple, fechaCorta } from "../../_marco/formato";
import { altura, porcentaje, ritmo } from "./analitica";

type Decimal = number | string;
type Pasos = { altas: number; con_estrategia: number; apuntadas: number; jugaron: number };
type Vuelta = { semana: string; jugaron: number; base_2: number; vuelven_2: number; base_3: number; vuelven_3: number };
export type AnaliticaOut = {
  cifras: Record<"cuentas" | "nuevas_7d" | "activas_7d" | "visitas_7d" | "ia_mes_usd", Decimal> & { tope_mensual_usd: Decimal | null };
  visitas_7d_anterior: number;
  embudo: Pasos;
  cohortes: (Pasos & { semana: string })[];
  vuelta: Vuelta[];
  visitas_dia: { dia: string; visitas: number; cuentas: number }[];
};

const pasos = [
  ["altas", "admin_analitica_altas"], ["con_estrategia", "admin_analitica_estrategia"],
  ["apuntadas", "admin_analitica_apuntada"], ["jugaron", "admin_analitica_jugo"],
] as const;

function Analitica() {
  const t = useTranslations();
  const locale = useLocale();
  const [datos, setDatos] = useState<AnaliticaOut | null>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    let activo = true;
    get<AnaliticaOut>("/liga/admin/panel/analitica?dias=30")
      .then(d => { if (activo) setDatos(d); })
      .catch(() => { if (activo) setFallo(true); });
    return () => { activo = false; };
  }, []);
  const n = (valor: Decimal) => numero(valor, locale);
  const pct = (valor: number | null) => valor === null ? t("admin_panel_vacio") : porcentajeSimple(valor, locale);
  if (fallo) return <Estado tipo="error">{t("admin_generic_error")}</Estado>;
  if (!datos) return <Estado tipo="cargando" />;
  const c = datos.cifras;
  const visitas = Number(c.visitas_7d);
  const anterior = Number(datos.visitas_7d_anterior);
  const tope = c.tope_mensual_usd === null ? null : Number(c.tope_mensual_usd);
  const maximo = Math.max(0, ...datos.visitas_dia.map(d => Number(d.visitas)));
  const cohortes = [...datos.cohortes].filter(f => f.altas > 0).sort((a, b) => b.semana.localeCompare(a.semana)).slice(0, 8);
  const vueltaPorSemana = new Map(datos.vuelta.map(f => [f.semana, f]));
  const vuelta = datos.vuelta.reduce((total, f) => ({
    base_2: total.base_2 + f.base_2, vuelven_2: total.vuelven_2 + f.vuelven_2,
    base_3: total.base_3 + f.base_3, vuelven_3: total.vuelven_3 + f.vuelven_3,
  }), { base_2: 0, vuelven_2: 0, base_3: 0, vuelven_3: 0 });
  const pctVuelta = (cuantos: number, base: number) => base === 0
    ? t("admin_panel_vacio") : pct(porcentaje(cuantos, base));
  return <Pagina repetido titulo={t("admin_analitica_titulo")}>
    <Bloque titulo={t("admin_analitica_cifras")}><Cifras>
      <Cifra etiqueta={t("admin_analitica_cuentas")} valor={n(c.cuentas)} nota={t("admin_analitica_nuevas", { n: n(c.nuevas_7d) })} />
      <Cifra etiqueta={t("admin_analitica_activas")} valor={n(c.activas_7d)} nota={t("admin_analitica_sobre_cuentas", { pct: pct(porcentaje(Number(c.activas_7d), Number(c.cuentas))) })} />
      <Cifra etiqueta={t("admin_analitica_visitas")} valor={n(visitas)} nota={t(`admin_analitica_${ritmo(visitas, anterior)}`, { n: n(Math.abs(visitas - anterior)) })} />
      <Cifra etiqueta={t("admin_analitica_ia")} valor={dolares(c.ia_mes_usd, locale)} nota={tope === null ? t("admin_panel_sin_tope") : <>{t("admin_analitica_tope", { n: dolares(tope, locale) })}<Barra valor={Number(c.ia_mes_usd)} maximo={tope} /></>} />
    </Cifras></Bloque>
    <Bloque titulo={t("admin_analitica_embudo")} extra={<Link className="adm-btn adm-btn-texto" href="/admin/liga/consultas">{t("admin_analitica_consultas")}</Link>}>
      <ul className="space-y-4">{pasos.map(([clave, etiqueta]) => <li key={clave}>
        <div className="mb-1 flex justify-between gap-2"><span>{t(etiqueta)}</span><span className="tabular-nums">{t("admin_analitica_valor_pct", { n: n(datos.embudo[clave]), pct: pct(porcentaje(datos.embudo[clave], datos.embudo.altas)) })}</span></div>
        <Barra valor={datos.embudo[clave]} maximo={datos.embudo.altas} />
      </li>)}</ul>
    </Bloque>
    <Bloque titulo={t("admin_analitica_vuelta_titulo")}><Cifras>
      <Cifra className="tabular-nums" etiqueta={t("admin_analitica_vuelta_semana_2")} valor={pctVuelta(vuelta.vuelven_2, vuelta.base_2)} nota={t("admin_analitica_vuelta_nota_2", { n: n(vuelta.vuelven_2), m: n(vuelta.base_2) })} />
      <Cifra className="tabular-nums" etiqueta={t("admin_analitica_vuelta_semana_3")} valor={pctVuelta(vuelta.vuelven_3, vuelta.base_3)} nota={t("admin_analitica_vuelta_nota_3", { n: n(vuelta.vuelven_3), m: n(vuelta.base_3) })} />
    </Cifras></Bloque>
    <Bloque titulo={t("admin_analitica_cohortes")}>
      <div className="adm-tabla-caja"><table className="adm-tabla">
        <thead><tr><th scope="col">{t("admin_analitica_semana")}</th>{pasos.map(([clave, etiqueta]) => <th key={clave} scope="col" className="der">{t(etiqueta)}</th>)}{([2, 3] as const).map(semana => <th key={semana} scope="col" className="der">{t(`admin_analitica_vuelta_columna_${semana}`)}</th>)}</tr></thead>
        <tbody>{cohortes.map(f => <tr key={f.semana}>
          <th scope="row">{fechaCorta(f.semana, locale)}</th><td className="der tabular-nums">{n(f.altas)}</td>
          {pasos.slice(1).map(([clave]) => <td key={clave} className="der tabular-nums">{pct(porcentaje(f[clave], f.altas))}</td>)}
          {([2, 3] as const).map(semana => {
            const v = vueltaPorSemana.get(f.semana);
            return <td key={semana} className="der tabular-nums">{pctVuelta(v?.[`vuelven_${semana}`] ?? 0, v?.[`base_${semana}`] ?? 0)}</td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </Bloque>
    <Bloque titulo={t("admin_analitica_visitas_dia")} extra={<span className="adm-nota">{t("admin_analitica_maximo", { n: n(maximo) })}</span>}>
      <div className="flex h-[120px] items-end gap-1" role="img" aria-label={t("admin_analitica_grafico", { datos: datos.visitas_dia.map(d => t("admin_analitica_dia_valor", { dia: fechaCorta(d.dia, locale), n: n(d.visitas) })).join(t("admin_panel_separador")) })}>
        {datos.visitas_dia.map(d => <div key={d.dia} aria-hidden="true" className="min-w-0 flex-1 rounded-t-sm bg-[var(--accent)]" style={{ height: `${altura(d.visitas, maximo)}%` }} />)}
      </div>
      {datos.visitas_dia.length > 0 && <div className="adm-nota mt-2 flex justify-between"><span>{fechaCorta(datos.visitas_dia[0].dia, locale)}</span><span>{fechaCorta(datos.visitas_dia[datos.visitas_dia.length - 1].dia, locale)}</span></div>}
    </Bloque>
    <Bloque titulo={t("admin_analitica_intenciones")} extra={<span className="adm-nota">{t("admin_analitica_periodo_intenciones")}</span>}><Intenciones /></Bloque>
  </Pagina>;
}

export default function AnaliticaAdmin() {
  return <AuthGate><Analitica /></AuthGate>;
}
