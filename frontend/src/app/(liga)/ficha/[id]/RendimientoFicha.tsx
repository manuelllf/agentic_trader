"use client";

import { InfoTip } from "@/components/InfoTip";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/locale";
import type { RendimientoFicha as DatosRendimiento } from "@/lib/liga/api";
import { OBSERVACIONES_MINIMAS } from "@/lib/liga/grafica";
import { GraficaRendimiento } from "./GraficaRendimiento";

const AYUDAS: Record<string, string> = {
  sharpe: "strategies_sharpe_help", sortino: "strategies_sortino_help",
};

function ratio(valor: number | null, locale: Locale): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
}

export function RendimientoFicha({ datos, posiciones = [] }: {
  datos: DatosRendimiento | null | undefined;
  posiciones?: { ticker: string; peso: number }[];
}) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const posicionMaxima = posiciones.reduce((max, p) => Math.max(max, Number(p.peso)), 0);
  const pesoInvertido = posiciones.reduce((total, p) => total + Number(p.peso), 0);
  if (!datos) return null;
  if (datos.estado === "privado") return (
    <section className="sec">
      <div className="sec-t">{t("strategies_daily_performance")}</div>
      <p className="meta">{t("strategies_daily_performance_private")}</p>
    </section>
  );
  if (datos.estado === "sin_datos" || !datos.serie.length) return (
    <section className="sec">
      <div className="sec-t">{t("strategies_daily_performance")}</div>
      <p className="meta">{t("strategies_daily_performance_empty")}</p>
      {posiciones.length > 0 && <p className="fine">
        {t("strategies_position_summary", { count: posiciones.length, top: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(posicionMaxima), cash: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.max(0, 100 - pesoInvertido)) })}
        <InfoTip text={t("strategies_position_summary_help")} />
      </p>}
    </section>
  );
  const m = datos.metricas;
  return (
    <section className="sec">
      <div className="sec-t">{t("strategies_total_performance")} <InfoTip text={t("strategies_total_performance_help")} /></div>
      <GraficaRendimiento serie={datos.serie} metricas={m} locale={locale} />
      {posiciones.length > 0 && <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
        <div className="col-span-3 flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>
          {t("strategies_distribution")} <InfoTip text={t("strategies_distribution_help")} />
        </div>
        <div><small className="block text-xs" style={{ color: "var(--muted)" }}>{t("strategies_positions")}</small><b className="num">{posiciones.length}</b></div>
        <div><small className="block text-xs" style={{ color: "var(--muted)" }}>{t("strategies_top_weight")}</small><b className="num">{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(posicionMaxima)} %</b></div>
        <div><small className="block text-xs" style={{ color: "var(--muted)" }}>{t("strategies_cash")}</small><b className="num">{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.max(0, 100 - pesoInvertido))} %</b></div>
      </div>}
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        {m && m.observaciones < OBSERVACIONES_MINIMAS
          ? t("strategies_observations_missing", { count: m.observaciones, total: OBSERVACIONES_MINIMAS })
          : t("strategies_observations_count", { count: m?.observaciones ?? 0 })}
      </p>
      <details className="more">
        <summary>{t("strategies_more_metrics")}</summary>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["Sharpe", m?.sharpe ?? null, t(AYUDAS.sharpe)],
            ["Sortino", m?.sortino ?? null, t(AYUDAS.sortino)],
          ] as const).map(([label, value, help]) => (
            <div key={label} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
              <div className="flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>{label}<InfoTip text={help} /></div>
              <b className="num text-base">{ratio(value, locale)}</b>
            </div>
          ))}
        </div>
      </details>
      <p className="fine">{datos.metodologia} {datos.provisional_hasta && t("strategies_provisional_until", { date: datos.provisional_hasta })}</p>
      {datos.incompleta && <p className="fine">{t("strategies_incomplete_series_note")}</p>}
    </section>
  );
}
