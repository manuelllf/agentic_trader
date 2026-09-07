"use client";

// Portada pública: sobria y factual, sin reclamos comerciales. Vista previa de ambas salas
// (teaser vía GET /overview, sin token) — la sombra es de libre acceso, la real pide login al
// entrar (AuthGate vive dentro de /real, no aquí).

import Link from "next/link";
import { useEffect, useState } from "react";
import { getHistory, getOverview } from "@/lib/api";
import HistoryChart from "@/components/HistoryChart";
import Logo from "@/components/Logo";
import { fmtPct } from "@/lib/format";
import type { HistoryPoint, Overview } from "@/lib/types";

const pctTone = (v: number | null, dark = false) =>
  v == null || v === 0 ? "text-slate-400" : v > 0 ? (dark ? "text-emerald-400" : "text-emerald-600")
                                                    : (dark ? "text-rose-400" : "text-rose-600");

export default function Landing() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  // Mini-curvas (públicas): la real llega sin equity — solo fechas y %, como el teaser.
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
    <div className="flex min-h-[100dvh] flex-col bg-slate-100/70 text-slate-900">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 py-4 sm:py-16">
        <Logo size={32} />
        <h1 className="mt-2 text-xl font-bold tracking-tight sm:mt-3 sm:text-3xl">Agentic Trader</h1>
        <p className="mt-1 max-w-lg text-center text-[12.5px] text-slate-500 sm:mt-2 sm:text-sm">
          Dos estrategias de inversión sistemática, medidas en público.
        </p>

        <div className="mt-4 grid w-full grid-cols-1 gap-2.5 sm:mt-10 sm:grid-cols-3 sm:gap-4">
          {/* ---- Sala Sombra: pública, cartera simulada (ranker) ---- */}
          <Link
            href="/sombra"
            className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.06)] transition hover:border-slate-300 sm:p-5"
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sala Sombra</span>
            <p className="mt-1 text-[11px] leading-snug text-slate-400 sm:mt-1.5">
              Ranker fundamental por LLM sobre ~3.000 acciones US, cartera simulada.
            </p>
            {loading ? (
              <div className="mt-2 h-8 w-24 animate-pulse rounded bg-slate-100 sm:mt-2 sm:h-9 sm:w-28" />
            ) : (
              <span className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight sm:mt-2 sm:text-3xl ${pctTone(shadow?.return_pct ?? null)}`}>
                {fmtPct(shadow?.return_pct ?? null)}
              </span>
            )}
            {/* El número grande es LA CARTERA y su etiqueta lo dice; la comparación con el
                índice baja un escalón — es contexto, no el titular. */}
            <p className="mt-1 text-xs text-slate-500 sm:mt-2">rentabilidad de la cartera simulada</p>
            <p className="mt-0.5 hidden text-[11px] text-slate-400 sm:block">
              alpha vs S&amp;P 500: {fmtPct(shadow?.alpha_pct ?? null)}
            </p>
            {shadowHist.length >= 2 && (
              <div className="mt-2 hidden sm:block">
                <HistoryChart points={shadowHist} mini />
              </div>
            )}
            <p className="mt-1 hidden text-[11px] text-slate-400 sm:block">
              {shadow?.since ? `desde ${shadow.since} · ${shadow.positions} posiciones` : "todavía sin cartera"}
            </p>
            <span className="mt-2.5 inline-flex w-fit items-center gap-1.5 self-start rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition group-hover:bg-slate-700 sm:mt-4 sm:py-2">
              Entrar
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </Link>

          {/* ---- Sala Real: privada, cuenta IBKR real (ranker) ---- */}
          <Link
            href="/real"
            className="group flex flex-col rounded-2xl border p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.25),0_4px_16px_rgba(0,0,0,0.35)] transition hover:border-white/20 sm:p-5"
            style={{ background: "#0d0d0d", borderColor: "rgba(255,255,255,0.10)", color: "#c3c2b7" }}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="9" rx="1.5" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
              </svg>
              Sala Real
            </span>
            <p className="mt-1 text-[11px] leading-snug sm:mt-1.5" style={{ color: "#898781" }}>
              Mismo método, cuenta de verdad: el agente propone, tú decides.
            </p>
            {loading ? (
              <div className="mt-2 h-8 w-24 animate-pulse rounded bg-white/10 sm:mt-2 sm:h-9 sm:w-28" />
            ) : (
              <span className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight sm:mt-2 sm:text-3xl ${pctTone(real?.unrealized_pct ?? null, true)}`}>
                {fmtPct(real?.unrealized_pct ?? null)}
              </span>
            )}
            <p className="mt-1 text-xs sm:mt-2" style={{ color: "#898781" }}>P&amp;L no realizado</p>
            {realHist.length >= 2 && (
              <div className="mt-2 hidden sm:block">
                <HistoryChart points={realHist} mini dark />
              </div>
            )}
            <p className="mt-0.5 hidden text-[11px] sm:mt-1 sm:block" style={{ color: "#898781" }}>
              Cuenta IBKR real · acceso privado
            </p>
            <span
              className="mt-2.5 inline-flex w-fit items-center gap-1.5 self-start rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition group-hover:opacity-90 sm:mt-4 sm:py-2"
              style={{ background: "#3987e5" }}
            >
              Entrar
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </Link>

          {/* ---- Sala Real X: privada, estrategia de momentum, independiente del ranker ----
              Sin cifra pública: no hay teaser propio todavía, y no se inventa un número. */}
          <Link
            href="/momentum"
            className="group flex flex-col rounded-2xl border p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.25),0_4px_16px_rgba(0,0,0,0.35)] transition hover:border-white/20 sm:p-5"
            style={{ background: "#0d0d0d", borderColor: "rgba(255,255,255,0.10)", color: "#c3c2b7" }}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "#6f5cf5" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#6f5cf5" }} />
              Sala Real X
            </span>
            <span className="mt-1.5 text-lg font-bold leading-snug sm:mt-2 sm:text-xl" style={{ color: "#fff" }}>
              Descubrimiento de momentum
            </span>
            <p className="mt-1 text-xs leading-relaxed sm:mt-2" style={{ color: "#898781" }}>
              Caídas técnicas + gate de noticias por LLM. Nunca ejecuta sola.
            </p>
            <p className="mt-0.5 hidden text-[11px] sm:mt-2 sm:block" style={{ color: "#898781" }}>
              Universo propio · acceso privado
            </p>
            <span
              className="mt-2.5 inline-flex w-fit items-center gap-1.5 self-start rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition group-hover:opacity-90 sm:mt-4 sm:py-2"
              style={{ background: "#6f5cf5" }}
            >
              Entrar
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </Link>
        </div>
      </main>

      <footer className="hidden border-t border-slate-200 py-4 text-center text-[11px] text-slate-400 sm:block">
        Agentic Trader
      </footer>
    </div>
  );
}
