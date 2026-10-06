"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { InfoTip } from "@/components/InfoTip";
import { localeTag, type Locale } from "@/i18n/locale";
import type { RendimientoFicha } from "@/lib/liga/api";
import { claseSigno, porcentaje, signo } from "@/lib/liga/format";
import {
  OBSERVACIONES_MINIMAS, PERIODOS, caidaMaxima, decimalesDeTicks, indiceCercano, inicios, observaciones,
  periodosDisponibles, ticksLimpios, ventana, type Periodo,
} from "@/lib/liga/grafica";
import { Segmentado } from "../../_ui/Segmentado";

const ALTO = 244, IZQ = 46, DER = 52, ARRIBA = 28, ABAJO = 28;

const ETIQUETAS: Record<Periodo, string> = {
  dia: "strategies_period_day", semana: "strategies_period_week", mes: "strategies_period_month",
  jornada: "strategies_period_round", total: "strategies_period_total",
};

const aFecha = (dia: string) => new Date(`${dia}T00:00:00Z`);

export function GraficaRendimiento({ serie, metricas, locale }: {
  serie: RendimientoFicha["serie"];
  metricas: RendimientoFicha["metricas"];
  locale: Locale;
}) {
  const t = useTranslations();
  const idRecorte = useId();
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(340);
  const [periodo, setPeriodo] = useState<Periodo>("total");
  const [cursor, setCursor] = useState<number | null>(null);

  const hayCurva = serie.length >= 2;
  useEffect(() => {
    const elemento = contenedor.current;
    if (!elemento) return;
    const observador = new ResizeObserver(([entrada]) => setAncho(Math.max(260, entrada.contentRect.width)));
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [hayCurva]);

  const disponibles = useMemo(() => periodosDisponibles(serie), [serie]);
  const activo: Periodo = disponibles[periodo] ? periodo : "total";
  const puntos = useMemo(() => ventana(serie, activo), [serie, activo]);
  const corta = useMemo(() => new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "short", timeZone: "UTC" }), [locale]);
  const larga = useMemo(() => new Intl.DateTimeFormat(localeTag(locale), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }), [locale]);
  const dia = (iso: string) => corta.format(aFecha(iso)).replace(/\.$/, "");

  const m = puntos.length;
  const opciones = PERIODOS.filter((p) => disponibles[p]).map((p) => ({ valor: p, etiqueta: t(ETIQUETAS[p]) }));
  if (m < 2) return <div ref={contenedor}><p className="meta">{t("strategies_chart_insufficient_data")}</p></div>;

  const i = cursor !== null && cursor < m ? cursor : m - 1;
  const punto = puntos[i];
  const diferencia = punto.estrategia - punto.sp500;
  const rondaAbierta = puntos[m - 1].provisional ? puntos[m - 1].jornada : null;
  const subtitulo = cursor !== null
    ? `${larga.format(aFecha(punto.dia)).replace(/\./g, "")}${punto.provisional ? t("strategies_provisional_suffix") : ""} · ${t("strategies_chart_since", { from: dia(puntos[0].dia) })}`
    : `${t("strategies_chart_range", { from: dia(puntos[0].dia), to: dia(puntos[m - 1].dia) })}${rondaAbierta != null ? ` · ${t("strategies_chart_round_open", { n: rondaAbierta })}` : ""}`;

  const valores = puntos.flatMap((p) => [p.estrategia, p.sp500]);
  const ticks = ticksLimpios(Math.min(...valores), Math.max(...valores));
  const bajo = ticks[0], alto = ticks[ticks.length - 1];
  const decimales = decimalesDeTicks(ticks);
  const anchoUtil = ancho - IZQ - DER, altoUtil = ALTO - ARRIBA - ABAJO;
  const x = (k: number) => IZQ + (k * anchoUtil) / (m - 1);
  const y = (v: number) => ARRIBA + ((alto - v) * altoUtil) / (alto - bajo);
  const trazo = (clave: "estrategia" | "sp500") =>
    puntos.map((p, k) => `${k === 0 || p.salto ? "M" : "L"}${x(k).toFixed(1)},${y(p[clave]).toFixed(1)}`).join(" ");

  const primeraProvisional = puntos.findIndex((p) => p.provisional);
  const rondas = inicios(puntos);
  let yEstrategia = y(puntos[m - 1].estrategia), ySp = y(puntos[m - 1].sp500);
  if (Math.abs(yEstrategia - ySp) < 14) {
    const medio = (yEstrategia + ySp) / 2;
    [yEstrategia, ySp] = yEstrategia < ySp ? [medio - 7, medio + 7] : [medio + 7, medio - 7];
  }
  const marcasX = m <= 6 ? [0, m - 1] : [0, Math.round((m - 1) / 3), Math.round((2 * (m - 1)) / 3), m - 1];

  const caida = activo === "total" && metricas?.max_drawdown != null ? metricas.max_drawdown : caidaMaxima(puntos);
  const n = activo === "total" && metricas ? metricas.observaciones : observaciones(puntos);
  const volatilidad = activo === "total" ? metricas?.volatilidad ?? null : null;

  const mover = (e: PointerEvent<SVGSVGElement>) => {
    const caja = e.currentTarget.getBoundingClientRect();
    setCursor(indiceCercano(e.clientX - caja.left, IZQ, anchoUtil, m));
  };

  return (
    <div className="rend">
      <p className="rend-sub">{subtitulo}</p>
      <div className="rend-lectura">
        <div className="est"><small>{t("strategies_strategy")}</small><b className="num">{porcentaje(punto.estrategia, 1, locale)}</b></div>
        <div className="sec-2"><small>S&amp;P 500</small><b className="num">{porcentaje(punto.sp500, 1, locale)}</b></div>
        <div className="dif"><small>{t("strategies_difference")}</small>
          <b className={`num ${claseSigno(diferencia)}`}>{signo(diferencia, 1, locale)}{t("strategies_pp_suffix")}</b></div>
      </div>
      <div ref={contenedor} className="chart">
        <svg viewBox={`0 0 ${ancho} ${ALTO}`} role="img" aria-label={t("strategies_chart_aria")}
          onPointerDown={mover} onPointerMove={(e) => { if (e.pointerType === "mouse" || e.buttons) mover(e); }}
          onPointerUp={() => setCursor(null)} onPointerCancel={() => setCursor(null)} onPointerLeave={() => setCursor(null)}>
          <defs><clipPath id={idRecorte}><rect x={IZQ} y={ARRIBA} width={anchoUtil} height={altoUtil} /></clipPath></defs>
          {ticks.map((v) => <g key={v}>
            <line x1={IZQ} x2={ancho - DER} y1={y(v)} y2={y(v)} className={v === 0 ? "zero" : "grid"} />
            <text x={IZQ - 7} y={y(v) + 4} textAnchor="end">{porcentaje(v, v === 0 ? 0 : decimales, locale)}</text>
          </g>)}
          {primeraProvisional >= 0 && <>
            <rect className="band" x={x(primeraProvisional)} y={ARRIBA} width={ancho - DER - x(primeraProvisional)} height={altoUtil} />
            <text x={ancho - DER} y={ARRIBA - 9} textAnchor="end">{t("strategies_provisional")}</text>
          </>}
          {rondas.map((r) => <g key={r.indice}>
            <line x1={x(r.indice)} x2={x(r.indice)} y1={ARRIBA} y2={ARRIBA + altoUtil} className="sep" />
            {x(r.indice) < ancho - DER - 80 && <text x={x(r.indice) + 4} y={ARRIBA - 9}>{t("strategies_round_short", { n: r.jornada })}</text>}
          </g>)}
          <g clipPath={`url(#${idRecorte})`}>
            <path d={trazo("sp500")} className="sp" />
            <path d={trazo("estrategia")} className="me" />
          </g>
          <circle cx={x(m - 1)} cy={y(puntos[m - 1].sp500)} r={3} className="dot-sp" />
          <circle cx={x(m - 1)} cy={y(puntos[m - 1].estrategia)} r={3.6} className="dot-me" />
          <text x={ancho - DER + 7} y={yEstrategia + 4} className="end-me">{signo(puntos[m - 1].estrategia, 1, locale)}</text>
          <text x={ancho - DER + 7} y={ySp + 4}>{signo(puntos[m - 1].sp500, 1, locale)}</text>
          {marcasX.map((k, q) => <text key={k} x={x(k)} y={ALTO - 7}
            textAnchor={q === 0 ? "start" : q === marcasX.length - 1 ? "end" : "middle"}>{dia(puntos[k].dia)}</text>)}
          {cursor !== null && <g>
            <line x1={x(i)} x2={x(i)} y1={ARRIBA} y2={ARRIBA + altoUtil} className="cursor" />
            <circle cx={x(i)} cy={y(punto.sp500)} r={3.4} className="cursor-sp" />
            <circle cx={x(i)} cy={y(punto.estrategia)} r={4.2} className="cursor-me" />
          </g>}
        </svg>
      </div>
      {opciones.length > 1 && (
        <Segmentado className="rend-periodos" etiquetaGrupo={t("strategies_period_group")} opciones={opciones}
          valor={activo} onChange={(p) => { setPeriodo(p); setCursor(null); }} />
      )}
      <div className="rend-metricas">
        <div><small>{t("strategies_max_drawdown")}<InfoTip text={t("strategies_drawdown_help")} /></small>
          <b className="num">{porcentaje(caida * 100, 1, locale)}</b><em>{t("strategies_drawdown_period")}</em></div>
        <div><small>{t("strategies_annual_volatility")}<InfoTip text={t("strategies_volatility_help")} /></small>
          <b className="num">{volatilidad === null ? "—" : porcentaje(volatilidad * 100, 1, locale).replace(/^\+/, "")}</b>
          {volatilidad === null && <em>{t("strategies_vol_missing", { missing: Math.max(0, OBSERVACIONES_MINIMAS - n), total: OBSERVACIONES_MINIMAS })}</em>}</div>
      </div>
      <p className="fine">{t("strategies_chart_note")}</p>
    </div>
  );
}
