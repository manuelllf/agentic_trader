"use client";
import { useLocale, useTranslations } from 'next-intl';
import type { ScanReport } from '@/lib/api';
import { InfoTip } from '@/components/InfoTip';
import { fmtTime } from '@/lib/format';
import {
  cascada, fmtNum, fmtScanCost, sectoresTop, universoLinea, type FunnelScan,
} from '@/lib/scan';
import { useOrden } from '@/lib/useOrden';
import { ScanFullButton } from './ScanFullModal';
import { NUMS, T } from './tokens';
import { Details } from './ui';

type SectorSortKey = "sector" | "pre" | "deep" | "peso";
const SECTOR_COLS: { key: SectorSortKey; labelKey: string; align: "left" | "right" }[] = [
  { key: "sector", labelKey: "alpha_sector", align: "left" },
  { key: "pre", labelKey: "alpha_seen", align: "right" },
  { key: "deep", labelKey: "alpha_deep_analysis", align: "right" },
  { key: "peso", labelKey: "alpha_weight", align: "left" },
];

type JevSortKey = "ticker" | "score" | "confidence" | "weight_pct";
const JEV_COLS: { key: JevSortKey; labelKey: string }[] = [
  { key: "ticker", labelKey: "alpha_ticker_industry" },
  { key: "score", labelKey: "alpha_score" },
  { key: "confidence", labelKey: "alpha_confidence" },
  { key: "weight_pct", labelKey: "alpha_weight" },
];

/* Informe del último escaneo: una línea si fue sano; lista ámbar de incidencias; rojo si
   reventó entero. Fuente: /scan/report (persistido), no el estado en memoria del runner. */
export function ScanReportPanel({ r, scan }: { r: ScanReport; scan: FunnelScan | null }) {
  const t = useTranslations();
  const locale: "es" | "en" = useLocale() === "en" ? "en" : "es";
  const text = { t, prefix: "alpha" as const, locale };
  const failed = !!r.error;
  const issues = r.issues ?? [];
  const clean = !failed && issues.length === 0;
  const pasos = cascada(r, scan, text);
  const universo = universoLinea(r, text);
  const cost = fmtScanCost(r.cost, text);
  const sectores = sectoresTop(scan, 6);
  // Peso real: cuota de CADA sector sobre el total de "a fondo" del escaneo entero, no solo los
  // 6 de la tabla -- antes la barra usaba "vistos" (tamaño del universo), que no dice nada de
  // dónde se concentró el análisis caro. Sobre el total nunca se pasa de 100%, así que no hace
  // falta ningún techo artificial como antes.
  const totalDeep = Math.max(1, (scan?.sectores ?? []).reduce((acc, s) => acc + s.deep, 0));
  const sectorRows = sectores.map((s) => ({ ...s, peso: s.deep / totalDeep }));
  const {
    sorted: sortedSectores, sortKey: sectorSortKey, sortDir: sectorSortDir,
    toggle: toggleSector, ariaSort: sectorAriaSort,
  } = useOrden<typeof sectorRows[number], SectorSortKey>(sectorRows, (row, key) => row[key]);

  const jevRows = r.jev_cartera ?? [];
  const {
    sorted: sortedJev, sortKey: jevSortKey, sortDir: jevSortDir,
    toggle: toggleJev, ariaSort: jevAriaSort,
  } = useOrden<typeof jevRows[number], JevSortKey>(jevRows, (row, key) => row[key]);

  return (
    <Details title={t("alpha_latest_scan")}
           meta={fmtTime(r.at, locale)}
           defaultOpen
           accent={failed ? T.bad : issues.length ? T.warn : undefined}
           right={<ScanFullButton />}>
      <div className="px-4 py-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span style={{ color: T.ink2 }}>{t("alpha_mode_label")} <b style={{ color: T.ink }}>{r.mode ?? "—"}</b></span>
          {universo && (
            <span className={NUMS} style={{ color: universo.tone === "ok" ? T.ink2 : T.warn }}>
              {t("alpha_universe_label")} <b>{universo.texto}</b>
              <span style={{ color: T.muted }}> · {universo.detalle}</span>
            </span>
          )}
          {cost && (
            <span className={NUMS} style={{ color: T.muted }}>{cost}</span>
          )}
          {clean && <span className="font-bold" style={{ color: T.good }}>✓ {t("alpha_no_issues")}</span>}
        </div>

        {/* El embudo como cascada: es LA cifra que cuenta qué hace el sistema. */}
        {pasos.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-stretch gap-1.5">
            {pasos.map((p, i) => (
              <div key={p.label} className="flex items-center gap-1.5">
                {i > 0 && <span style={{ color: T.muted }} aria-hidden>→</span>}
                <div className="rounded-md px-2.5 py-1.5" style={{ background: T.panel2 }}>
                  <p className={`text-[15px] font-bold leading-none ${NUMS}`} style={{ color: T.ink }}>
                    {fmtNum(p.value, locale)}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[10.5px] leading-none" style={{ color: T.muted }}>
                    {p.label}
                    {p.pctOfPrev != null && (
                      <span className={NUMS}> · {p.pctOfPrev < 1 ? p.pctOfPrev.toFixed(1) : Math.round(p.pctOfPrev)}%</span>
                    )}
                    {p.hint && <InfoTip text={p.hint} />}
                  </p>
                </div>
              </div>
            ))}
            {(scan?.sin_datos || scan?.prescore_error || scan?.deep_error) ? (
              <span className={`self-center text-[10.5px] ${NUMS}`} style={{ color: T.muted }}>
                ({scan.sin_datos}{t("alpha_ui_sin_datos")}{scan.prescore_error ? ` · ${scan.prescore_error} fallos de pre-score` : ""}{scan.deep_error ? ` · ${scan.deep_error} profundos ilegibles` : ""})
              </span>
            ) : null}
          </div>
        )}

        {/* Por sector: dónde miró y dónde profundizó -- responde al "colapso sectorial".
            table-fixed + colgroup: el ancho de cada columna es fijo de verdad, así que la
            tabla entera nunca pide más ancho del que tiene (nada de scroll interno) -- el
            sector largo trunca con "…" en vez de estirar su columna. */}
        {sectores.length > 0 && (
          <table className={`mt-3 w-full table-fixed text-[11px] ${NUMS}`}>
            <colgroup>
              <col />
              <col style={{ width: "3.5rem" }} />
              <col style={{ width: "3.5rem" }} />
              <col style={{ width: "5.5rem" }} />
            </colgroup>
            <thead>
              <tr style={{ color: T.muted }}>
                {SECTOR_COLS.map((c) => (
                  <th key={c.key}
                      className={`pb-1 font-semibold ${c.align === "right" ? "text-right" : c.key === "peso" ? "pl-3 text-left" : "text-left"}`}
                      aria-sort={sectorAriaSort(c.key)}>
                    <button onClick={() => toggleSector(c.key)} aria-label={t("alpha_sort_by", { label: t(c.labelKey) })}
                            className="inline-flex items-center gap-0.5 hover:opacity-80"
                            style={{ color: sectorSortKey === c.key ? T.ink : T.muted }}>
                      {t(c.labelKey)}
                      {sectorSortKey === c.key && <span className="text-[8px]">{sectorSortDir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedSectores.map((s) => (
                <tr key={s.sector} style={{ color: T.ink2 }}>
                  <td className="max-w-0 truncate py-0.5 pr-2">{s.sector}</td>
                  <td className="py-0.5 text-right">{fmtNum(s.pre, locale)}</td>
                  <td className="py-0.5 text-right" style={{ color: s.deep ? T.ink : T.muted }}>{s.deep}</td>
                  <td className="overflow-hidden py-0.5 pl-3">
                    <span className="block h-[6px] rounded-sm"
                          style={{ width: `${Math.max(2, (s.deep / totalDeep) * 100)}%`, background: T.buy }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {(r.jev_cartera ?? []).length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-semibold" style={{ color: T.ink2 }}>
              {t("alpha_jev_portfolio")}
              <span className="ml-1 font-normal" style={{ color: T.muted }}>
                ({t("alpha_shadow_no_money")} · {t("alpha_top_prescore", { count: 5 })}, {t("alpha_max_industry", { count: 2 })}
                {r.jev_macro ? ` · ${t("alpha_saw_macro_news")}` : ` · ${t("alpha_market_data_only")}`})
              </span>
            </p>
            {/* Industria bajo el ticker y con salto de línea: en columna propia se quedaba en
                ~60 px en móvil y cortaba hasta las cortas. */}
            <table className={`w-full table-fixed text-[11px] ${NUMS}`}>
              <colgroup>
                <col />
                <col style={{ width: "3rem" }} />
                <col style={{ width: "4rem" }} />
                <col style={{ width: "2.75rem" }} />
              </colgroup>
              <thead>
                <tr style={{ color: T.muted }}>
                  {JEV_COLS.map((c) => (
                    <th key={c.key}
                        className={`pb-1 font-semibold ${c.key === "ticker" ? "text-left" : "text-right"}`}
                        aria-sort={jevAriaSort(c.key)}>
                      <button onClick={() => toggleJev(c.key)} aria-label={t("alpha_sort_by", { label: t(c.labelKey) })}
                              className="inline-flex items-center gap-0.5 hover:opacity-80"
                              style={{ color: jevSortKey === c.key ? T.ink : T.muted }}>
                        {t(c.labelKey)}
                        {jevSortKey === c.key && <span className="text-[8px]">{jevSortDir === "desc" ? "↓" : "↑"}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedJev.map((p) => (
                  <tr key={p.ticker} className="align-top" style={{ color: T.ink2 }}>
                    <td className="max-w-0 py-0.5 pr-2">
                      <span className="block font-semibold" style={{ color: T.ink }}>{p.ticker}</span>
                      <span className="block break-words text-[10.5px] leading-snug"
                            style={{ color: T.muted }}>{p.industry}</span>
                    </td>
                    <td className="py-0.5 text-right">{p.score.toFixed(1)}</td>
                    <td className="py-0.5 text-right">
                      {p.confidence == null ? "—" : `${Math.round(p.confidence * 100)}%`}
                    </td>
                    <td className="py-0.5 text-right">{Math.round(p.weight_pct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(r.changes ?? []).length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {(r.changes ?? []).map((c) => (
              <li key={c} style={{ color: T.ink2 }}>
                <span className="mr-1.5" style={{ color: T.buy }} aria-hidden>›</span>{c}
              </li>
            ))}
          </ul>
        )}
        {failed && (
          <p className="mt-2 font-semibold" style={{ color: "#e66767" }}>
            {t("alpha_scan_failed")}: {r.error}
          </p>
        )}
        {issues.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {issues.map((it) => (
              <li key={it} style={{ color: T.ink2 }}>
                <span className="mr-1.5" style={{ color: T.warn }} aria-hidden>▲</span>{it}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Details>
  );
}
