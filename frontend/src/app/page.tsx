"use client";

// Portada pública: sobria y factual, sin reclamos comerciales. Vista previa de las 3 salas
// (teaser vía GET /overview, sin token) — Beta es de libre acceso, Alpha pide login al entrar
// (AuthGate vive dentro de /real, no aquí).

import Link from "next/link";
import { useEffect, useState } from "react";
import { getHistory, getOverview } from "@/lib/api";
import HistoryChart from "@/components/HistoryChart";
import Logo from "@/components/Logo";
import { fmtPct } from "@/lib/format";
import type { HistoryPoint, Overview } from "@/lib/types";

// Mismos valores que T.good/T.bad en real/tokens.ts y momentum/tokens.ts.
const pctTone = (v: number | null) =>
  v == null || v === 0 ? "text-[#6E6E6B]" : v > 0 ? "text-[#6BBE8A]" : "text-[#E0776C]";

// Acento único de marca -- mismo valor que real/tokens.ts (T.buy) y momentum/tokens.ts (T.entry).
const ACCENT = "#4FA39D";

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
    <div className="min-h-[100dvh] bg-[#131313] text-[#A3A3A0]">
      <header className="mx-auto flex max-w-5xl items-center px-4 py-6 sm:px-8">
        <Logo size={30} />
        <span className="ml-3 font-mono text-[13px] font-semibold tracking-tight text-white">
          ALPHA<span style={{ color: ACCENT }}>·</span>BETA<span style={{ color: ACCENT }}>·</span>X
        </span>
      </header>

      {/* Acceso inmediato a las 3 salas — lo primero que se puede hacer, sin bajar a leer nada.
          Rectángulos pequeños, los 3 a la vez incluso en móvil. */}
      <div className="mx-auto max-w-5xl px-4 sm:px-8">
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <Link href="/beta" className="group relative flex flex-col justify-between rounded-xl border border-[#303030] bg-[#1C1C1C] p-2.5 transition hover:border-[#383838] sm:rounded-2xl sm:p-4">
            <CornerArrow color="#6E6E6B" />
            <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#6E6E6B] sm:text-[11px]">Beta</span>
            <span className={`mt-1 text-sm font-bold tabular-nums ${pctTone(shadow?.return_pct ?? null)}`}>{loading ? "—" : fmtPct(shadow?.return_pct ?? null)}</span>
          </Link>
          <Link href="/alpha" className="group relative flex flex-col justify-between rounded-xl border border-[#303030] bg-[#1C1C1C] p-2.5 transition hover:border-[#383838] sm:rounded-2xl sm:p-4">
            <CornerArrow color={ACCENT} />
            <span className="text-[9.5px] font-bold uppercase tracking-wider sm:text-[11px]" style={{ color: ACCENT }}>Alpha</span>
            <span className="mt-1 text-sm font-bold tabular-nums text-[#6E6E6B]">Cartera real</span>
          </Link>
          <Link href="/x" className="group relative flex flex-col justify-between rounded-xl border border-[#303030] bg-[#1C1C1C] p-2.5 transition hover:border-[#383838] sm:rounded-2xl sm:p-4">
            <CornerArrow color={ACCENT} />
            <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider sm:text-[11px]" style={{ color: ACCENT }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />X
            </span>
            <span className="mt-1 text-sm font-bold tabular-nums text-[#6E6E6B]">Momentum</span>
          </Link>
        </div>
      </div>

      {/* Hero editorial: el único momento con alma tipográfica antes de la precisión de las
          salas -- Fraunces solo aquí, el resto de la app se queda en la fuente de sistema. */}
      <div className="mx-auto max-w-5xl px-4 pb-8 pt-10 sm:px-8 sm:pb-14 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:pb-20">
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
            <strong className="font-semibold text-[#A3A3A0]">Alpha</strong> analiza fundamentales con IA y ejecuta
            capital real, con <strong className="font-semibold text-[#A3A3A0]">Beta</strong> como réplica pública
            en papel del mismo método. <strong className="font-semibold text-[#A3A3A0]">X</strong> caza rotación de
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
        <div className="mt-8 hidden rounded-2xl border border-[#303030] bg-[#1C1C1C] p-6 lg:block">
          <svg viewBox="0 0 400 190" className="w-full" role="img"
               aria-label="Línea de precio esquemática con un punto de entrada de señal marcado">
            <line x1="0" y1="140" x2="400" y2="140" stroke="#303030" strokeWidth="1" />
            <polyline points="0,110 40,120 70,95 100,130 130,158 160,145 190,125 220,108 250,85 280,98 310,68 340,50 370,32 400,22"
                      fill="none" stroke="#565654" strokeWidth="1.5" />
            <circle cx="130" cy="158" r="4" fill={ACCENT} />
            <text x="140" y="162" fontSize="10" fill={ACCENT}>entrada · suelo reactivo</text>
          </svg>
        </div>
      </div>

      {/* Estado real, ahora mismo: las 3 cards ampliadas, con la cifra y el contexto real de
          cada sala -- la versión "de verdad" de las miniaturas de arriba. */}
      <main id="estado" className="mx-auto max-w-5xl px-4 pb-16 pt-2 sm:px-8">
        <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.08em]" style={{ color: ACCENT }}>
          Estado real, ahora mismo
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Link href="/beta" className="group relative flex flex-col rounded-xl border border-[#303030] bg-[#1C1C1C] p-4 transition hover:border-[#383838] sm:rounded-2xl sm:p-5">
            <CornerArrow color="#6E6E6B" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6E6E6B]">Beta</span>
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

          <Link href="/alpha" className="group relative flex flex-col rounded-xl border border-[#303030] bg-[#1C1C1C] p-4 transition hover:border-[#383838] sm:rounded-2xl sm:p-5">
            <CornerArrow color={ACCENT} />
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: ACCENT }}>
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="9" rx="1.5" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
              </svg>
              Alpha
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

          <Link href="/x" className="group relative flex flex-col rounded-xl border border-[#303030] bg-[#1C1C1C] p-4 transition hover:border-[#383838] sm:rounded-2xl sm:p-5">
            <CornerArrow color={ACCENT} />
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: ACCENT }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />X
            </span>
            <span className="mt-2 text-2xl font-bold tracking-tight text-[#6E6E6B] sm:text-3xl">Momentum</span>
            <p className="mt-1.5 text-xs leading-relaxed text-[#6E6E6B]">
              Caídas técnicas + gate de noticias por LLM. Nunca ejecuta sola.
            </p>
            <p className="mt-2 text-[11px] text-[#6E6E6B]">Universo propio · acceso privado</p>
          </Link>
        </div>
      </main>

      <footer className="border-t border-[#303030] py-4 text-center text-[11px] text-[#565654]">
        Agentic Trader
      </footer>
    </div>
  );
}
