"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  allocate,
  executeProposalItem,
  getConfig,
  getDemoStatus,
  getLedger,
  getMacro,
  getPerformance,
  getProposal,
  getScores,
  getWatchlist,
  runDemo,
} from "@/lib/api";
import Logo from "@/components/Logo";
import type {
  AppConfig,
  DemoStatus,
  LedgerSnapshot,
  Macro,
  Performance,
  PerfPosition,
  Proposal,
  ProposalItem,
  ScoreRow,
  TradeAction,
  WatchItem,
} from "@/lib/types";
import RealDoor from "@/components/RealDoor";

/* ---------- helpers ---------- */
const money = (x: string | number, dec = 2) =>
  Number(x).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const ACTION: Record<TradeAction, { badge: string; label: string }> = {
  comprar: { badge: "bg-emerald-600 text-white", label: "Comprar" },
  ampliar: { badge: "bg-teal-600 text-white", label: "Ampliar" },
  mantener: { badge: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200", label: "Mantener" },
  recortar: { badge: "bg-amber-500 text-white", label: "Recortar" },
  vender: { badge: "bg-rose-600 text-white", label: "Vender" },
};
const MACRO_STYLE: Record<string, string> = {
  "risk-on": "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  neutral: "bg-slate-50 text-slate-600 ring-slate-500/20",
  "risk-off": "bg-rose-50 text-rose-700 ring-rose-600/20",
  desconocido: "bg-slate-50 text-slate-400 ring-slate-400/20",
};
const POS_COLOR = ["bg-emerald-500", "bg-teal-500", "bg-sky-500", "bg-indigo-500"];
const scoreColor = (s: number) =>
  s >= 80 ? "bg-emerald-500" : s >= 65 ? "bg-teal-500" : s >= 50 ? "bg-amber-400" : "bg-slate-300";
const CARD = "rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.06)]";
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/* ---------- page ---------- */
export default function Dashboard() {
  const [ledger, setLedger] = useState<LedgerSnapshot | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [macro, setMacro] = useState<Macro | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [amount, setAmount] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"cartera" | "ranking">("cartera");
  const [detail, setDetail] = useState<PerfPosition | null>(null);   // modal detalle por acción
  const [execBusy, setExecBusy] = useState<string | null>(null);     // ticker ejecutándose
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      // El ledger es crítico (define la conexión); el resto degrada con gracia si falla.
      const l = await getLedger();
      const [p, s, w, m, pf, cf] = await Promise.all([
        getProposal().catch(() => null),
        getScores().catch(() => []),
        getWatchlist().catch(() => []),
        getMacro().catch(() => null),
        getPerformance().catch(() => null),
        getConfig().catch(() => null),
      ]);
      setLedger(l); setProposal(p); setScores(s); setWatch(w); setMacro(m); setPerf(pf); setCfg(cf);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo contactar con el backend.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const poll = useCallback(async () => {
    try {
      const s = await getDemoStatus();
      setStatus(s);
      if (s.status === "running") { timer.current = setTimeout(poll, 4000); return; }
      setRunning(false);
      if (s.status === "error") setError(s.error ?? "Fallo en el análisis.");
      else if (s.status === "done") setFlash("Análisis completado.");
      await refresh();
    } catch {
      // Se perdió la conexión mientras sondeábamos: reintenta en 6s sin romper el bucle.
      timer.current = setTimeout(poll, 6000);
    }
  }, [refresh]);

  const handleAllocate = async () => {
    setError(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) return;
    try {
      setLedger(await allocate(n));
      setAmount("");
      setFlash(`Capital ${n > 0 ? "asignado" : "retirado"}: ${n > 0 ? "+$" : "−$"}${money(Math.abs(n))}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fallo al asignar fondos.");
    }
  };

  const handleRun = async () => {
    setError(null);
    try { await runDemo(); setRunning(true); setFlash("Análisis en marcha…"); poll(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo lanzar el análisis."); }
  };

  const handleExecute = async (ticker: string) => {
    setError(null);
    setExecBusy(ticker);
    try {
      const res = await executeProposalItem(ticker);
      setLedger(res.ledger);
      setFlash(res.message);
      await refresh();   // refresca seguimiento (P&L, posiciones) tras la operación
    } catch (e) {
      setError(e instanceof Error ? e.message : `No se pudo ejecutar ${ticker}.`);
    } finally {
      setExecBusy(null);
    }
  };

  const equity = ledger ? Number(ledger.equity) : 0;
  const heldSet = new Set((ledger?.positions ?? []).map((p) => p.ticker));
  const items = proposal?.items ?? [];
  const targets = items.filter((i) => i.action !== "vender");
  const trades = items.filter((i) => i.action !== "mantener");

  return (
    <div className="min-h-[100dvh] bg-slate-100/70 text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <Logo size={36} className="shrink-0" />
            <div className="leading-tight">
              <h1 className="text-[15px] font-semibold tracking-tight">Agentic Trader</h1>
              <p className="text-[11px] tracking-wide text-slate-400">Gestión sistemática asistida por IA</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {macro && (
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${MACRO_STYLE[macro.regime] ?? MACRO_STYLE.desconocido}`}>
                {macro.regime}{macro.vix != null && ` · VIX ${macro.vix}`}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-bold tracking-wide text-slate-500 ring-1 ring-inset ring-slate-900/10">
              <span className={`h-1.5 w-1.5 rounded-full ${error ? "bg-rose-500" : loading ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />
              SALA SOMBRA
            </span>
            <RealDoor />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        {error && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {error}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => { setLoading(true); refresh(); }} className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-rose-700">Reintentar</button>
              <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600" aria-label="Cerrar">✕</button>
            </div>
          </div>
        )}
        {flash && !error && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
            <span>{flash}</span>
            <button onClick={() => setFlash(null)} className="text-emerald-400 hover:text-emerald-600" aria-label="Cerrar">✕</button>
          </div>
        )}
        {loading && !ledger && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            Conectando con el backend…
          </div>
        )}

        {/* KPI strip */}
        <section className={`mb-6 grid grid-cols-2 gap-px overflow-hidden ${CARD} bg-slate-200 p-0 md:grid-cols-3 lg:grid-cols-6`}>
          <Kpi label="Patrimonio" value={`$${money(equity)}`} accent />
          <Kpi label="Caja" value={`$${money(ledger?.cash ?? 0)}`} />
          <Kpi label="Invertido" value={`$${money(ledger?.positions_value ?? 0)}`} />
          <Kpi label="P&L abierto" value={`$${money(ledger?.unrealized_pnl ?? 0)}`}
               tone={Number(ledger?.unrealized_pnl ?? 0) >= 0 ? "pos" : "neg"}
               sub={`realizado $${money(ledger?.realized_pnl ?? 0)}`} />
          <Kpi label="vs S&P 500"
               value={perf?.alpha_pct != null ? `${perf.alpha_pct > 0 ? "+" : ""}${perf.alpha_pct}%` : "—"}
               sub={perf?.spy_return_pct != null
                 ? `cart ${perf.portfolio_return_pct > 0 ? "+" : ""}${perf.portfolio_return_pct}% · S&P ${perf.spy_return_pct > 0 ? "+" : ""}${perf.spy_return_pct}%`
                 : "sin cartera"}
               tone={perf?.alpha_pct != null ? (perf.alpha_pct >= 0 ? "pos" : "neg") : undefined} />
          <Kpi label="Régimen" value={macro?.regime ?? "—"} sub={macro?.vix != null ? `VIX ${macro.vix}` : ""} />
        </section>

        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            {/* Capital + Analizar */}
            <section className={CARD}>
              <CardHead>Capital gestionado</CardHead>
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <input
                      type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAllocate()}
                      className="w-full rounded-lg border border-slate-300 py-2 pl-6 pr-3 text-sm tabular-nums focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                      placeholder="0"
                    />
                  </div>
                  <button onClick={handleAllocate} className="whitespace-nowrap rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700">
                    Asignar
                  </button>
                </div>
                <button
                  onClick={handleRun} disabled={running}
                  className="mt-3 flex w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-70"
                >
                  {running ? (
                    <>
                      <span className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </span>
                      Analizando el mercado…
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                      </svg>
                      Analizar mercado
                    </>
                  )}
                </button>
              </div>
            </section>

            {/* Seguimiento vs S&P (arriba: es lo primero que quieres ver) */}
            {perf && perf.positions.length > 0 && (
              <section className={CARD}>
                <CardHead>Seguimiento vs S&amp;P{perf.since ? ` · desde ${perf.since}` : ""}</CardHead>
                <div className="p-4">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {([["Cartera", perf.portfolio_return_pct], ["S&P 500", perf.spy_return_pct], ["Alpha", perf.alpha_pct]] as const).map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-slate-50 py-2 ring-1 ring-inset ring-slate-100">
                        <p className="text-[9px] uppercase tracking-wide text-slate-400">{k}</p>
                        <p className={`text-sm font-bold tabular-nums ${typeof v === "number" ? (v >= 0 ? "text-emerald-600" : "text-rose-500") : "text-slate-400"}`}>
                          {typeof v === "number" ? `${v > 0 ? "+" : ""}${v}%` : "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                  {perf.spy_ref != null && (
                    <p className="mt-2 text-center text-[10px] tabular-nums text-slate-400">
                      Ref. S&amp;P: ${money(perf.spy_ref)} en la entrada
                      {perf.spy_last != null && <> → ${money(perf.spy_last)} ahora</>}
                    </p>
                  )}
                  <div className="mt-3 space-y-0.5">
                    <p className="mb-1 text-[9px] uppercase tracking-wide text-slate-300">Pincha una acción para el detalle</p>
                    {perf.positions.map((p) => {
                      const up = Number(p.unrealized_pnl);
                      return (
                        <button
                          key={p.ticker} onClick={() => setDetail(p)}
                          className="group -mx-1.5 flex w-[calc(100%+0.75rem)] items-center justify-between rounded-md px-1.5 py-1 text-xs transition hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-1.5 font-medium text-slate-600">
                            {p.ticker}
                            <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-300 opacity-0 transition group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </span>
                          <span className="flex items-center gap-2 tabular-nums">
                            <span className={`text-[10px] ${up >= 0 ? "text-emerald-500/70" : "text-rose-400/70"}`}>
                              {up >= 0 ? "+" : "−"}${money(Math.abs(up))}
                            </span>
                            <span className={`font-semibold ${p.pnl_pct >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                              {p.pnl_pct > 0 ? "+" : ""}{p.pnl_pct}%
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* Estado del escaneo */}
            <section className={CARD}>
              <CardHead>Estado</CardHead>
              <div className="px-4 py-2">
                {[
                  ["Nombres puntuados", String(status?.result?.prescored ?? scores.length)],
                  ["Análisis profundo", String(status?.result?.deep ?? scores.length)],
                  ["Operaciones propuestas", String(trades.length)],
                  ["Objetivo en caja", proposal ? `${proposal.cash_target_pct}%` : "—"],
                  ["Coste del escaneo", status?.result?.cost ? `$${status.result.cost.cost_usd.toFixed(3)} · ${status.result.cost.calls} llamadas` : "—"],
                  ["Último análisis", fmtTime(proposal?.created_at ?? null)],
                ].map(([k, v], i) => (
                  <div key={k} className={`flex items-center justify-between py-2 text-xs ${i > 0 ? "border-t border-slate-100" : ""}`}>
                    <span className="text-slate-500">{k}</span>
                    <span className="font-semibold tabular-nums text-slate-800">{v}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Watchlist */}
            {watch.length > 0 && (
              <section className={CARD}>
                <CardHead>En seguimiento · {watch.length}</CardHead>
                <div className="flex flex-wrap gap-1.5 p-4">
                  {watch.map((w) => (
                    <span key={w.ticker} title={w.thesis} className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                      {w.ticker}<span className="tabular-nums text-slate-400">{w.score}</span>
                    </span>
                  ))}
                </div>
              </section>
            )}
          </aside>

          {/* Main */}
          <main>
            {/* Tabs */}
            <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <TabBtn active={tab === "cartera"} onClick={() => setTab("cartera")}>
                Cartera propuesta{items.length ? ` · ${targets.length}` : ""}
              </TabBtn>
              <TabBtn active={tab === "ranking"} onClick={() => setTab("ranking")}>
                Ranking{scores.length ? ` · ${scores.length}` : ""}
              </TabBtn>
            </div>

            {tab === "cartera" ? (
              <section className={`${CARD} p-5`}>
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold tracking-tight">Cartera propuesta</h2>
                  <span className="text-[11px] text-slate-400">
                    máx {cfg?.max_positions ?? 5} · tope {cfg?.max_position_pct ?? 35}% · solo acciones
                  </span>
                </div>
                {items.length === 0 ? (
                  <Empty running={running} />
                ) : (
                  <>
                    <AllocationBar targets={targets} cashPct={proposal?.cash_target_pct ?? 0} />
                    <div className="mt-4 grid gap-3 xl:grid-cols-2">
                      {items.map((it, i) => (
                        <PositionCard
                          key={it.ticker} item={it}
                          color={i < POS_COLOR.length ? POS_COLOR[i] : "bg-slate-300"}
                          onExecute={handleExecute} busy={execBusy === it.ticker}
                          held={heldSet.has(it.ticker)}
                        />
                      ))}
                    </div>
                    {proposal?.macro_summary && (
                      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Contexto macro (3 meses)</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">{proposal.macro_summary}</p>
                      </div>
                    )}
                  </>
                )}
              </section>
            ) : (
              <section className={`${CARD} p-5`}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold tracking-tight">Análisis profundo</h2>
                  <span className="text-[11px] text-slate-400">
                    {scores.length} a fondo{status?.result?.prescored ? ` · ${status.result.prescored} pre-cribados` : ""}
                  </span>
                </div>
                {scores.length === 0 ? (
                  <Empty running={running} />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {scores.map((s) => <ScoreRowItem key={s.id} row={s} />)}
                  </div>
                )}
              </section>
            )}
          </main>
        </div>

        <footer className="mt-10 border-t border-slate-200 pt-4 text-center text-[11px] text-slate-400">
          No constituye recomendación de inversión · sala sombra · operaciones simuladas, sin dinero real · metodología tipo whitepaper DeepSeek
        </footer>
      </div>

      {detail && <PositionDetailModal pos={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/* ---------- components ---------- */
function CardHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${active ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
    >
      {children}
    </button>
  );
}

function Empty({ running }: { running: boolean }) {
  return (
    <div className="mt-3 flex min-h-[28vh] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 text-center">
      <p className="text-3xl">{running ? "🛰️" : "📡"}</p>
      <p className="mt-3 max-w-sm text-sm text-slate-500">
        {running
          ? "El agente puntúa el universo y construye la cartera…"
          : "Asigna capital y pulsa «Analizar mercado». Se puntúa el universo y se propone una cartera de 3 a 5 posiciones."}
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, accent, tone, className = "" }: {
  label: string; value: string; sub?: string; accent?: boolean; tone?: "pos" | "neg"; className?: string;
}) {
  return (
    <div className={`bg-white px-4 py-3.5 ${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums tracking-tight ${
        accent ? "text-slate-900" : tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-rose-600" : "text-slate-800"
      }`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function AllocationBar({ targets, cashPct }: { targets: ProposalItem[]; cashPct: number }) {
  return (
    <div className="mt-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
        {targets.map((t, i) => (
          <div key={t.ticker} className={`${i < POS_COLOR.length ? POS_COLOR[i] : "bg-slate-300"} h-full`}
               style={{ width: `${t.target_weight_pct}%` }} title={`${t.ticker} ${t.target_weight_pct}%`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {targets.map((t, i) => (
          <span key={t.ticker} className="inline-flex items-center gap-1.5 text-slate-600">
            <span className={`h-2 w-2 rounded-full ${i < POS_COLOR.length ? POS_COLOR[i] : "bg-slate-300"}`} />
            {t.ticker} <span className="font-semibold tabular-nums">{t.target_weight_pct}%</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          <span className="h-2 w-2 rounded-full bg-slate-200" />Caja <span className="font-semibold tabular-nums">{cashPct}%</span>
        </span>
      </div>
    </div>
  );
}

function PositionCard({ item, color, onExecute, busy, held }: {
  item: ProposalItem; color: string; onExecute: (t: string) => void; busy: boolean; held: boolean;
}) {
  const style = ACTION[item.action] ?? ACTION.mantener;
  const actionable = item.action !== "mantener";
  // Ya ejecutada: una compra nueva cuyo ticker ya está en la cartera sombra (o una venta ya
  // hecha, ya sin posición). En ese caso el botón se deshabilita y muestra el estado.
  const done = (item.action === "comprar" && held) || (item.action === "vender" && !held);
  const doneLabel = item.action === "vender" ? "Vendida" : "En cartera";
  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={`mt-0.5 h-8 w-1 rounded-full ${color}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-slate-900">{item.ticker}</span>
              {item.score != null && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">score {item.score}</span>
              )}
            </div>
            <p className="mt-0.5 text-xs tabular-nums text-slate-400">
              {item.price ? `$${money(item.price)}` : "—"}
              {item.target_price != null && <> → obj. ${money(item.target_price)}</>}
              {item.upside_pct != null && (
                <span className={`ml-1 font-semibold ${item.upside_pct >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                  {item.upside_pct > 0 ? "+" : ""}{item.upside_pct}%
                </span>
              )}
            </p>
          </div>
        </div>
        {!actionable ? (
          <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${style.badge}`}>{style.label}</span>
        ) : done ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            {doneLabel}
          </span>
        ) : (
          <button
            onClick={() => onExecute(item.ticker)} disabled={busy}
            title={`${style.label} ${item.ticker} en la cartera sombra`}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold shadow-sm transition hover:brightness-110 active:scale-95 disabled:opacity-60 ${style.badge}`}
          >
            {busy ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            )}
            {style.label}
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-slate-100 text-center ring-1 ring-inset ring-slate-100">
        {[
          ["Valor obj.", `$${money(item.target_value, 0)}`],
          ["Δ acciones", `${item.delta_shares > 0 ? "+" : ""}${item.delta_shares}`],
          ["Peso", `${item.target_weight_pct}%`],
        ].map(([k, v]) => (
          <div key={k} className="bg-white py-1.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-400">{k}</p>
            <p className="text-xs font-semibold tabular-nums text-slate-700">{v}</p>
          </div>
        ))}
      </div>

      {item.thesis && <p className="mt-3 text-sm leading-relaxed text-slate-700">{item.thesis}</p>}
      {(item.edge || item.risk) && (
        <div className="mt-2.5 space-y-1 border-t border-slate-100 pt-2.5 text-xs">
          {item.edge && <p className="text-slate-600"><span className="font-semibold text-emerald-700">Ventaja · </span>{item.edge}</p>}
          {item.risk && <p className="text-slate-600"><span className="font-semibold text-rose-600">Riesgo · </span>{item.risk}</p>}
        </div>
      )}
    </article>
  );
}

function PositionDetailModal({ pos, onClose }: { pos: PerfPosition; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shares = Number(pos.quantity);
  const uPnl = Number(pos.unrealized_pnl);
  const rPnl = Number(pos.realized_pnl);
  const up = pos.pnl_pct >= 0;
  const fmtShares = shares.toLocaleString("en-US", { maximumFractionDigits: 4 });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-slate-900">{pos.ticker}</h3>
            <p className="text-xs text-slate-400">{fmtShares} acciones · seguimiento sombra</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600" aria-label="Cerrar">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* P&L abierto destacado */}
        <div className={`px-5 py-4 ${up ? "bg-emerald-50" : "bg-rose-50"}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">P&L abierto</p>
          <p className={`mt-0.5 text-2xl font-bold tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>
            {uPnl >= 0 ? "+" : "−"}${money(Math.abs(uPnl))}
            <span className="ml-2 text-base font-semibold">{up ? "+" : ""}{pos.pnl_pct}%</span>
          </p>
        </div>

        {/* Rejilla de métricas */}
        <div className="grid grid-cols-2 gap-px bg-slate-100">
          <ModalStat label="Acciones" value={fmtShares} />
          <ModalStat label="Valor de mercado" value={`$${money(pos.value)}`} />
          <ModalStat label="Coste medio" value={`$${money(pos.avg_cost)}`} />
          <ModalStat label="Precio actual" value={`$${money(pos.price)}`} />
          <ModalStat label="Coste base" value={`$${money(pos.cost_basis)}`} />
          <ModalStat
            label="P&L realizado"
            value={`${rPnl >= 0 ? "+" : "−"}$${money(Math.abs(rPnl))}`}
            tone={rPnl === 0 ? undefined : rPnl > 0 ? "pos" : "neg"}
          />
        </div>
        <p className="px-5 py-3 text-center text-[10px] text-slate-400">
          Coste medio ${money(pos.avg_cost)} → actual ${money(pos.price)} · pincha fuera o Esc para cerrar
        </p>
      </div>
    </div>
  );
}

function ModalStat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="bg-white px-5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${
        tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-rose-600" : "text-slate-800"
      }`}>{value}</p>
    </div>
  );
}

function ScoreRowItem({ row }: { row: ScoreRow }) {
  return (
    <details className="group py-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span className="w-16 shrink-0 font-semibold tracking-tight text-slate-900">{row.ticker}</span>
        <span className="hidden w-36 shrink-0 truncate text-[11px] text-slate-400 sm:block">{row.sector}</span>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <span className={`absolute inset-y-0 left-0 rounded-full ${scoreColor(row.score)}`} style={{ width: `${row.score}%` }} />
        </span>
        <span className="w-8 shrink-0 text-right text-sm font-bold tabular-nums text-slate-700">{row.score}</span>
        {row.held ? (
          <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">EN CARTERA</span>
        ) : row.on_watchlist ? (
          <span className="shrink-0 rounded bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400 ring-1 ring-inset ring-slate-300">SEGUIM.</span>
        ) : (
          <span className="hidden w-[62px] shrink-0 sm:block" />
        )}
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-300 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      {(row.price != null || row.target_price != null) && (
        <p className="mt-2 pl-16 text-xs tabular-nums text-slate-500">
          {row.price != null ? `$${money(row.price)}` : "—"}
          {row.target_price != null && <> → objetivo ${money(row.target_price)}</>}
          {row.price != null && row.target_price != null && (
            <span className={`ml-1 font-semibold ${row.target_price >= row.price ? "text-emerald-600" : "text-rose-500"}`}>
              ({row.target_price >= row.price ? "+" : ""}{(((row.target_price / row.price) - 1) * 100).toFixed(1)}%)
            </span>
          )}
        </p>
      )}
      {row.headline && <p className="mt-2 pl-16 text-sm text-slate-600">{row.headline}</p>}
      {row.report && <p className="mt-2 whitespace-pre-line pl-16 text-xs leading-relaxed text-slate-500">{row.report}</p>}
    </details>
  );
}
