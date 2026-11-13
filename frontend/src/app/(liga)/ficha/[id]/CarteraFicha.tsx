"use client";

// Cartera de la ficha según la maqueta: lista con píldora de dato, avisos, cambios y pie.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { localeTag, normalizeLocale } from "@/i18n/locale";
import type { Ficha } from "@/lib/liga/api";
import { porcentaje, signo } from "@/lib/liga/format";
import { Hoja } from "../../_ui/Hoja";
import { claseDe } from "../../liga/ListaRanking";
import { HojaEmpresa } from "./HojaEmpresa";

const NB = " ";

const MOTIVOS: Record<string, string> = {
  excluida_manual: "strategies_evidence_manual_exclusion",
  metodologia_cambiada: "strategies_evidence_method_changed",
  regla_no_cumplida: "strategies_evidence_rule_failed",
  sigue_elegible_sin_entrar: "strategies_evidence_still_eligible",
  no_disponible: "strategies_evidence_unavailable",
};

const ETIQUETA_PESO: Record<string, string> = {
  negocio: "strategies_weight_business", precio: "strategies_weight_price", deuda: "strategies_weight_debt",
  pronto: "strategies_weight_catalyst", pregunta: "strategies_weight_question",
};

type Dato = "sem" | "peso" | "vs" | "entrada";
const ETIQUETA_DATO: Record<Dato, string> = {
  sem: "ficha_dato_semana", peso: "ficha_dato_peso", vs: "ficha_dato_vs", entrada: "ficha_dato_entrada",
};

const ICONO_CANDADO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
  </svg>
);

export const ICONO_CHEV = (
  <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m1 1 6 6-6 6" />
  </svg>
);

type Fila = {
  ticker: string; peso: number; semana: number | null; precio: number | null;
  vs: number | null; entrada: number | null;
};

export function CarteraFicha({ ficha, nuevas }: { ficha: Ficha; nuevas: string[] }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [indice, setIndice] = useState(0);
  const [ticker, setTicker] = useState<string | null>(null);
  const [metodoAbierto, setMetodoAbierto] = useState(false);
  const mercado = ficha.mercado ?? null;
  const omega = ficha.casa === "omega";
  const evidencia = omega ? null : ficha.rendimiento?.evidencia ?? null;
  const sp = mercado?.sp500 ?? null;

  const etiqueta = localeTag(locale);
  const uno = new Intl.NumberFormat(etiqueta, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dos = new Intl.NumberFormat(etiqueta, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const diaMes = (valor: string) => new Intl.DateTimeFormat(etiqueta, { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(valor)).replace(".", "");

  const filas: Fila[] = evidencia
    ? evidencia.posiciones.map((p) => ({
      ticker: p.ticker, peso: Number(p.peso), semana: mercado?.empresas[p.ticker]?.rentabilidad ?? null,
      precio: mercado?.empresas[p.ticker]?.precio ?? null,
      vs: p.rendimiento.estado === "disponible" ? p.rendimiento.diferencia_pp : null, entrada: null,
    }))
    : ficha.posiciones.map((p) => ({
      ticker: p.ticker, peso: Number(p.peso ?? 0), semana: mercado?.empresas[p.ticker]?.rentabilidad ?? null,
      precio: mercado?.empresas[p.ticker]?.precio ?? (omega ? p.precio ?? null : null),
      vs: null, entrada: omega ? p.retorno ?? null : null,
    }));

  if (filas.length === 0) {
    if (ficha.rendimiento?.estado === "privado" && !ficha.casa) {
      return <div className="fi-vacio">{ICONO_CANDADO}<h2>{t("ficha_cartera_privada_t")}</h2><p>{t("ficha_cartera_privada")}</p></div>;
    }
    return <p className="lv-pie">{ficha.casa && !ficha.casa_metodologia?.pasos.length
      ? t("strategies_house_portfolio_delay_note") : t("strategies_no_visible_portfolio")}</p>;
  }

  const datos: Dato[] = [];
  if (filas.some((x) => x.semana != null)) datos.push("sem");
  datos.push("peso");
  if (omega ? filas.some((x) => x.entrada != null) : filas.some((x) => x.vs != null)) datos.push(omega ? "entrada" : "vs");
  const dato = datos[indice % datos.length];

  const valorDe = (x: Fila): [string, string] => {
    if (dato === "peso") return [`${uno.format(x.peso)}${NB}%`, ""];
    if (dato === "vs") return x.vs == null ? ["-", ""] : [signo(x.vs, 1, locale), claseDe(x.vs)];
    if (dato === "entrada") return x.entrada == null ? ["-", ""] : [porcentaje(x.entrada, 1, locale), ""];
    if (x.semana == null) return ["-", ""];
    return [porcentaje(x.semana, 1, locale), sp == null ? "" : claseDe(x.semana - sp)];
  };
  const encima = sp == null ? 0 : filas.filter((x) => x.semana != null && claseDe(x.semana - sp) === "bien").length;
  const cabecera = omega ? t("ficha_cartera_cab_omega", { count: filas.length })
    : mercado ? t("ficha_cartera_cab", { count: filas.length, above: encima })
      : t("strategies_portfolio_count", { count: filas.length });

  const f = evidencia?.formacion;
  const cambios = evidencia?.cambios ?? null;
  const razon = (s: NonNullable<typeof cambios>["salidas"][number]) => {
    const regla = s.causa === "regla_no_cumplida" ? s.reglas.find((r) => r.cumple === false) : undefined;
    return regla ? t("ficha_motivo_regla", { rule: regla.titulo }) : t(MOTIVOS[s.causa]);
  };
  const pesos = f?.pesos ? Object.entries(f.pesos).filter(([, v]) => v > 0) : [];
  const totalPesos = pesos.reduce((s, [, v]) => s + v, 0) || 1;
  const hora = mercado?.consultado
    ? new Intl.DateTimeFormat(etiqueta, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(mercado.consultado))
    : null;

  return (
    <>
      <p className="lv-lista-cab"><span>{cabecera}</span><span><b>{t(ETIQUETA_DATO[dato])}</b></span></p>
      <ul className="lv-lista">
        {filas.map((x) => {
          const [texto, clase] = valorDe(x);
          const pesoTxt = `${uno.format(x.peso)}${NB}%`;
          const nueva = nuevas.includes(x.ticker);
          return (
            <li className="lv-fila fi-emp" key={x.ticker}>
              <button type="button" className="lv-fila-abre" onClick={() => setTicker(x.ticker)}>
                <span className="lv-nombre"><b>{x.ticker}</b>
                  <small className={nueva ? "nuevo" : undefined}>
                    {nueva ? t("ficha_nueva") : x.precio == null ? pesoTxt : `${pesoTxt} · ${dos.format(Number(x.precio))}${NB}$`}
                  </small></span>
              </button>
              <button type="button" className={`lv-pildora${clase ? ` ${clase}` : ""}`}
                aria-label={`${texto}, ${t("league_cambiar_dato")}`} onClick={() => setIndice(indice + 1)}>{texto}</button>
            </li>
          );
        })}
      </ul>

      {f && !f.receta_vigente && <p className="fi-pie-grupo">{t("strategies_evidence_method_changed_note")}</p>}
      {f?.estado_foto === "sin_datos" && <p className="fi-pie-grupo">{t("strategies_evidence_photo_missing")}</p>}
      {f?.estado_reglas === "version_no_soportada" && <p className="fi-pie-grupo">{t("strategies_evidence_rule_version_unsupported")}</p>}

      {f && !f.receta_vigente && <>
        <ul className="fi-grupo">
          <li><button type="button" className="fi-celda enlace" onClick={() => setMetodoAbierto(true)}>
            <span>{t("ficha_metodo_historico")}</span>{ICONO_CHEV}
          </button></li>
        </ul>
        <Hoja abierta={metodoAbierto} titulo={t("ficha_metodo_historico")} accion={t("builder_listo")} onCerrar={() => setMetodoAbierto(false)}>
          <div className="fi-hoja-pad fi">
            {f.idea && <><p className="fi-cab-grupo">{t("strategies_idea")}</p>
              <div className="fi-grupo"><p className="fi-celda texto">{f.idea}</p></div></>}
            {f.reglas.length > 0 && <><p className="fi-cab-grupo">{t("ficha_reglas")}</p>
              <ul className="fi-grupo">{f.reglas.map((r) => (
                <li className="fi-celda apilada" key={r.clave}><span>{r.titulo}</span><span className="valor">{r.detalle}</span></li>
              ))}</ul></>}
            {pesos.length > 0 && <><p className="fi-cab-grupo">{t("strategies_priorities")}</p>
              <ul className="fi-grupo">{pesos.map(([k, v]) => (
                <li className="fi-celda" key={k}>
                  <span>{ETIQUETA_PESO[k] ? t(ETIQUETA_PESO[k]) : k}</span>
                  <span className="valor">{Math.round(v * 100 / totalPesos)}{NB}%</span>
                </li>
              ))}</ul></>}
            {f.pregunta && <><p className="fi-cab-grupo">{t("strategies_question_label")}</p>
              <div className="fi-grupo"><p className="fi-celda texto">{f.pregunta}</p></div></>}
            <p className="fi-cab-grupo">{t("ficha_reparto")}</p>
            <div className="fi-grupo"><p className="fi-celda texto">{f.n_empresas !== null
              ? t("strategies_allocation_summary", {
                count: f.n_empresas,
                allocation: f.reparto === "igual" ? t("strategies_equal_weights") : t("strategies_score_weights"),
                sectorLimit: f.max_por_sector ? t("strategies_sector_limit", { count: f.max_por_sector }) : t("strategies_no_sector_limit"),
              })
              : t("strategies_evidence_recipe_unavailable")}</p></div>
          </div>
        </Hoja>
      </>}

      {cambios && f && <>
        <p className="fi-cab-grupo">{t("ficha_cambios_del", { date: diaMes(f.desde) })}</p>
        <ul className="fi-grupo">
          {cambios.entradas.map((tk) => (
            <li className="fi-celda" key={`e-${tk}`}><span className="t">{tk}<small>{t("ficha_entra")}</small></span></li>
          ))}
          {cambios.salidas.map((s) => (
            <li className="fi-celda" key={`s-${s.ticker}`}><span className="t">{s.ticker}<small>{t("ficha_sale", { reason: razon(s) })}</small></span></li>
          ))}
        </ul>
      </>}

      {(mercado || !ficha.casa) && <p className="lv-pie">
        {mercado && t("ficha_precios_de", { time: hora ?? "-", date: diaMes(mercado.dia) })}
        {!ficha.casa && <>{mercado && <br />}{t("strategies_user_strategy_disclaimer")}</>}
      </p>}

      <HojaEmpresa ficha={ficha} ticker={ticker} onCerrar={() => setTicker(null)} />
    </>
  );
}
