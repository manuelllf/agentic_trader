"use client";

import { InfoTip } from "@/components/InfoTip";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/locale";
import type { RendimientoFicha as DatosRendimiento } from "@/lib/liga/api";
import { porcentaje, signo } from "@/lib/liga/format";

const AYUDAS: Record<string, string> = {
  sharpe: "strategies_sharpe_help", sortino: "strategies_sortino_help",
  volatilidad: "strategies_volatility_help", drawdown: "strategies_drawdown_help",
};

function fmt(valor: number | null, tipo: string, locale: Locale): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  return tipo === "pct"
    ? porcentaje(valor * 100, 1, locale)
    : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
}

function Gráfico({ puntos, locale, t }: { puntos: DatosRendimiento["serie"]; locale: Locale; t: (key: string) => string }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(720);
  useEffect(() => {
    const elemento = contenedor.current;
    if (!elemento) return;
    const observador = new ResizeObserver(([entrada]) => {
      setAncho(Math.max(240, entrada.contentRect.width));
    });
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [puntos.length]);
  if (puntos.length < 2) return <p className="meta">{t("strategies_chart_insufficient_data")}</p>;
  const W = ancho, H = 240, L = 42, R = 12, T = 12, B = 28;
  const vals = puntos.flatMap((p) => [p.estrategia, p.sp500]);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const pad = Math.max((max - min) * .12, 1);
  const lo = min - pad, hi = max + pad;
  const x = (i: number) => L + i * (W - L - R) / (puntos.length - 1);
  const y = (v: number) => T + (hi - v) * (H - T - B) / (hi - lo);
  const path = (key: "estrategia" | "sp500", provisional: boolean) => {
    let previous = -2;
    return puntos.map((p, i) => {
      if (p.provisional !== provisional) { previous = -2; return ""; }
      const command = previous === i - 1 && !p.salto ? "L" : "M";
      previous = i;
      return `${command}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`;
    }).filter(Boolean).join(" ");
  };
  return (
    <div ref={contenedor} className="chart" role="img" aria-label={t("strategies_chart_aria")}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        {[lo, (lo + hi) / 2, hi].map((v) => <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "zero" : "grid"} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end">{new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v)}%</text>
        </g>)}
        <path d={path("sp500", false)} className="sp" />
        <path d={path("sp500", true)} className="sp" />
        <path d={path("estrategia", false)} className="me" />
        <path d={path("estrategia", true)} className="me" style={{ strokeDasharray: "3 4", opacity: .75 }} />
        <text x={L} y={H - 5}>{puntos[0].dia}</text>
        <text x={W - R} y={H - 5} textAnchor="end">{puntos[puntos.length - 1].dia}</text>
      </svg>
      <div className="legend2"><span><i />{t("strategies_strategy")}</span><span><i className="d" />S&amp;P 500</span></div>
    </div>
  );
}

export function RendimientoFicha({ datos, posiciones = [] }: {
  datos: DatosRendimiento | null | undefined;
  posiciones?: { ticker: string; peso: number }[];
}) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const pct = (value: number) => porcentaje(value, 1, locale);
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
  const ultimo = datos.serie[datos.serie.length - 1];
  const retorno = [
    [t("strategies_strategy"), ultimo.estrategia, "%"],
    ["S&P 500", ultimo.sp500, "%"],
    [t("strategies_difference"), ultimo.estrategia - ultimo.sp500, " pp"],
  ] as const;
  return (
    <section className="sec">
      <div className="sec-t">{t("strategies_total_performance")} <InfoTip text={t("strategies_total_performance_help")} /></div>
      <div className="mb-4 grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
        {retorno.map(([label, value, unit], index) => <div key={label} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
          <div className="text-xs" style={{ color: "var(--muted)" }}>{label}{ultimo.provisional && index === 0 ? t("strategies_provisional_suffix") : ""}</div>
          <b className="num text-base">{unit === "%" ? pct(value) : `${signo(value, 1, locale)}${t("strategies_pp_suffix")}`}</b>
        </div>)}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <Gráfico puntos={datos.serie} locale={locale} t={(key) => t(key)} />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {([
            [t("strategies_max_drawdown"), m?.max_drawdown ?? null, "pct", t(AYUDAS.drawdown)],
            [t("strategies_annual_volatility"), m?.volatilidad ?? null, "pct", t(AYUDAS.volatilidad)],
          ] as const).map(([label, value, kind, help]) => (
            <div key={label} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
              <div className="flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>{label}<InfoTip text={help} /></div>
              <b className="num text-base">{fmt(value, kind, locale)}</b>
            </div>
          ))}
          {posiciones.length > 0 && <div className="col-span-2 grid grid-cols-3 gap-2 rounded-xl border px-3 py-2 lg:col-span-1 lg:grid-cols-1" style={{ borderColor: "var(--line)" }}>
            <div className="col-span-3 flex items-center gap-1 text-xs lg:col-span-1" style={{ color: "var(--muted)" }}>
              {t("strategies_distribution")} <InfoTip text={t("strategies_distribution_help")} />
            </div>
            <div><small className="block text-xs" style={{ color: "var(--muted)" }}>{t("strategies_positions")}</small><b className="num">{posiciones.length}</b></div>
            <div><small className="block text-xs" style={{ color: "var(--muted)" }}>{t("strategies_top_weight")}</small><b className="num">{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(posicionMaxima)} %</b></div>
            <div><small className="block text-xs" style={{ color: "var(--muted)" }}>{t("strategies_cash")}</small><b className="num">{new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.max(0, 100 - pesoInvertido))} %</b></div>
          </div>}
          <p className="col-span-2 text-xs leading-relaxed lg:col-span-1" style={{ color: "var(--muted)" }}>
            {m && m.observaciones < 60
              ? t("strategies_observations_missing", { count: m.observaciones, total: 60 })
              : t("strategies_observations_count", { count: m?.observaciones ?? 0 })}
          </p>
        </div>
      </div>
      <details className="more">
        <summary>{t("strategies_more_metrics")}</summary>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["Sharpe", m?.sharpe ?? null, t(AYUDAS.sharpe)],
            ["Sortino", m?.sortino ?? null, t(AYUDAS.sortino)],
          ] as const).map(([label, value, help]) => (
            <div key={label} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
              <div className="flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>{label}<InfoTip text={help} /></div>
              <b className="num text-base">{fmt(value, "ratio", locale)}</b>
            </div>
          ))}
        </div>
      </details>
      <p className="fine">{datos.metodologia} {datos.provisional_hasta && t("strategies_provisional_until", { date: datos.provisional_hasta })}</p>
      {datos.incompleta && <p className="fine">{t("strategies_incomplete_series_note")}</p>}
    </section>
  );
}
