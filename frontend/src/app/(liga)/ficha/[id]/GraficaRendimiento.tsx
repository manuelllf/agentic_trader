"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { localeTag, type Locale } from "@/i18n/locale";
import type { RendimientoFicha } from "@/lib/liga/api";
import { porcentaje, signo } from "@/lib/liga/format";
import { PERIODOS, indiceCercano, periodosDisponibles, ventana, type Periodo } from "@/lib/liga/grafica";
import { claseDe } from "../../liga/ListaRanking";
import { SegmentoLiga } from "../../liga/SegmentoLiga";

const ALTO = 200, ARRIBA = 14, ABAJO = 22, DER = 44;

const ETIQUETAS: Record<Periodo, string> = {
  dia: "strategies_period_day", semana: "strategies_period_week", mes: "strategies_period_month",
  jornada: "strategies_period_round", total: "strategies_period_total",
};
const ULTIMO: Record<Periodo, string> = {
  dia: "ficha_ult_dia", semana: "ficha_ult_semana", mes: "ficha_ult_mes",
  jornada: "ficha_ult_jornada", total: "ficha_desde_inicio",
};

const aFecha = (dia: string) => new Date(`${dia}T00:00:00Z`);

export function GraficaRendimiento({ serie, locale }: {
  serie: RendimientoFicha["serie"];
  metricas: RendimientoFicha["metricas"];
  locale: Locale;
}) {
  const t = useTranslations();
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(340);
  const [periodo, setPeriodo] = useState<Periodo>("total");
  const [cursor, setCursor] = useState<number | null>(null);

  const disponibles = useMemo(() => periodosDisponibles(serie), [serie]);
  const activo: Periodo = disponibles[periodo] ? periodo : "total";
  const puntos = useMemo(() => ventana(serie, activo), [serie, activo]);
  const m = puntos.length;

  // El ancho sale del contenedor; el efecto se vuelve a enganchar cuando aparece la curva.
  const hayCurva = m >= 2;
  useEffect(() => {
    const elemento = contenedor.current;
    if (!elemento) return;
    const observador = new ResizeObserver(([entrada]) => setAncho(Math.max(280, entrada.contentRect.width)));
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [hayCurva]);

  const corta = useMemo(() => new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "short", timeZone: "UTC" }), [locale]);
  const dia = (iso: string) => corta.format(aFecha(iso)).replace(/\.$/, "");

  if (m < 2) return <p className="lv-pie">{t("strategies_chart_insufficient_data")}</p>;

  const opciones = PERIODOS.filter((p) => disponibles[p]).map((p) => ({ valor: p, etiqueta: t(ETIQUETAS[p]) }));
  const ee = puntos.map((p) => p.estrategia), ss = puntos.map((p) => p.sp500);
  const lo = Math.min(...ee, ...ss, 0), hi = Math.max(...ee, ...ss, 0), paso = (hi - lo) / 3 || 1;
  const anchoUtil = ancho - DER;
  const x = (k: number) => (k / (m - 1)) * anchoUtil;
  const y = (v: number) => ARRIBA + (1 - (v - lo) / (hi - lo || 1)) * (ALTO - ARRIBA - ABAJO);
  const linea = (vs: number[]) => vs.map((v, k) => `${k && !puntos[k].salto ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const i = cursor !== null && cursor < m ? cursor : m - 1;
  const d = ee[i] - ss[i];
  const ejeX = [0, Math.floor((m - 1) / 2), m - 1];
  const lineas = [0, 1, 2, 3].map((k) => lo + paso * k);

  const mover = (e: PointerEvent<SVGSVGElement>) => {
    const caja = e.currentTarget.getBoundingClientRect();
    setCursor(indiceCercano(e.clientX - caja.left, 0, anchoUtil, m));
  };

  return (
    <>
      <div className="fi-graf-cab">
        <small>{cursor !== null ? dia(puntos[i].dia) : t(ULTIMO[activo])}</small>
        <p>{t.rich("ficha_graf_linea", {
          strategy: porcentaje(ee[i], 1, locale),
          sp: porcentaje(ss[i], 1, locale),
          diff: `${signo(d, 1, locale)} pp`,
          b: (c) => <b>{c}</b>,
          dif: (c) => <span className={`${claseDe(d) || "igual"}-t`}>{c}</span>,
        })}</p>
      </div>
      <div ref={contenedor} className="fi-graf">
        <svg viewBox={`0 0 ${ancho} ${ALTO}`} role="img" aria-label={t("strategies_chart_aria")}
          onPointerDown={mover} onPointerMove={(e) => { if (e.pointerType === "mouse" || e.buttons) mover(e); }}
          onPointerUp={() => setCursor(null)} onPointerCancel={() => setCursor(null)} onPointerLeave={() => setCursor(null)}>
          {lineas.map((v, k) => <g key={k}>
            <line x1={0} x2={anchoUtil} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={anchoUtil + 8} y={y(v) + 4} fontSize={11} fill="var(--muted)">{porcentaje(v, 1, locale)}</text>
          </g>)}
          {ejeX.map((k, q) => <text key={q} x={x(k)} y={ALTO - 4} fontSize={11} fill="var(--muted)"
            textAnchor={q === 0 ? "start" : q === 2 ? "end" : "middle"}>{dia(puntos[k].dia)}</text>)}
          <path d={linea(ss)} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 4" />
          <path d={linea(ee)} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
          {cursor !== null && <line x1={x(i)} x2={x(i)} y1={ARRIBA - 6} y2={ALTO - ABAJO} stroke="var(--line2)" />}
          <circle cx={x(i)} cy={y(ss[i])} r={3.5} fill="var(--muted)" />
          <circle cx={x(i)} cy={y(ee[i])} r={4.5} fill="var(--ink)" stroke="var(--bg)" strokeWidth={2} />
        </svg>
      </div>
      {opciones.length > 1 && (
        <SegmentoLiga className="fi-seg-peq" etiquetaGrupo={t("strategies_period_group")} opciones={opciones}
          valor={activo} onChange={(p) => { setPeriodo(p); setCursor(null); }} />
      )}
    </>
  );
}
