"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { get } from "@/lib/api";
import { dolares, fechaCorta, numero, porcentajeSimple } from "../../_marco/formato";
import { Barras, Celda, Esqueleto, Grupo, Progreso, Segmentado } from "../../_panel/ui";
import "../usuarios/pp.css";
import { porcentaje, ritmo } from "./analitica";
import { IntencionesLista } from "./IntencionesLista";

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

const PASOS = [
  ["altas", "pnl_personas_an_altas"], ["con_estrategia", "pnl_personas_an_estrategia"],
  ["apuntadas", "pnl_personas_an_apuntada"], ["jugaron", "pnl_personas_an_jugo"],
] as const;
const VISTAS = ["cifras", "embudo", "vuelta", "semanas"] as const;
type Vista = (typeof VISTAS)[number];

function Analitica() {
  const t = useTranslations();
  const locale = useLocale();
  const [datos, setDatos] = useState<AnaliticaOut | null>(null);
  const [fallo, setFallo] = useState(false);
  const [vista, setVista] = useState<Vista>("cifras");
  useEffect(() => {
    let activo = true;
    get<AnaliticaOut>("/liga/admin/panel/analitica?dias=30")
      .then(d => { if (activo) setDatos(d); })
      .catch(() => { if (activo) setFallo(true); });
    return () => { activo = false; };
  }, []);
  const n = (valor: Decimal) => numero(valor, locale);
  const pct = (valor: number | null) => valor === null ? t("pnl_personas_sin_dato") : porcentajeSimple(valor, locale);
  if (fallo) return <p className="pnl-pie-grupo" role="alert">{t("admin_generic_error")}</p>;
  if (!datos) return <Esqueleto filas={4} etiqueta={t("admin_pnl_cargando")} />;

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
  const pctVuelta = (cuantos: number, base: number) => base === 0 ? t("pnl_personas_sin_dato") : pct(porcentaje(cuantos, base));
  const dias = datos.visitas_dia;

  return (
    <div className="pnl-llega pp">
      <Segmentado etiquetaGrupo={t("pnl_personas_an_vista_aria")} valor={vista} onChange={setVista}
        opciones={VISTAS.map(v => ({ valor: v, etiqueta: t(`pnl_personas_an_vista_${v}`) }))} />

      {vista === "cifras" && (
        <>
          <Grupo cabecera={t("pnl_personas_an_cifras_cab")}>
            <Celda titulo={t("pnl_personas_an_cuentas")} valor={n(c.cuentas)} subtitulo={t("pnl_personas_an_nuevas", { n: n(c.nuevas_7d) })} />
            <Celda titulo={t("pnl_personas_an_activas")} valor={n(c.activas_7d)} subtitulo={t("pnl_personas_an_sobre_cuentas", { pct: pct(porcentaje(Number(c.activas_7d), Number(c.cuentas))) })} />
            <Celda titulo={t("pnl_personas_an_visitas")} valor={n(visitas)} subtitulo={t(`pnl_personas_an_${ritmo(visitas, anterior)}`, { n: n(Math.abs(visitas - anterior)) })} />
            <Celda titulo={t("pnl_personas_an_ia")} valor={dolares(c.ia_mes_usd, locale)}
              subtitulo={tope === null ? t("pnl_personas_an_sin_tope") : (
                <>{t("pnl_personas_an_tope", { n: dolares(tope, locale) })}<Progreso valor={tope > 0 ? Number(c.ia_mes_usd) / tope * 100 : 0} etiqueta={t("pnl_personas_an_ia")} /></>
              )} />
          </Grupo>
          <h2 className="pnl-cab-grupo">{t("pnl_personas_an_visitas_dia")}</h2>
          {dias.length > 0 && (
            <Barras valores={dias.map(d => Number(d.visitas))} etiquetas={[fechaCorta(dias[0].dia, locale), fechaCorta(dias[dias.length - 1].dia, locale)]}
              etiquetaAria={t("pnl_personas_an_grafico", { datos: dias.map(d => t("pnl_personas_an_dia_valor", { dia: fechaCorta(d.dia, locale), n: n(d.visitas) })).join(t("pnl_personas_an_separador")) })} />
          )}
          <p className="pnl-pie-grupo">{t("pnl_personas_an_maximo", { n: n(maximo) })}</p>
          <h2 className="pnl-cab-grupo">{t("pnl_personas_an_intenciones")}</h2>
          <IntencionesLista />
        </>
      )}

      {vista === "embudo" && (
        <>
          <Grupo cabecera={t("pnl_personas_an_embudo")}>
            {PASOS.map(([clave, etiqueta]) => (
              <Celda key={clave} titulo={t(etiqueta)} valor={t("pnl_personas_an_valor_pct", { n: n(datos.embudo[clave]), pct: pct(porcentaje(datos.embudo[clave], datos.embudo.altas)) })}
                subtitulo={<Progreso valor={datos.embudo.altas > 0 ? datos.embudo[clave] / datos.embudo.altas * 100 : 0} etiqueta={t(etiqueta)} />} />
            ))}
          </Grupo>
          <Grupo><Celda titulo={t("pnl_personas_an_consultas")} href="/admin/liga/consultas" /></Grupo>
        </>
      )}

      {vista === "vuelta" && (
        <Grupo cabecera={t("pnl_personas_an_vuelta_titulo")}>
          <Celda titulo={t("pnl_personas_an_vuelta_semana_2")} valor={pctVuelta(vuelta.vuelven_2, vuelta.base_2)} subtitulo={t("pnl_personas_an_vuelta_nota", { n: n(vuelta.vuelven_2), m: n(vuelta.base_2) })} />
          <Celda titulo={t("pnl_personas_an_vuelta_semana_3")} valor={pctVuelta(vuelta.vuelven_3, vuelta.base_3)} subtitulo={t("pnl_personas_an_vuelta_nota", { n: n(vuelta.vuelven_3), m: n(vuelta.base_3) })} />
        </Grupo>
      )}

      {vista === "semanas" && (
        <Grupo cabecera={t("pnl_personas_an_cohortes")}>
          {cohortes.map(f => {
            const v = vueltaPorSemana.get(f.semana);
            return (
              <Celda key={f.semana} titulo={t("pnl_personas_an_semana_del", { fecha: fechaCorta(f.semana, locale) })} valor={t("pnl_personas_an_cohorte_altas", { count: f.altas })}
                subtitulo={(
                  <span className="pp-sub">
                    {PASOS.slice(1).map(([clave, etiqueta]) => <span key={clave}>{t(etiqueta)}: {pct(porcentaje(f[clave], f.altas))}</span>)}
                    {([2, 3] as const).map(s => <span key={s}>{t(`pnl_personas_an_vuelta_columna_${s}`)}: {pctVuelta(v?.[`vuelven_${s}`] ?? 0, v?.[`base_${s}`] ?? 0)}</span>)}
                  </span>
                )} />
            );
          })}
        </Grupo>
      )}
    </div>
  );
}

export default function AnaliticaAdmin() {
  return <AuthGate><Analitica /></AuthGate>;
}
