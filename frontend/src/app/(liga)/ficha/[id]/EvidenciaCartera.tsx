"use client";

import type { EvidenciaFormacion } from "@/lib/liga/evidencia";
import { fecha, porcentaje } from "@/lib/liga/format";
import { InfoTip } from "@/components/InfoTip";
import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { MercadoFicha } from "@/lib/liga/api";
import { ListaEmpresas } from "./ListaEmpresas";
import { NotasEmpresa } from "./NotasEmpresa";

const MOTIVOS = {
  excluida_manual: "strategies_evidence_manual_exclusion",
  metodologia_cambiada: "strategies_evidence_method_changed",
  regla_no_cumplida: "strategies_evidence_rule_failed",
  sigue_elegible_sin_entrar: "strategies_evidence_still_eligible",
  no_disponible: "strategies_evidence_unavailable",
};

export function EvidenciaCartera({ fichaId, datos, mercado }: { fichaId: string; datos: EvidenciaFormacion; mercado?: MercadoFicha | null }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const percent = (value: number) => porcentaje(value, 1, locale);
  const { formacion: f, posiciones, cambios } = datos;
  const [ticker, setTicker] = useState<string | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useId();
  useEffect(() => {
    const d = dialogo.current;
    if (!ticker || !d) return;
    d.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { d.close(); document.body.style.overflow = overflow; };
  }, [ticker]);
  const comparables = posiciones.filter((p) => p.rendimiento.estado === "disponible"
    && p.rendimiento.diferencia_pp !== null);
  const superiores = comparables.filter((p) => p.rendimiento.diferencia_pp! > 0);
  const inferiores = comparables.filter((p) => p.rendimiento.diferencia_pp! < 0);
  return (
    <section className="ficha-analisis" aria-label={t("strategies_evidence_portfolio")}>
      <h3 className="sec-t">{t("strategies_portfolio_count", { count: posiciones.length })}</h3>
      <p className="fine">{t("strategies_evidence_select_company")}{mercado && ` ${t("strategies_month_provisional_hint")}`}</p>
      <p className="fine">{t("strategies_evidence_round_context", { round: f.jornada_numero, date: f.desde, method: f.metodo === "mantenida" ? t("strategies_evidence_kept_positions") : t("strategies_evidence_fixed_photo") })}</p>
      {!f.receta_vigente && <p className="fine">{t("strategies_evidence_method_changed_note")}</p>}
      {f.estado_foto === "sin_datos" && <p className="fine">{t("strategies_evidence_photo_missing")}</p>}
      {f.estado_reglas === "version_no_soportada" && <p className="fine">{t("strategies_evidence_rule_version_unsupported")}</p>}

      <ListaEmpresas conPrecio={!!mercado} columnaRetorno={t(mercado ? "strategies_col_month" : "strategies_col_period")}
        alAbrir={setTicker}
        filas={posiciones.map((p) => ({
          ticker: p.ticker,
          peso: Number(p.peso),
          precio: mercado ? (mercado.empresas[p.ticker]?.precio == null ? null : Number(mercado.empresas[p.ticker]!.precio)) : undefined,
          retorno: (mercado ? mercado.empresas[p.ticker]?.rentabilidad : p.rendimiento.rentabilidad_pct) ?? null,
        }))} />
      <dialog ref={dialogo} className="lecturas-modal empresa-modal" aria-labelledby={titulo} onCancel={() => setTicker(null)}>
        <header className="lecturas-cab"><div><p className="lecturas-kicker">{t("strategies_evidence_company_round", { round: f.jornada_numero })}</p><h2 id={titulo}>{ticker}</h2></div>
          <button type="button" className="lecturas-cerrar" aria-label={t("strategies_close_company")} autoFocus onClick={() => setTicker(null)}>×</button></header>
        <div className="lecturas-cuerpo">
      {posiciones.filter(p => p.ticker === ticker).map((p) => {
        const verificadas = p.reglas.filter((r) => r.cumple === true).length;
        const desconocidas = p.reglas.filter((r) => r.cumple === null).length;
        return <article key={p.ticker}>
          <h3 className="sec-t">{t("strategies_evidence_weight", { weight: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(p.peso)) })}</h3>
          <NotasEmpresa fichaId={fichaId} ticker={p.ticker} />
          {mercado && <section className="sec"><h3 className="sec-t">{t("strategies_market_quote")}</h3><p className="meta">{t("strategies_price_label")}: {mercado.empresas[p.ticker]?.precio == null ? t("strategies_quote_pending") : Number(mercado.empresas[p.ticker]!.precio).toLocaleString(locale, {maximumFractionDigits: 4})}</p><p className="fine">{t("strategies_evidence_market_data", { date: mercado.empresas[p.ticker]?.dia ? fecha(mercado.empresas[p.ticker]!.dia!, new Date(), locale) : "—", since: mercado.desde ? fecha(mercado.desde, new Date(), locale) : "—", return: mercado.empresas[p.ticker]?.rentabilidad == null ? "—" : percent(mercado.empresas[p.ticker]!.rentabilidad!) })}</p></section>}
          <p className="fine">{t(p.origen === "mantenida" ? "strategies_evidence_position_kept" : "strategies_evidence_position_selected")}{" "}
            {p.reglas.length ? t("strategies_evidence_rules_verified", { verified: verificadas, total: p.reglas.length, unknown: desconocidas })
              : f.estado_reglas === "disponible" ? t("strategies_no_extra_filters") : t("strategies_evidence_no_verifiable_conditions")}</p>
          {p.reglas.map((r) => <p className="fine" key={r.clave}>
            <b>{r.titulo}:</b> {t(r.cumple === true ? "strategies_rule_passes" : r.cumple === false ? "strategies_rule_fails" : "strategies_rule_unverifiable")}
            {r.motivo ? ` · ${r.motivo}` : ""}.
          </p>)}
          {p.rendimiento.estado === "disponible" && p.rendimiento.rentabilidad_pct !== null ? <>
            <p className="fine">{t("strategies_evidence_return_period", { from: p.rendimiento.desde ?? "—", to: p.rendimiento.hasta ?? "—", strategy: percent(p.rendimiento.rentabilidad_pct), sp: percent(p.rendimiento.sp500_pct!), difference: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(p.rendimiento.diferencia_pp!) })}</p>
            {p.rendimiento.incompleta && <p className="fine">{t("strategies_evidence_missing_closes")}</p>}
          </> : <p className="fine">{t("strategies_evidence_no_common_closes")}</p>}
        </article>;
      })}
        </div>
      </dialog>

      {comparables.length > 0 && <div className="sec">
        <h3 className="sec-t">{t("strategies_position_performance")} <InfoTip text={t("strategies_position_performance_help")} /></h3>
        <p className="fine">{t("strategies_comparable_positions", { comparable: comparables.length, total: posiciones.length })}</p>
        <p className="fine">{t("strategies_above_sp")} {superiores.length ? superiores.map((p) => p.ticker).join(", ") : t("strategies_none")}.</p>
        <p className="fine">{t("strategies_below_sp")} {inferiores.length ? inferiores.map((p) => p.ticker).join(", ") : t("strategies_none")}.</p>
      </div>}

      {cambios && <div className="sec">
        <h3 className="sec-t">{t("strategies_formation_changes")}</h3>
        <p className="fine">{t("strategies_entries")}: {cambios.entradas.length ? cambios.entradas.join(", ") : t("strategies_none")}.</p>
        {cambios.salidas.length ? cambios.salidas.map((s) => <details key={s.ticker}>
          <summary>{t("strategies_exits_ticker", { ticker: s.ticker })}</summary>
          <p className="fine">{t(MOTIVOS[s.causa])}</p>
          {s.causa === "regla_no_cumplida" && s.reglas.filter((r) => r.cumple === false).map((r) =>
            <p className="fine" key={r.clave}>{r.titulo}: {r.motivo ?? t("strategies_rule_condition_not_met")}.</p>)}
        </details>) : <p className="fine">{t("strategies_no_exits")}</p>}
      </div>}

      {!f.receta_vigente && <details>
        <summary>{t("strategies_historical_methodology")}</summary>
        {f.idea && <p className="fine">{f.idea}</p>}
        {f.reglas.map((r) => <p className="fine" key={r.clave}><b>{r.titulo}:</b> {r.detalle}.</p>)}
        {f.pesos && <p className="fine">{t("strategies_priorities")}: {Object.entries(f.pesos).filter(([, v]) => v > 0).map(([k, v]) => {
          const nombres: Record<string, string> = { negocio: "strategies_weight_business", precio: "strategies_weight_price", deuda: "strategies_weight_debt", pronto: "strategies_weight_catalyst", pregunta: "strategies_weight_question" };
          const total = Object.values(f.pesos!).reduce((s, peso) => s + peso, 0) || 1;
          return `${nombres[k] ? t(nombres[k]) : k} ${Math.round(v * 100 / total)} %`;
        }).join(" · ")}.</p>}
        {f.pregunta && <p className="fine">{t("strategies_question_label")}: {f.pregunta}</p>}
        {f.n_empresas !== null ? <p className="fine">{t("strategies_allocation_summary", { count: f.n_empresas, allocation: f.reparto === "igual" ? t("strategies_equal_weights") : t("strategies_score_weights"), sectorLimit: f.max_por_sector ? t("strategies_sector_limit", { count: f.max_por_sector }) : t("strategies_no_sector_limit") })}</p>
          : <p className="fine">{t("strategies_evidence_recipe_unavailable")}</p>}
      </details>}
    </section>
  );
}
