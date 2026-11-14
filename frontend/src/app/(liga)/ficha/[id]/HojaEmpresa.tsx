"use client";

// Hoja de una empresa de la cartera: su semana, su sitio en la cartera, sus notas y sus reglas.

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { localeTag, normalizeLocale } from "@/i18n/locale";
import { getNotasEmpresa, type Ficha } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { porcentaje, signo } from "@/lib/liga/format";
import { Hoja } from "../../_ui/Hoja";
import { claseDe } from "../../liga/ListaRanking";

const NB = " ";

const NOTAS = [
  ["negocio", "strategies_weight_business"],
  ["precio", "strategies_weight_price"],
  ["deuda", "strategies_weight_debt"],
  ["pronto", "strategies_weight_catalyst"],
] as const;

const CHEV = (
  <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m1 1 6 6-6 6" />
  </svg>
);

export function HojaEmpresa({ ficha, ticker, onCerrar }: { ficha: Ficha; ticker: string | null; onCerrar: () => void }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const etiqueta = localeTag(locale);
  const omega = ficha.casa === "omega";
  const { datos: notas } = useCache(ticker && !omega ? `notas:${ficha.id}:${ticker}` : null,
    () => getNotasEmpresa(ficha.id, ticker ?? ""));

  const uno = new Intl.NumberFormat(etiqueta, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dos = new Intl.NumberFormat(etiqueta, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const diaMes = (valor: string) => new Intl.DateTimeFormat(etiqueta, { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(valor)).replace(".", "");
  const precioTxt = (v: number | null | undefined) => (v == null ? "-" : `${dos.format(Number(v))}${NB}$`);

  const mercado = ficha.mercado ?? null;
  const evidencia = omega ? null : ficha.rendimiento?.evidencia ?? null;
  const enEvidencia = ticker ? evidencia?.posiciones.find((p) => p.ticker === ticker) : undefined;
  const posicion = ticker ? ficha.posiciones.find((p) => p.ticker === ticker) : undefined;
  const cotizacion = ticker ? mercado?.empresas[ticker] ?? null : null;
  const semana = cotizacion?.rentabilidad ?? null;
  const sp = mercado?.sp500 ?? null;
  const diff = semana != null && sp != null ? semana - sp : null;
  const precio = cotizacion?.precio ?? (omega ? posicion?.precio ?? null : null);
  const peso = enEvidencia ? Number(enEvidencia.peso) : posicion?.peso != null ? Number(posicion.peso) : null;
  const rend = enEvidencia?.rendimiento;
  const formacion = evidencia?.formacion;

  let entro = "-";
  if (omega) {
    entro = posicion?.entrada_dia
      ? t("ficha_entro_omega", { date: diaMes(posicion.entrada_dia), price: precioTxt(posicion.entrada_precio) }) : "-";
  } else if (enEvidencia && formacion) {
    entro = t(enEvidencia.origen === "mantenida" ? "ficha_entro_antes" : "ficha_entro_en", { round: formacion.jornada_numero });
  }

  const desde = omega
    ? (posicion?.retorno == null ? "-" : porcentaje(posicion.retorno, 1, locale))
    : rend?.estado === "disponible" && rend.rentabilidad_pct != null
      ? `${porcentaje(rend.rentabilidad_pct, 1, locale)}${rend.sp500_pct != null ? ` · S&P ${porcentaje(rend.sp500_pct, 1, locale)}` : ""}`
      : "-";

  const reglas = enEvidencia?.reglas ?? [];
  const cumplen = reglas.filter((r) => r.cumple === true).length;
  const nota = notas && typeof notas !== "string" ? notas : null;

  return (
    <Hoja abierta={!!ticker} titulo={ticker ?? ""} accion={t("builder_listo")} onCerrar={onCerrar}>
      {ticker && <div className="fi-hoja-pad fi">
        {semana != null && <div className="fi-cifra"><small>{t("ficha_empresa_semana")}</small><b>{porcentaje(semana, 1, locale)}</b>
          {diff != null && <p>{t.rich("ficha_frente_sp_corto", {
            diff: `${signo(diff, 1, locale)}${NB}pp`,
            dif: (c) => <span className={`${claseDe(diff) || "igual"}-t`}>{c}</span>,
          })}</p>}
        </div>}

        <p className="fi-cab-grupo">{t("ficha_en_cartera")}</p>
        <ul className="fi-grupo">
          <li className="fi-celda"><span>{t("ficha_precio")}</span><span className="valor">{precioTxt(precio)}</span></li>
          <li className="fi-celda"><span>{t("ficha_peso")}</span><span className="valor">{peso == null ? "-" : `${uno.format(peso)}${NB}%`}</span></li>
          <li className="fi-celda"><span>{t(omega ? "ficha_desde_entrada" : "ficha_desde_formacion")}</span><span className="valor">{desde}</span></li>
          <li className="fi-celda"><span>{t("ficha_entro")}</span><span className="valor">{entro}</span></li>
        </ul>
        {omega && posicion?.salida_dia != null && <p className="fi-pie-grupo">{t("strategies_omega_exit_line", {
          date: diaMes(posicion.salida_dia), price: precioTxt(posicion.salida_precio),
        })}</p>}
        {rend && rend.estado === "disponible" && rend.rentabilidad_pct != null
          ? rend.incompleta && <p className="fi-pie-grupo">{t("strategies_evidence_missing_closes")}</p>
          : enEvidencia && <p className="fi-pie-grupo">{t("strategies_evidence_no_common_closes")}</p>}

        {!omega && nota && (nota.notas ? <>
          <p className="fi-cab-grupo">{t("ficha_notas")}</p>
          <ul className="fi-grupo">
            {NOTAS.map(([clave, texto]) => {
              // Sobre 100, como la nota final y como en Crear.
              const n = Math.max(0, Math.min(100, Math.round(Number(nota.notas?.[clave] ?? 0))));
              return (
                <li className="fi-celda fi-nota" key={clave}>
                  <span>{t(texto)}</span>
                  <span className="valor">{t.rich("ficha_nota_de", { n, b: (c) => <b>{c}</b> })}</span>
                  <span className="barra" aria-hidden="true"><i style={{ width: `${n}%` }} /></span>
                </li>
              );
            })}
            <li><Link className="fi-celda enlace" href="/como-funciona"><span>{t("ficha_como_notas")}</span>{CHEV}</Link></li>
          </ul>
          <p className="fi-pie-grupo">{t("ficha_foto", { date: diaMes(nota.dia), round: nota.jornada, total: nota.jornada_total })}</p>
        </> : <>
          <p className="fi-cab-grupo">{t("ficha_notas")}</p>
          <ul className="fi-grupo">
            <li><Link className="fi-celda enlace" href="/como-funciona"><span>{t("ficha_como_notas")}</span>{CHEV}</Link></li>
          </ul>
          <p className="fi-pie-grupo">{t("strategies_company_notes_none")}</p>
        </>)}

        {!omega && !ficha.casa && enEvidencia && <>
          {reglas.length > 0 && <>
            <p className="fi-cab-grupo">{t("ficha_reglas")}</p>
            <ul className="fi-grupo">{reglas.map((r) => (
              <li className="fi-celda" key={r.clave}><span>{r.titulo}</span>
                <span className="valor">{t(r.cumple === true ? "ficha_cumple" : r.cumple === false ? "ficha_no_cumple" : "ficha_sin_dato")}</span></li>
            ))}</ul>
          </>}
          <p className="fi-pie-grupo">{t(enEvidencia.origen === "mantenida" ? "ficha_mantenida" : "ficha_elegida")}
            {reglas.length > 0 && ` ${t("ficha_cumple_n", { ok: cumplen, total: reglas.length })}`}</p>
        </>}
      </div>}
    </Hoja>
  );
}
