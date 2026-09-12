"use client";

// Portada pública: sobria y factual, sin reclamos comerciales. Vista previa de las 3 salas
// (teaser vía GET /overview, sin token) — Beta es de libre acceso, Alpha pide login al entrar
// (AuthGate vive dentro de /real, no aquí).

import Link from "next/link";
import { useEffect, useState } from "react";
import { getHistory, getOverview } from "@/lib/api";
import HistoryChart from "@/components/HistoryChart";
import { fmtPct } from "@/lib/format";
import type { HistoryPoint, Overview } from "@/lib/types";

// Mismos valores que T.good/T.bad en real/tokens.ts y momentum/tokens.ts.
const pctTone = (v: number | null) =>
  v == null || v === 0 ? "text-[#6E6E6B]" : v > 0 ? "text-[#6BBE8A]" : "text-[#E0776C]";

// Acento único de marca -- mismo valor que real/tokens.ts (T.buy) y momentum/tokens.ts (T.entry).
const ACCENT = "#4FA39D";

// Las iniciales α·β·Ω son la firma de las 3 salas -- Fraunces itálica (la misma serif reservada
// para el titular, "el único momento con alma tipográfica") en vez de la mono de cualquier
// etiqueta de UI, para que lean como nombre propio y no como un icono suelto (feedback 11-sep-2026).
const MARK: React.CSSProperties = {
  fontFamily: "var(--font-land-serif)", fontStyle: "italic",
  fontOpticalSizing: "none", fontVariationSettings: '"opsz" 9',
};

// Fondo vivo (12-sep-2026, "un fondo bonito, vivo, que aporte profundidad"): una cesta de
// velas + una curva, el mismo vocabulario visual que el resto de la casa (ver AlertaCard,
// HistoryChart), no una textura decorativa importada de fuera. `absolute` sobre TODA la altura
// de la página, NO `fixed` -- en móvil, un elemento fixed fuerza recomponer esa capa en cada
// frame de scroll, y con la animación encima iba a saltos ("de puta pena", feedback 12-sep-2026).
// Absolute scrollea con el documento como cualquier fondo normal, sin ese coste. Muy translúcido
// para no pisar el texto, y con `prefers-reduced-motion` respetado -- sin el `<style>` global no
// hay forma de apuntar a esa media query desde un `style` inline.
function AmbientChart() {
  const velas = [
    18, 34, 22, 46, 30, 52, 38, 64, 44, 58, 36, 70, 48, 62, 40, 76, 54, 68, 46, 82,
    58, 72, 50, 88, 62, 78, 56, 94, 66, 84,
  ];
  return (
    <div aria-hidden className="ambient-chart pointer-events-none absolute inset-x-0 top-0 -z-10 h-[900px]" style={{ opacity: 0.1 }}>
      <style>{`
        .ambient-chart .ambient-drift { animation: ambient-drift 26s ease-in-out infinite alternate; will-change: transform; }
        .ambient-chart .ambient-drift-slow { animation: ambient-drift-slow 34s ease-in-out infinite alternate; will-change: transform; }
        @keyframes ambient-drift {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(0, -22px, 0); }
        }
        @keyframes ambient-drift-slow {
          from { transform: translate3d(-14px, 0, 0) scale(1); }
          to   { transform: translate3d(14px, 0, 0) scale(1.03); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ambient-chart .ambient-drift, .ambient-chart .ambient-drift-slow { animation: none; }
        }
      `}</style>
      <svg viewBox="0 0 1200 800" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="ambientFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.9" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
          <radialGradient id="ambientGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.5" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle className="ambient-drift-slow" cx="980" cy="160" r="360" fill="url(#ambientGlow)" />

        {/* Cesta de velas, apoyada en la base -- mismo trazo que un candlestick real, sin
            pretender ser datos de verdad. */}
        <g className="ambient-drift" transform="translate(60,0)">
          {velas.map((h, i) => (
            <rect key={i} x={i * 24} y={620 - h * 3} width="10" height={h * 3}
                  fill={i % 3 === 0 ? ACCENT : "#EFEFED"} />
          ))}
        </g>

        {/* Curva de precio de fondo, la misma silueta que HistoryChart -- área bajo la línea con
            degradado, para que lea a "gráfica" y no a garabato. */}
        <g className="ambient-drift-slow">
          <path d="M0,540 C120,500 200,600 320,560 C440,520 520,380 640,400 C760,420 820,320 940,300 C1060,280 1140,340 1200,300 L1200,800 L0,800 Z"
                fill="url(#ambientFade)" />
          <path d="M0,540 C120,500 200,600 320,560 C440,520 520,380 640,400 C760,420 820,320 940,300 C1060,280 1140,340 1200,300"
                fill="none" stroke={ACCENT} strokeWidth="2.5" />
        </g>
      </svg>
    </div>
  );
}

// Ilustración del hero: esquemática a propósito (nunca un ticker real, ver [[no-fake-data]]),
// mismo lenguaje visual que una AlertaCard de verdad (grid Señal/Hoy/Retorno) para que no lea a
// stock genérico sino a "así se ve una señal real en la sala". `md:self-start` es el fix real
// (feedback 12-sep-2026, "le sobra media card"): el grid estiraba esta columna a la altura de
// la de texto, y el SVG con aspect-ratio fijo dejaba medio cuadro vacío debajo.
function HeroChart() {
  return (
    <div className="mt-8 hidden self-start rounded-2xl border border-[#303030] bg-[#1C1C1C] md:block">
      <div className="flex items-center justify-between border-b border-[#303030] px-5 py-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#6E6E6B]">Ejemplo esquemático</span>
        <span className="rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide"
              style={{ background: "rgba(79,163,157,0.14)", color: ACCENT }}>
          Suelo reactivo
        </span>
      </div>
      <svg viewBox="0 0 400 210" className="w-full" role="img"
           aria-label="Línea de precio esquemática con un punto de entrada de señal marcado, ejemplo ilustrativo sin datos reales">
        <defs>
          <linearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.35" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="24" y1="160" x2="376" y2="160" stroke="#303030" strokeWidth="1" />
        <path d="M24,120 C55,128 78,108 100,138 C122,164 128,178 148,176 C168,174 180,150 205,132 C232,112 255,96 280,100 C308,105 330,80 352,58 L376,44"
              fill="none" stroke="#565654" strokeWidth="1.5" />
        <path d="M24,120 C55,128 78,108 100,138 C122,164 128,178 148,176 C168,174 180,150 205,132 C232,112 255,96 280,100 C308,105 330,80 352,58 L376,44 L376,160 L24,160 Z"
              fill="url(#heroFade)" />
        <circle cx="148" cy="176" r="10" fill={ACCENT} opacity="0.16" />
        <circle cx="148" cy="176" r="4" fill={ACCENT} />
        <text x="164" y="180" fontSize="10.5" fill={ACCENT} fontWeight="600">entrada</text>
      </svg>
      <p className="border-t border-[#303030] px-5 py-3 text-[11px] leading-relaxed text-[#565654]">
        Ilustrativo: así se ve una entrada cuando el precio revierte tras la caída, no es un ticker real.
      </p>
    </div>
  );
}

// Relleno de Omega en "Estado real": Alpha y Beta tienen un P&L real que enseñar en ese hueco
// (número grande + mini-histórico); Omega no tiene cartera, así que un número falso ahí sería
// peor que no tenerlo. Mismas velas en miniatura que la ilustración del hero, a la altura del
// mini-histórico de sus hermanas -- ni un hueco vacío ni una palabra fingiendo ser una cifra
// (feedback 12-sep-2026, "Momentum ahí enorme desentona").
function MiniBars() {
  const h = [8, 14, 10, 18, 13, 20, 15, 24, 18, 22];
  return (
    <svg viewBox="0 0 100 26" className="h-6 w-full" aria-hidden>
      {h.map((v, i) => (
        <rect key={i} x={i * 10.4} y={26 - v} width="6" height={v} rx="1"
              fill={i === h.length - 1 ? ACCENT : "#383838"} />
      ))}
    </svg>
  );
}

// Flecha de esquina: la card entera es el link, un botón "Entrar" encima era redundante
// (feedback 9-sep-2026, "más minimalista").
function CornerArrow({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" className="absolute right-3 top-3 h-4 w-4 transition group-hover:translate-x-0.5 sm:right-5 sm:top-5 sm:h-5 sm:w-5"
         fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

export default function Landing() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  // Mini-curvas (públicas): Alpha llega sin equity -- solo fechas y %, como el teaser.
  const [shadowHist, setShadowHist] = useState<HistoryPoint[]>([]);
  const [realHist, setRealHist] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    let alive = true;
    getOverview()
      .then((o) => { if (alive) setData(o); })
      .catch(() => { /* backend caído: se queda en "—", sin romper ni pedir login aquí */ })
      .finally(() => { if (alive) setLoading(false); });
    getHistory("shadow").then((h) => { if (alive) setShadowHist(h.series); }).catch(() => {});
    getHistory("real").then((h) => { if (alive) setRealHist(h.series); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const shadow = data?.shadow;
  const real = data?.real;

  return (
    <div className="relative isolate min-h-[100dvh] overflow-hidden bg-[#0A0A0A] text-[#A3A3A0]">
      <AmbientChart />
      <header className="mx-auto flex max-w-5xl items-center px-4 py-6 sm:px-8">
        <span className="text-[28px] font-medium tracking-tight text-white" style={MARK}>
          α<span style={{ color: ACCENT }}>·</span>β<span style={{ color: ACCENT }}>·</span>Ω
        </span>
      </header>

      {/* Acceso inmediato a las 3 salas — lo primero que se puede hacer, sin bajar a leer nada.
          Solo en móvil (feedback 12-sep-2026): en desktop ya está "Estado real" a un scroll
          corto y esta fila quedaba redundante -- las mismas 3 salas dos veces en pantalla. */}
      <div className="mx-auto max-w-5xl px-4 sm:hidden">
        <div className="grid grid-cols-3 gap-2">
          <Link href="/alpha" className="group relative flex flex-col justify-between rounded-xl border border-[#303030] bg-[#1C1C1C] p-2.5 transition hover:border-[#383838] sm:rounded-2xl sm:p-4">
            <CornerArrow color={ACCENT} />
            <span className="text-[22px] font-medium sm:text-[26px]" style={{ ...MARK, color: ACCENT }}>α</span>
            <span className="mt-1 text-sm font-bold text-[#6E6E6B]">Cartera real</span>
          </Link>
          <Link href="/beta" className="group relative flex flex-col justify-between rounded-xl border border-[#303030] bg-[#1C1C1C] p-2.5 transition hover:border-[#383838] sm:rounded-2xl sm:p-4">
            <CornerArrow color="#6E6E6B" />
            <span className="text-[22px] font-medium text-[#6E6E6B] sm:text-[26px]" style={MARK}>β</span>
            <span className={`mt-1 text-sm font-bold tabular-nums ${pctTone(shadow?.return_pct ?? null)}`}>{loading ? "—" : fmtPct(shadow?.return_pct ?? null)}</span>
          </Link>
          <Link href="/omega" className="group relative flex flex-col justify-between rounded-xl border border-[#303030] bg-[#1C1C1C] p-2.5 transition hover:border-[#383838] sm:rounded-2xl sm:p-4">
            <CornerArrow color={ACCENT} />
            <span className="text-[22px] font-medium sm:text-[26px]" style={{ ...MARK, color: ACCENT }}>Ω</span>
            <span className="mt-1 text-sm font-bold text-[#6E6E6B]">Momentum</span>
          </Link>
        </div>
      </div>

      {/* Hero editorial: el único momento con alma tipográfica antes de la precisión de las
          salas -- Fraunces solo aquí, el resto de la app se queda en la fuente de sistema. */}
      <div className="mx-auto max-w-5xl px-4 pb-8 pt-10 sm:px-8 sm:pb-14 md:grid md:grid-cols-[1.05fr_0.95fr] md:gap-14 md:pb-20">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: ACCENT }}>
            Tres libros · una tesis
          </p>
          <h1
            style={{ fontFamily: "var(--font-land-serif)", lineHeight: 1.1,
                     fontOpticalSizing: "none", fontVariationSettings: '"opsz" 9' }}
            className="mt-3 text-[32px] font-medium text-white sm:text-[42px] lg:text-[50px]"
          >
            Dejar que el dato decida,<br className="hidden sm:block" /> no la corazonada.
          </h1>
          <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-[#6E6E6B]">
            <strong className="text-[17px] font-medium text-[#A3A3A0]" style={MARK}>Alpha</strong> analiza fundamentales con IA y ejecuta
            capital real, con <strong className="text-[17px] font-medium text-[#A3A3A0]" style={MARK}>Beta</strong> como réplica pública
            en papel del mismo método. <strong className="text-[17px] font-medium text-[#A3A3A0]" style={MARK}>Omega</strong> caza rotación de
            mercado antes de que tenga nombre en ningún radar.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-5">
            <Link href="/beta" className="rounded-full px-5 py-3 text-[14px] font-semibold text-[#131313] transition hover:opacity-90" style={{ background: ACCENT }}>
              Ver la cartera en papel
            </Link>
            <a href="#estado" className="text-[14px] font-medium text-[#6E6E6B] underline decoration-dotted underline-offset-4 hover:text-[#A3A3A0]">
              Cómo va cada sala ahora →
            </a>
          </div>
          <p className="mt-10 font-mono text-[10.5px] text-[#565654]">
            No constituye recomendación de inversión · datos con fines educativos y de investigación personal
          </p>
        </div>
        <HeroChart />
      </div>

      {/* Estado real, ahora mismo: las 3 cards ampliadas, con la cifra y el contexto real de
          cada sala -- la versión "de verdad" de las miniaturas de arriba. */}
      <main id="estado" className="mx-auto max-w-5xl px-4 pb-16 pt-2 sm:px-8">
        <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.08em]" style={{ color: ACCENT }}>
          Estado real, ahora mismo
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Link href="/alpha" className="group relative flex flex-col rounded-xl border border-[#303030] bg-[#1C1C1C] p-4 transition hover:border-[#383838] sm:rounded-2xl sm:p-5">
            <CornerArrow color={ACCENT} />
            <span className="flex items-center gap-2 text-[28px] font-medium" style={{ ...MARK, color: ACCENT }}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="9" rx="1.5" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
              </svg>
              α
            </span>
            {loading ? (
              <div className="mt-2 h-8 w-20 animate-pulse rounded bg-white/5" />
            ) : (
              <span className={`mt-2 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl ${pctTone(real?.unrealized_pct ?? null)}`}>
                {fmtPct(real?.unrealized_pct ?? null)}
              </span>
            )}
            <p className="mt-1.5 text-xs text-[#A3A3A0]">P&amp;L no realizado</p>
            {realHist.length >= 2 && (
              <div className="mt-2 hidden sm:block">
                <HistoryChart points={realHist} mini dark />
              </div>
            )}
            <p className="mt-1 text-[11px] text-[#6E6E6B]">Cuenta IBKR real · acceso privado</p>
          </Link>

          <Link href="/beta" className="group relative flex flex-col rounded-xl border border-[#303030] bg-[#1C1C1C] p-4 transition hover:border-[#383838] sm:rounded-2xl sm:p-5">
            <CornerArrow color="#6E6E6B" />
            <span className="text-[28px] font-medium text-[#6E6E6B]" style={MARK}>β</span>
            {loading ? (
              <div className="mt-2 h-8 w-20 animate-pulse rounded bg-white/5" />
            ) : (
              <span className={`mt-2 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl ${pctTone(shadow?.return_pct ?? null)}`}>
                {fmtPct(shadow?.return_pct ?? null)}
              </span>
            )}
            <p className="mt-1.5 text-xs text-[#A3A3A0]">rentabilidad de la cartera simulada</p>
            <p className="mt-0.5 text-[11px] text-[#6E6E6B]">alpha vs S&amp;P 500: {fmtPct(shadow?.alpha_pct ?? null)}</p>
            {shadowHist.length >= 2 && (
              <div className="mt-2 hidden sm:block">
                <HistoryChart points={shadowHist} mini dark />
              </div>
            )}
            <p className="mt-1 text-[11px] text-[#6E6E6B]">
              {shadow?.since ? `desde ${shadow.since} · ${shadow.positions} posiciones` : "todavía sin cartera"}
            </p>
          </Link>

          <Link href="/omega" className="group relative flex flex-col rounded-xl border border-[#303030] bg-[#1C1C1C] p-4 transition hover:border-[#383838] sm:rounded-2xl sm:p-5">
            <CornerArrow color={ACCENT} />
            <span className="flex items-center gap-2 text-[28px] font-medium" style={{ ...MARK, color: ACCENT }}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 13h3l2-7 3 15 3-11 2 3h5" />
              </svg>
              Ω
            </span>
            <p className="mt-2.5 max-w-[28ch] text-[15px] font-semibold leading-snug text-[#A3A3A0]">
              Caídas técnicas + gate de noticias por LLM
            </p>
            <p className="mt-1 text-xs text-[#6E6E6B]">Nunca ejecuta sola</p>
            <div className="mt-2 hidden sm:block">
              <MiniBars />
            </div>
            <p className="mt-1 text-[11px] text-[#6E6E6B]">Universo propio · acceso privado</p>
          </Link>
        </div>
      </main>

      <footer className="border-t border-[#303030] py-4 text-center text-[11px] text-[#565654]">
        Agentic Trader
      </footer>
    </div>
  );
}
