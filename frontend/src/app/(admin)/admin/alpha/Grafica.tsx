"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type PointerEvent } from "react";
import { Segmentado } from "../_panel/ui";
import { aNumero, dinero, fecha, razon, tonoDe } from "./formato";
import type { PuntoSerie } from "./tipos";

const ANCHO = 360, ALTO = 200, ARRIBA = 14, ABAJO = 22, DERECHA = 64;
const PERIODOS = [{ valor: "1m", dias: 31 }, { valor: "3m", dias: 92 }, { valor: "todo", dias: Infinity }] as const;
type Periodo = (typeof PERIODOS)[number]["valor"];

/** Índice del punto bajo el dedo; la franja de la derecha (las etiquetas) no cuenta. */
export function indiceCursor(clientX: number, izquierda: number, ancho: number, n: number): number {
  if (n <= 1 || ancho <= 0) return 0;
  const util = ancho * (1 - DERECHA / ANCHO);
  return Math.max(0, Math.min(n - 1, Math.round(((clientX - izquierda) / util) * (n - 1))));
}

const recorte = (serie: PuntoSerie[], dias: number): PuntoSerie[] => {
  if (!isFinite(dias) || serie.length === 0) return serie;
  const fin = Date.parse(`${serie[serie.length - 1].fecha}T00:00:00Z`);
  return serie.filter(p => fin - Date.parse(`${p.fecha}T00:00:00Z`) <= (dias - 1) * 86_400_000);
};

/** Valor de la cartera por día, con cursor al tocar o pasar el ratón. Con un solo día pinta un único punto. */
export function Grafica({ serie }: { serie: PuntoSerie[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const [periodo, setPeriodo] = useState<Periodo>("todo");
  const [cursor, setCursor] = useState<number | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const apretado = useRef(false);

  if (serie.length === 0) return null;
  const puntos = recorte(serie, PERIODOS.find(p => p.valor === periodo)!.dias);
  const valores = puntos.map(p => aNumero(p.valor_total));
  const n = puntos.length;
  const util = ANCHO - DERECHA;
  let bajo = Math.min(...valores), alto = Math.max(...valores);
  if (alto === bajo) { const margen = Math.max(Math.abs(bajo) * 0.01, 1); bajo -= margen; alto += margen; }
  const paso = (alto - bajo) / 3;
  const X = (i: number) => (n > 1 ? (i / (n - 1)) * util : util / 2);
  const Y = (v: number) => ARRIBA + (1 - (v - bajo) / (alto - bajo)) * (ALTO - ARRIBA - ABAJO);
  const trazo = valores.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const i = cursor !== null && cursor < n ? cursor : n - 1;
  const cambio = n > 1 && valores[0] !== 0 ? valores[i] / valores[0] - 1 : null;
  const etiquetaX = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const r = caja.current?.getBoundingClientRect();
    if (r) setCursor(indiceCursor(e.clientX, r.left, r.width, n));
  };

  return (
    <div className="pa-graf-caja">
      <div className="pa-graf-cab">
        <small>{cursor !== null ? fecha(puntos[i].fecha, locale) : n === 1 ? t("pnl_agente_grafica_un_dia", { fecha: fecha(puntos[0].fecha, locale) })
          : t("pnl_agente_grafica_desde", { fecha: fecha(puntos[0].fecha, locale) })}</small>
        <p><b>{dinero(valores[i], locale)}</b>{cambio !== null && <> · <span className={tonoDe(cambio)}>{razon(cambio, locale)}</span></>}</p>
      </div>
      <div ref={caja} className="pa-graf" data-testid="pa-grafica" onPointerDown={e => { apretado.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); mover(e); }}
        onPointerMove={e => { if (apretado.current || e.pointerType === "mouse") mover(e); }}
        onPointerUp={() => { apretado.current = false; setCursor(null); }} onPointerCancel={() => { apretado.current = false; setCursor(null); }}
        onPointerLeave={e => { if (e.pointerType === "mouse") setCursor(null); }}>
        <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" aria-label={t("pnl_agente_grafica_aria")}>
          {[0, 1, 2, 3].map(k => {
            const m = bajo + paso * k;
            return (
              <g key={k}>
                <line x1="0" x2={util} y1={Y(m)} y2={Y(m)} stroke="var(--line)" />
                <text x={util + 8} y={Y(m) + 4} fontSize="11" fill="var(--muted)">{new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(m)}</text>
              </g>
            );
          })}
          {etiquetaX.map(k => (
            <text key={k} x={X(k)} y={ALTO - 4} fontSize="11" fill="var(--muted)" textAnchor={n === 1 ? "middle" : k === 0 ? "start" : k === n - 1 ? "end" : "middle"}>{fecha(puntos[k].fecha, locale)}</text>
          ))}
          {n > 1 && <path d={trazo} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />}
          {cursor !== null && <line x1={X(i)} x2={X(i)} y1={ARRIBA - 6} y2={ALTO - ABAJO} stroke="var(--line2)" />}
          <circle cx={X(i)} cy={Y(valores[i])} r="4.5" fill="var(--ink)" stroke="var(--bg)" strokeWidth="2" />
        </svg>
      </div>
      {n > 1 || serie.length > 1 ? (
        <Segmentado etiquetaGrupo={t("pnl_agente_periodo_aria")} valor={periodo} onChange={v => { setPeriodo(v); setCursor(null); }}
          opciones={PERIODOS.map(p => ({ valor: p.valor, etiqueta: t(`pnl_agente_periodo_${p.valor}`) }))} />
      ) : null}
    </div>
  );
}
