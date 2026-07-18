"use client";

/**
 * Curva histórica: cartera vs S&P 500 en índice base 100 (los flujos no cuentan como
 * rentabilidad — lo descuenta el backend). SVG propio, sin dependencias.
 *
 * Un solo eje: ambas series re-basadas a 100 al inicio de la ventana elegida (1M/3M/6M/Todo),
 * así el rango corto compara "desde entonces" y no arrastra niveles de la inauguración.
 * El S&P va en gris DISCONTINUO a propósito (referencia, no una serie par): identidad por
 * trazo + etiqueta directa + leyenda, nunca solo por color.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { money } from "@/lib/format";
import type { HistoryPoint } from "@/lib/types";

const RANGES = [
  { key: "1M", days: 31 },
  { key: "3M", days: 92 },
  { key: "6M", days: 183 },
  { key: "Todo", days: Infinity },
] as const;

/* Paleta validada (CVD ΔE≥27 y contraste ≥3:1 sobre blanco y sobre #0d0d0d/#1a1a19). */
const THEME = {
  light: {
    line: "#059669", spy: "#64748b", grid: "#eef2f7", base: "#cbd5e1",
    axis: "#94a3b8", ink: "#334155", tipBg: "#ffffff", tipRing: "#e2e8f0",
  },
  dark: {
    line: "#0ea371", spy: "#8896ab", grid: "#2c2c2a", base: "#383835",
    axis: "#898781", ink: "#c3c2b7", tipBg: "#202020", tipRing: "rgba(255,255,255,0.14)",
  },
};

const fmtDay = (iso: string, withYear = false) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", {
    day: "numeric", month: "short", ...(withYear ? { year: "2-digit" } : {}),
  });
// fmtPct PROPIO del chart (no el compartido): deltas del índice base 100, siempre a 1 decimal.
const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export default function HistoryChart({ points, dark = false, mini = false }: {
  points: HistoryPoint[];
  dark?: boolean;
  mini?: boolean;
}) {
  const C = THEME[dark ? "dark" : "light"];
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("Todo");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Render a píxel REAL: alto fijo y ancho medido del contenedor (viewBox 1:1 con los px CSS).
  // Si el viewBox escalara con el panel, en pantallas anchas la gráfica saldría gigante.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [measuredW, setMeasuredW] = useState(660);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setMeasuredW(Math.max(320, es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
    // El wrapper solo existe con >=2 puntos: si los datos llegan tarde, hay que re-observar.
  }, [points.length, mini]);

  const spanDays = useMemo(() => {
    if (points.length < 2) return 0;
    const first = new Date(points[0].date).getTime();
    const last = new Date(points[points.length - 1].date).getTime();
    return (last - first) / 86_400_000;
  }, [points]);

  // Ventana + re-base a 100 en su primer punto (comparación honesta "desde entonces").
  const view = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? Infinity;
    let win = points;
    if (Number.isFinite(days) && points.length > 1) {
      const cut = new Date(points[points.length - 1].date).getTime() - days * 86_400_000;
      const w = points.filter((p) => new Date(p.date).getTime() >= cut);
      if (w.length >= 2) win = w;
    }
    const base = win[0]?.index || 100;
    const spyBase = win.find((p) => p.spy_index != null)?.spy_index ?? null;
    let lastSpy = 100;
    return win.map((p) => {
      const spy = p.spy_index != null && spyBase
        ? (p.spy_index / spyBase) * 100
        : lastSpy; // sin dato del SPY ese día: arrastra el anterior (no rompe la línea)
      lastSpy = spy;
      return { ...p, v: (p.index / base) * 100, s: spy };
    });
  }, [points, range]);

  if (points.length < 2) {
    if (mini) return null;
    return (
      <p className="py-6 text-center text-[12px]" style={{ color: C.axis }}>
        La curva se dibuja con los cierres diarios — aparece con el segundo cierre.
      </p>
    );
  }

  /* ---------- geometría ---------- */
  const W = mini ? 300 : measuredW;
  const H = mini ? 40 : 240;
  const PAD = mini
    ? { l: 2, r: 2, t: 3, b: 3 }
    : { l: 44, r: 62, t: 10, b: 22 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const all = view.flatMap((p) => [p.v, p.s]);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const padY = Math.max((hi - lo) * 0.08, 0.15);
  lo -= padY; hi += padY;

  const x = (i: number) => PAD.l + (view.length > 1 ? (i / (view.length - 1)) * plotW : 0);
  const y = (v: number) => PAD.t + plotH - ((v - lo) / (hi - lo)) * plotH;
  const path = (get: (p: (typeof view)[number]) => number) =>
    view.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(get(p)).toFixed(1)}`).join("");

  // Gridlines a paso "bonito" (~4 líneas), etiquetadas como % sobre la base de la ventana.
  const rawStep = (hi - lo) / 4;
  const step = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100]
    .find((s) => s >= rawStep) ?? 100;
  const gridVals: number[] = [];
  for (let g = Math.ceil(lo / step) * step; g <= hi; g += step) gridVals.push(g);

  // Etiquetas del eje X: primera, última y 1-2 intermedias (con año si la serie cruza de año).
  const crossYear = view[0].date.slice(0, 4) !== view[view.length - 1].date.slice(0, 4);
  const xTicks = view.length <= 2
    ? [0, view.length - 1]
    : [0, Math.floor((view.length - 1) / 2), view.length - 1];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / plotW) * (view.length - 1));
    setHover(Math.max(0, Math.min(view.length - 1, i)));
  };

  const last = view[view.length - 1];
  const h = hover != null ? view[hover] : null;

  /* ---------- mini (portada): dos trazos y ya ---------- */
  if (mini) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full" role="img"
           aria-label={`Cartera ${fmtPct(last.v - 100)} vs S&P 500 ${fmtPct(last.s - 100)} desde ${points[0].date}`}>
        <path d={path((p) => p.s)} fill="none" stroke={C.base} strokeWidth="1.5" strokeDasharray="3 3" />
        <path d={path((p) => p.v)} fill="none" stroke={C.line} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }

  /* ---------- completa: leyenda + rangos + ejes + hover ---------- */
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-4 text-[12px]" style={{ color: C.ink }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: C.line }} />
            Cartera <b className="tabular-nums font-semibold">{fmtPct(last.v - 100)}</b>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0 w-3 border-t-2 border-dashed" style={{ borderColor: C.spy }} />
            S&amp;P 500 <b className="tabular-nums font-semibold">{fmtPct(last.s - 100)}</b>
          </span>
        </div>
        {spanDays > RANGES[0].days && (
          <div className="flex gap-1">
            {RANGES.filter((r) => r.key === "Todo" || spanDays > r.days).map((r) => (
              <button key={r.key} onClick={() => { setRange(r.key); setHover(null); }}
                      className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors"
                      style={range === r.key
                        ? { background: dark ? "#383835" : "#0f172a", color: dark ? "#ffffff" : "#ffffff" }
                        : { color: C.axis }}>
                {r.key}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={wrapRef} className="relative mt-2">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} height={H} className="block w-full touch-none"
             role="img" aria-label="Curva histórica de la cartera frente al S&P 500, base 100"
             onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {gridVals.map((g) => (
            <g key={g}>
              <line x1={PAD.l} y1={y(g)} x2={W - PAD.r} y2={y(g)} stroke={C.grid}
                    strokeWidth="1" strokeDasharray={Math.abs(g - 100) < 1e-9 ? "4 3" : undefined} />
              <text x={PAD.l - 7} y={y(g) + 3.5} textAnchor="end" fontSize="10.5" fill={C.axis}
                    className="tabular-nums">
                {Math.abs(g - 100) < 1e-9 ? "0%" : `${g > 100 ? "+" : "−"}${Math.abs(g - 100) % 1 ? Math.abs(g - 100).toFixed(1) : Math.abs(g - 100)}%`}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={H - 6} fontSize="10.5" fill={C.axis}
                  textAnchor={i === 0 ? "start" : i === view.length - 1 ? "end" : "middle"}>
              {fmtDay(view[i].date, crossYear)}
            </text>
          ))}

          <path d={`${path((p) => p.v)}L${x(view.length - 1).toFixed(1)} ${y(Math.max(lo, Math.min(hi, 100))).toFixed(1)}L${x(0).toFixed(1)} ${y(Math.max(lo, Math.min(hi, 100))).toFixed(1)}Z`}
                fill={C.line} opacity="0.06" />
          <path d={path((p) => p.s)} fill="none" stroke={C.spy} strokeWidth="1.75"
                strokeDasharray="5 4" strokeLinejoin="round" />
          <path d={path((p) => p.v)} fill="none" stroke={C.line} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />

          <text x={W - PAD.r + 7} y={y(last.v) + 3.5} fontSize="10.5" fill={C.ink} fontWeight="600">
            Cartera
          </text>
          <text x={W - PAD.r + 7} y={y(last.s) + (Math.abs(y(last.s) - y(last.v)) < 12 ? (y(last.s) >= y(last.v) ? 13 : -6) : 3.5)}
                fontSize="10.5" fill={C.axis}>
            S&amp;P 500
          </text>

          {h && hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} y1={PAD.t} x2={x(hover)} y2={H - PAD.b}
                    stroke={C.axis} strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(h.v)} r="3.5" fill={C.line} stroke={C.tipBg} strokeWidth="2" />
              <circle cx={x(hover)} cy={y(h.s)} r="3.5" fill={C.spy} stroke={C.tipBg} strokeWidth="2" />
            </g>
          )}
        </svg>

        {h && hover != null && (
          <div className="pointer-events-none absolute top-1 z-10 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed shadow-sm"
               style={{
                 background: C.tipBg, borderColor: C.tipRing, color: C.ink,
                 left: `${(x(hover) / W) * 100}%`,
                 transform: hover > view.length / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
               }}>
            <div style={{ color: C.axis }}>{fmtDay(h.date, true)}</div>
            <div className="tabular-nums">
              <span className="font-semibold" style={{ color: C.line }}>Cartera {fmtPct(h.v - 100)}</span>
              {h.equity && <span style={{ color: C.axis }}> · ${money(h.equity)}</span>}
            </div>
            <div className="tabular-nums" style={{ color: C.spy }}>S&amp;P 500 {fmtPct(h.s - 100)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
