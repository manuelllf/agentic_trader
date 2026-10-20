"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { get } from "@/lib/api";
import { Intenciones } from "../Intenciones";
import { altura, porcentaje, ritmo } from "./analitica";

type Decimal = number | string;
type Pasos = { altas: number; con_estrategia: number; apuntadas: number; jugaron: number };
export type AnaliticaOut = {
  cifras: Record<"cuentas" | "nuevas_7d" | "activas_7d" | "visitas_7d" | "pro_vigentes" | "pases_vigentes" | "ia_mes_usd" | "cobrado_mes_usd", Decimal> & { tope_mensual_usd: Decimal | null };
  visitas_7d_anterior: number;
  en_juego_usuarios: number;
  en_juego_casa: number;
  embudo: Pasos;
  cohortes: (Pasos & { semana: string })[];
  visitas_dia: { dia: string; visitas: number; cuentas: number }[];
};

const muted = { color: "#898781" };
const borde = { borderColor: "#303030" };
const pasos = [
  ["altas", "admin_analitica_altas"], ["con_estrategia", "admin_analitica_estrategia"],
  ["apuntadas", "admin_analitica_apuntada"], ["jugaron", "admin_analitica_jugo"],
] as const;

function Celda({ titulo, valor, children }: { titulo: string; valor: string; children: ReactNode }) {
  return <div className="min-w-0 rounded-lg border p-3" style={borde}>
    <h3 className="text-xs" style={muted}>{titulo}</h3>
    <p className="my-2 break-words text-2xl tabular-nums">{valor}</p>
    <div className="text-xs" style={muted}>{children}</div>
  </div>;
}

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
  const n = (valor: Decimal) => new Intl.NumberFormat(locale).format(Number(valor));
  const usd = (valor: Decimal) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(Number(valor));
  const pct = (valor: number | null) => valor === null ? t("admin_panel_vacio") : t("admin_panel_porcentaje", { n: n(valor) });
  const fecha = (valor: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${valor}T00:00:00`));
  if (fallo) return <p role="alert" style={{ color: "#c3c2b7" }}>{t("admin_generic_error")}</p>;
  if (!datos) return <p role="status" style={muted}>{t("admin_loading")}</p>;
  const c = datos.cifras;
  const visitas = Number(c.visitas_7d);
  const anterior = Number(datos.visitas_7d_anterior);
  const tope = c.tope_mensual_usd === null ? null : Number(c.tope_mensual_usd);
  const maximo = Math.max(0, ...datos.visitas_dia.map(d => Number(d.visitas)));
  return <div className="admin-escritorio mx-auto max-w-md px-4 pb-16 pt-6 min-w-0 space-y-8 text-sm" style={{ background: "transparent", color: "#c3c2b7" }}>
    <header><h1 className="text-2xl">{t("admin_analitica_titulo")}</h1><p className="mt-2" style={muted}>{t("admin_analitica_sub")}</p></header>
    <section>
      <h2 className="mb-3 font-semibold">{t("admin_analitica_cifras")}</h2>
      <div className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-3">
        <Celda titulo={t("admin_analitica_cuentas")} valor={n(c.cuentas)}>{t("admin_analitica_nuevas", { n: n(c.nuevas_7d) })}</Celda>
        <Celda titulo={t("admin_analitica_activas")} valor={n(c.activas_7d)}>{t("admin_analitica_sobre_cuentas", { pct: pct(porcentaje(Number(c.activas_7d), Number(c.cuentas))) })}</Celda>
        <Celda titulo={t("admin_analitica_visitas")} valor={n(visitas)}>
          <p>{t(`admin_analitica_${ritmo(visitas, anterior)}`, { n: n(Math.abs(visitas - anterior)) })}</p>
          <p>{t("admin_analitica_frente", { n: n(anterior) })}</p>
        </Celda>
        <Celda titulo={t("admin_analitica_en_juego")} valor={n(Number(datos.en_juego_usuarios) + Number(datos.en_juego_casa))}>{t("admin_analitica_en_juego_de", { usuarios: n(datos.en_juego_usuarios), casa: n(datos.en_juego_casa) })}</Celda>
        <Celda titulo={t("admin_analitica_ia")} valor={usd(c.ia_mes_usd)}>
          {tope !== null && <><p>{t("admin_analitica_tope", { n: usd(tope) })}</p><div className="mt-2 h-1.5 overflow-hidden rounded" style={{ background: "#303030" }}><div className="h-full" style={{ background: "#3987e5", width: `${altura(Number(c.ia_mes_usd), tope)}%` }} /></div></>}
        </Celda>
        <Celda titulo={t("admin_analitica_cobrado")} valor={usd(c.cobrado_mes_usd)}>
          <p>{t("admin_analitica_modalidad", { n: n(c.pro_vigentes), modalidad: t("admin_analitica_pro") })}</p>
          <p>{t("admin_analitica_modalidad", { n: n(c.pases_vigentes), modalidad: t("admin_analitica_pases") })}</p>
        </Celda>
      </div>
    </section>
    <section>
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">{t("admin_analitica_embudo")}</h2><Link href="/admin/liga/consultas" className="py-3" style={{ color: "#3987e5" }}>{t("admin_analitica_consultas")}</Link></div>
      <ul className="space-y-4">{pasos.map(([clave, etiqueta]) => <li key={clave}>
        <div className="mb-1 flex justify-between gap-2"><span>{t(etiqueta)}</span><span className="tabular-nums">{t("admin_analitica_valor_pct", { n: n(datos.embudo[clave]), pct: pct(porcentaje(Number(datos.embudo[clave]), Number(datos.embudo.altas))) })}</span></div>
        <div className="h-2 overflow-hidden rounded" style={{ background: "#303030" }}><div className="h-full" style={{ background: "#3987e5", width: `${altura(Number(datos.embudo[clave]), Number(datos.embudo.altas))}%` }} /></div>
      </li>)}</ul>
    </section>
    <section>
      <h2 className="font-semibold">{t("admin_analitica_cohortes")}</h2><p className="mt-1 text-xs" style={muted}>{t("admin_analitica_cohortes_ayuda")}</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-right text-xs">
        <thead><tr><th scope="col" className="whitespace-nowrap p-2 text-left">{t("admin_analitica_semana")}</th>{pasos.map(([clave, etiqueta]) => <th key={clave} scope="col" className="whitespace-nowrap p-2">{t(etiqueta)}</th>)}</tr></thead>
        <tbody>{datos.cohortes.map(f => <tr key={f.semana} className="border-t" style={borde}>
          <th scope="row" className="whitespace-nowrap p-2 text-left font-normal">{fecha(f.semana)}</th><td className="p-2 tabular-nums">{n(f.altas)}</td>
          {pasos.slice(1).map(([clave]) => {
            const valor = porcentaje(Number(f[clave]), Number(f.altas));
            return <td key={clave} className="p-2 tabular-nums" style={{ background: `rgba(57, 135, 229, ${Math.min(100, Math.max(0, valor ?? 0)) / 100 * 0.6})` }}>{pct(valor)}</td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </section>
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">{t("admin_analitica_visitas_dia")}</h2><p className="text-xs" style={muted}>{t("admin_analitica_maximo", { n: n(maximo) })}</p></div>
      <p className="mt-1 text-xs" style={muted}>{t("admin_analitica_visitas_ayuda")}</p>
      <div className="mt-4 flex h-36 items-end gap-1" role="img" aria-label={t("admin_analitica_grafico", { datos: datos.visitas_dia.map(d => t("admin_analitica_dia_valor", { dia: fecha(d.dia), n: n(d.visitas) })).join(t("admin_panel_separador")) })}>
        {datos.visitas_dia.map(d => <div key={d.dia} aria-hidden="true" className="min-w-0 flex-1 rounded-t-sm" style={{ height: `${altura(Number(d.visitas), maximo)}%`, background: "#3987e5" }} />)}
      </div>
      {datos.visitas_dia.length > 0 && <div className="mt-2 flex justify-between text-xs" style={muted}><span>{fecha(datos.visitas_dia[0].dia)}</span><span>{fecha(datos.visitas_dia[datos.visitas_dia.length - 1].dia)}</span></div>}
    </section>
    <section><h2 className="mb-3 font-semibold">{t("admin_analitica_intenciones")}</h2><Intenciones /></section>
  </div>;
}

export default function AnaliticaAdmin() {
  return <AuthGate><Analitica /></AuthGate>;
}
