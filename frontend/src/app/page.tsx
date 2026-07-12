"use client";

// Portada pública: sobria y factual, sin reclamos comerciales. Vista previa de ambas salas
// (teaser vía GET /overview, sin token) — la sombra es de libre acceso, la real pide login al
// entrar (AuthGate vive dentro de /real, no aquí).

import Link from "next/link";
import { useEffect, useState } from "react";
import { getHistory, getOverview } from "@/lib/api";
import HistoryChart from "@/components/HistoryChart";
import Logo from "@/components/Logo";
import type { HistoryPoint, Overview } from "@/lib/types";

const fmtPct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
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
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-16">
        <Logo size={56} />
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Agentic Trader</h1>
        <p className="mt-2 max-w-md text-center text-sm text-slate-500">
          Ranker fundamental con LLM: cartera concentrada de acciones US medida contra el S&amp;P 500.
        </p>

        <div className="mt-10 grid w-full gap-4 sm:grid-cols-2">
          {/* ---- Sala Sombra: pública, cartera simulada ---- */}
          <Link
            href="/sombra"
            className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.06)] transition hover:border-slate-300"
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sala Sombra</span>
            {loading ? (
              <div className="mt-3 h-10 w-32 animate-pulse rounded bg-slate-100" />
            ) : (
              <span className={`mt-2 text-4xl font-bold tabular-nums tracking-tight ${pctTone(shadow?.return_pct ?? null)}`}>
                {fmtPct(shadow?.return_pct ?? null)}
              </span>
            )}
            <p className="mt-2 text-xs text-slate-500">
              vs S&amp;P 500: alpha {fmtPct(shadow?.alpha_pct ?? null)}
            </p>
            {shadowHist.length >= 2 && (
              <div className="mt-2">
                <HistoryChart points={shadowHist} mini />
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-400">
              {shadow?.since ? `desde ${shadow.since} · ${shadow.positions} posiciones` : "todavía sin cartera"}
            </p>
            <span className="mt-5 inline-flex w-fit items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition group-hover:bg-slate-700">
              Ver simulación
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </Link>

          {/* ---- Sala Real: privada, cuenta IBKR real ---- */}
          <Link
            href="/real"
            className="group flex flex-col rounded-2xl border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.25),0_4px_16px_rgba(0,0,0,0.35)] transition hover:border-white/20"
            style={{ background: "#0d0d0d", borderColor: "rgba(255,255,255,0.10)", color: "#c3c2b7" }}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="9" rx="1.5" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
              </svg>
              Sala Real
            </span>
            {loading ? (
              <div className="mt-3 h-10 w-32 animate-pulse rounded bg-white/10" />
            ) : (
              <span className={`mt-2 text-4xl font-bold tabular-nums tracking-tight ${pctTone(real?.unrealized_pct ?? null, true)}`}>
                {fmtPct(real?.unrealized_pct ?? null)}
              </span>
            )}
            <p className="mt-2 text-xs" style={{ color: "#898781" }}>P&amp;L no realizado</p>
            {realHist.length >= 2 && (
              <div className="mt-2">
                <HistoryChart points={realHist} mini dark />
              </div>
            )}
            <p className="mt-1 text-[11px]" style={{ color: "#898781" }}>Acceso privado</p>
            <span
              className="mt-5 inline-flex w-fit items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition group-hover:opacity-90"
              style={{ background: "#3987e5" }}
            >
              Entrar
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </Link>
        </div>
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-[11px] text-slate-400">
        Agentic Trader
      </footer>
    </div>
  );
}
