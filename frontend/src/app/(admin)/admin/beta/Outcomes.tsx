"use client";

import { useState } from 'react';
import { useLocale, useTranslations } from "next-intl";
import type { OutcomeBook, OutcomeScan, OutcomeStats } from '@/lib/api';
import { InfoTip } from '@/components/InfoTip';
import { sortRows, useOrden } from '@/lib/useOrden';
import { fmtDay, sign } from './helpers';
import { Details } from './ui';

type OutSortKey = "at" | "cartera" | "seleccionados" | "descartados" | "jev" | "spy";
const outAccessor = (s: OutcomeScan, key: OutSortKey): string | number | null =>
  key === "at" ? s.at
  : key === "spy" ? s.groups.spy
  : s.groups[key]?.avg ?? null;

/** Un retorno medio de grupo, coloreado por signo y con el tamaño del grupo al lado. */
export function OutPct({ s }: { s: OutcomeStats }) {
  if (!s.n || s.avg == null) return <span className="text-[#565654]">—</span>;
  return (
    <>
      <span className={s.avg >= 0 ? "font-semibold text-[#6BBE8A]" : "font-semibold text-[#E0776C]"}>
        {sign(s.avg)}{s.avg.toFixed(1)}%
      </span>
      <span className="text-[#6E6E6B]"> ({s.n})</span>
    </>
  );
}

/** Una cohorte de la traza como fila de la tabla. En los observatorios, "en cartera" es la
 *  construcción HIPOTÉTICA de ese martes (nada se compró); el pie de la tabla lo aclara. */
export function OutRow({ s, pct }: { s: OutcomeScan; pct: (v: number | null) => string }) {
  const t = useTranslations();
  const locale = useLocale() as "es" | "en";
  const [abierta, setAbierta] = useState(false);
  const tieneJev = !!s.jev?.length;
  return (
    <>
    <tr className="border-t border-[#303030]">
      <td className="py-1.5 pr-3">
        {t("beta_from_day", { date: fmtDay(s.at, locale) })} {t("beta_today")}
        <span className="text-[#6E6E6B]"> · {s.days} d · {t(s.mode === "decisión" ? "beta_decision" : "beta_observation")}</span>
      </td>
      <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.cartera} /></td>
      <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.seleccionados} /></td>
      <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.descartados} /></td>
      <td className="px-3 py-1.5 text-right">
        {tieneJev ? (
          <button onClick={() => setAbierta(!abierta)}
                  className="inline-flex items-center gap-1 hover:opacity-80">
            {s.groups.jev ? <OutPct s={s.groups.jev} /> : <span className="text-[#565654]">—</span>}
            <span className="text-[#6E6E6B]">{abierta ? "▴" : "▾"}</span>
          </button>
        ) : (
          s.groups.jev ? <OutPct s={s.groups.jev} /> : <span className="text-[#565654]">—</span>
        )}
      </td>
      <td className="px-3 py-1.5 text-right">
        {s.groups.spy == null ? "—" : `${sign(s.groups.spy)}${s.groups.spy.toFixed(1)}%`}
      </td>
      <td className="px-3 py-1.5 text-right text-[#6E6E6B]">
        {s.corte.fuera.n ? `${pct(s.corte.fuera.avg)} / ${pct(s.corte.dentro.avg)}` : "—"}
      </td>
    </tr>
    {abierta && tieneJev && (
      <tr className="border-t border-[#232323] bg-[#1c1c1c]">
        <td colSpan={7} className="px-3 py-1.5 text-[11px] text-[#A3A3A0]">
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {s.jev!.map((p) => (
              <span key={p.ticker} className="tabular-nums">
                {p.ticker} <span className="text-[#6E6E6B]">{pct(p.ret)}</span>
              </span>
            ))}
          </span>
        </td>
      </tr>
    )}
    </>
  );
}

/** La traza LEÍDA: qué hizo después cada grupo de cada cohorte. Son agregados puros —
 *  visibles también sin sesión, como el embudo: comportamiento sí, nombres no. Cada fila es
 *  un escaneo; el retorno va desde el precio del día del escaneo hasta hoy, a igual peso.
 *  Dos tarjetas, dos preguntas: "¿eligió bien?" (barras por grupo) y "¿el score predice?"
 *  (la nube score↔retorno) — cada una con su propio guard de "aún sin historial suficiente". */
export function OutcomesRead({ scans, book, onExportGrupos, msgGrupos, onExportScore, msgScore }: {
  scans: OutcomeScan[]; book: OutcomeBook | null;
  onExportGrupos: (p: "x" | "linkedin") => void; msgGrupos: string;
  onExportScore: (p: "x" | "linkedin") => void; msgScore: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as "es" | "en";
  // Por defecto solo DECISIONES (mezclar filas semanales y mensuales invita a compararlas
  // entre sí, y el semanal analiza otra franja); los observatorios quedan tras un toggle —
  // siguen alimentando "¿el score predice?", tirarlos del todo sería desperdiciar señal.
  const [verObs, setVerObs] = useState(false);
  const decisiones = scans.filter((s) => s.mode === "decisión");
  const observatoriosBase = scans.filter((s) => s.mode !== "decisión");
  // Un solo control de orden para las dos cohortes -- comparten cabecera y columnas.
  const { sorted: decisionesOrdenadas, sortKey, sortDir, toggle, ariaSort } =
    useOrden<OutcomeScan, OutSortKey>(decisiones, outAccessor);
  const observatorios = sortRows(observatoriosBase, outAccessor, sortKey, sortDir);
  if (!scans.length && !book) return null;
  const pct = (v: number | null) => (v == null ? "—" : `${sign(v)}${v.toFixed(1)}%`);
  const mostrarObs = verObs || (!book && decisiones.length === 0);
  const masVieja = scans.length ? Math.max(...scans.map((s) => s.days)) : 0;
  const diasLibro = book?.since
    ? Math.max(0, Math.floor((Date.now() - new Date(book.since).getTime()) / 86_400_000))
    : null;
  return (
    <div className="mb-6">
    <Details head={<>
        {t("beta_audit_read")}
        {/* La referencia de cada % tiene que estar EN la cabecera, no en la letra pequeña:
            sin "de su escaneo a hoy" la tabla eran números sin origen ni ventana. */}
        <span className="ml-2 text-[13px] font-normal normal-case tracking-normal text-[#6E6E6B]">
          {t("beta_audit_subtitle")}
        </span>
      </>}>
      <div className="p-4 text-xs leading-relaxed text-[#A3A3A0]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse whitespace-nowrap tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[#6E6E6B]">
                <th className="py-1.5 pr-3 font-semibold" aria-sort={ariaSort("at")}>
                  <button onClick={() => toggle("at")} aria-label={t("beta_sort_date")}
                          className="inline-flex items-center gap-0.5 hover:text-[#A3A3A0]">
                    {t("beta_scan_to_today")}
                    {sortKey === "at" && <span className="text-[8px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
                  </button>
                </th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold" aria-sort={ariaSort("cartera")}>
                  <span className="inline-flex items-center gap-1">
                    <button onClick={() => toggle("cartera")} aria-label={t("beta_attr_ordenar_por_en_cartera")}
                            className="inline-flex items-center gap-0.5 hover:text-[#A3A3A0]">
                      {t("beta_held")}
                      {sortKey === "cartera" && <span className="text-[8px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                    <InfoTip text={t("beta_scan_avg_tip")} /></span>
                </th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold" aria-sort={ariaSort("seleccionados")}>
                  <span className="inline-flex items-center gap-1">
                    <button onClick={() => toggle("seleccionados")} aria-label={t("beta_sort_selected")}
                            className="inline-flex items-center gap-0.5 hover:text-[#A3A3A0]">
                      {t("beta_selected_unfunded")}
                      {sortKey === "seleccionados" && <span className="text-[8px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                    <InfoTip text={t("beta_selected_tip")} /></span>
                </th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold" aria-sort={ariaSort("descartados")}>
                  <span className="inline-flex items-center gap-1">
                    <button onClick={() => toggle("descartados")} aria-label={t("beta_sort_discarded")}
                            className="inline-flex items-center gap-0.5 hover:text-[#A3A3A0]">
                      {t("beta_discarded")}
                      {sortKey === "descartados" && <span className="text-[8px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                    <InfoTip text={t("beta_discarded_tip")} /></span>
                </th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold" aria-sort={ariaSort("jev")}>
                  <span className="inline-flex items-center gap-1">
                    <button onClick={() => toggle("jev")} aria-label={t("beta_sort_jev_shadow")}
                            className="inline-flex items-center gap-0.5 hover:text-[#A3A3A0]">
                      {t("beta_jev_shadow")}
                      {sortKey === "jev" && <span className="text-[8px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                    <InfoTip text={t("beta_jev_tip")} /></span>
                </th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold" aria-sort={ariaSort("spy")}>
                  <span className="inline-flex items-center gap-1">
                    <button onClick={() => toggle("spy")} aria-label={t("beta_sort_sp500")}
                            className="inline-flex items-center gap-0.5 hover:text-[#A3A3A0]">
                      S&P 500
                      {sortKey === "spy" && <span className="text-[8px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                    <InfoTip text={t("beta_index_tip")} /></span>
                </th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">
                  <span className="inline-flex items-center gap-1">{t("beta_cut_out_in")}
                    <InfoTip text={t("beta_cut_tip")} /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* LO REAL primero: el libro vigente desde su compra (ledger, a valor de
                  mercado). La traza no alcanza a la decisión que lo compró, así que esta
                  fila es la única imagen real hasta que las cohortes nuevas maduren. */}
              {book && (
                <tr className="border-t border-[#303030]">
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex items-center gap-1">
                      {t("beta_current_portfolio")}{book.since ? ` · ${t("beta_since", { date: fmtDay(book.since, locale) })}` : ""}
                      <InfoTip text={t("beta_real_ledger_tip")} />
                    </span>
                    {diasLibro != null && <span className="text-[#6E6E6B]"> · {diasLibro} d</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {book.ret == null ? "—" : (
                      <>
                        <span className={book.ret >= 0 ? "font-semibold text-[#6BBE8A]" : "font-semibold text-[#E0776C]"}>
                          {sign(book.ret)}{book.ret.toFixed(1)}%
                        </span>
                        <span className="text-[#6E6E6B]"> ({book.n})</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                  <td className="px-3 py-1.5 text-right">
                    {book.spy == null ? "—" : `${sign(book.spy)}${book.spy.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                </tr>
              )}
              {decisionesOrdenadas.map((s) => <OutRow key={s.at} s={s} pct={pct} />)}
              {observatorios.length > 0 && (
                <tr className="border-t border-[#303030]">
                  <td colSpan={7} className="py-1.5">
                    <button onClick={() => setVerObs(!verObs)}
                            className="text-[11px] text-[#6E6E6B] hover:text-[#A3A3A0]">
                      {mostrarObs ? t("beta_hide") : t("beta_show")} {t("beta_observatories")} ({observatorios.length})
                      {mostrarObs ? "" : ` — ${t("beta_observatory_hypothetical")}`}
                    </button>
                  </td>
                </tr>
              )}
              {mostrarObs && observatorios.map((s) => <OutRow key={s.at} s={s} pct={pct} />)}
            </tbody>
          </table>
        </div>
        <p className="mt-2 border-t border-[#303030] pt-2 text-[11px] text-[#6E6E6B]">
          {t("beta_audit_footnote")}
          {observatorios.length > 0 &&
            ` · ${t("beta_observatory_footnote")}`}
          {masVieja > 0 && masVieja < 14 &&
            ` · ${t("beta_oldest_cohort", { count: masVieja })}`}
        </p>
        <ExportButtons onExport={onExportGrupos} msg={msgGrupos} label={t("beta_pick_question")} />
        <ExportButtons onExport={onExportScore} msg={msgScore} label={t("beta_score_question")} />
      </div>
    </Details>
    </div>
  );
}

/** Un formato por red: cada una recorta a su ratio, y lo que no puede perderse en el recorte
 *  es justamente la cabecera y el pie legal — de ahí que se exporte ya al tamaño de destino.
 *  `label` distingue qué tarjeta exporta este grupo de botones cuando un mismo panel ofrece
 *  varias (la lectura de la auditoría, con "¿eligió bien?" y "¿el score predice?"). */
export function ExportButtons({ onExport, msg, label }: {
  onExport: (preset: "x" | "linkedin") => void; msg: string; label?: string;
}) {
  const t = useTranslations();
  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
      {msg && <span className="mr-auto text-[11px] text-[#6E6E6B]">{msg}</span>}
      <span className="text-[11px] text-[#6E6E6B]">{label ? t("beta_export_card_labeled", { label }) : t("beta_export_card")}</span>
      {([["x", "X"], ["linkedin", "LinkedIn"]] as const)
        .map(([key, netLabel]) => (
          <button
            key={key} onClick={() => onExport(key)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#303030] px-2.5 py-1 text-[11px] font-medium text-[#6E6E6B] transition hover:bg-[#232323] hover:text-[#A3A3A0]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {netLabel}
          </button>
        ))}
    </div>
  );
}
