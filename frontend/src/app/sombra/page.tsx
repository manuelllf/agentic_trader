"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getConfig,
  getDemoStatus,
  getHistory,
  getLedger,
  getMacro,
  getPerformance,
  getProposal,
  getScores,
  getWatchlist,
  hasToken,
} from "@/lib/api";
import HistoryChart from "@/components/HistoryChart";
import Logo from "@/components/Logo";
import type {
  AppConfig,
  DemoStatus,
  HistoryPoint,
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
export default function SombraDashboard() {
  const [ledger, setLedger] = useState<LedgerSnapshot | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [hist, setHist] = useState<HistoryPoint[]>([]);
  const [macro, setMacro] = useState<Macro | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"cartera" | "ranking">("cartera");
  const [detail, setDetail] = useState<PerfPosition | null>(null);   // modal detalle por acción
  const [authed, setAuthed] = useState(false);   // sesión detectada en el último refresco
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      // El ledger es crítico (define la conexión); el resto degrada con gracia si falla.
      const l = await getLedger();
      const [m, pf, cf, st, hs] = await Promise.all([
        getMacro().catch(() => null),
        getPerformance().catch(() => null),
        getConfig().catch(() => null),
        getDemoStatus().catch(() => null),
        getHistory("shadow").catch(() => null),
      ]);
      // Sin sesión, ni se piden: scores/propuesta/watchlist son del método — evita 401 al aire.
      const withSession = hasToken();
      let p: Proposal | null = null;
      let s: ScoreRow[] = [];
      let w: WatchItem[] = [];
      if (withSession) {
        [p, s, w] = await Promise.all([
          getProposal().catch(() => null),
          getScores().catch(() => []),
          getWatchlist().catch(() => []),
        ]);
      }
      setLedger(l); setProposal(p); setScores(s); setWatch(w); setMacro(m); setPerf(pf); setCfg(cf); setStatus(st);
      if (hs) setHist(hs.series);
      setAuthed(withSession);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo contactar con el backend.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Solo lectura: el escaneo se lanza desde la Sala Real (o el cron semanal), así que aquí nos
    // limitamos a refrescar cada poco para reflejarlo en cuanto termine, sin ningún botón.
    timer.current = setInterval(refresh, 45_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const equity = ledger ? Number(ledger.equity) : 0;
  const heldSet = new Set((ledger?.positions ?? []).map((p) => p.ticker));
  const items = proposal?.items ?? [];
  const targets = items.filter((i) => i.action !== "vender");
  const trades = items.filter((i) => i.action !== "mantener");
  const running = status?.status === "running";
  // Vista anónima: sin sesión, o si el backend ya vino anonimizado (token caducado en esta
  // pestaña) — la propia forma del dato manda, no solo el token guardado.
  const anon = !authed || (!!perf && perf.positions.length > 0 && !perf.positions[0].ticker);

  return (
    <div className="min-h-[100dvh] bg-slate-100/70 text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={36} className="shrink-0" />
            <div className="leading-tight">
              <h1 className="text-[15px] font-semibold tracking-tight">Agentic Trader</h1>
              <p className="text-[11px] tracking-wide text-slate-400">Ranker fundamental sistemático</p>
            </div>
          </Link>
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

        {/* Curva histórica: cierre diario de la cartera vs S&P 500 (índice base 100) */}
        {hist.length >= 2 && (
          <section className={`mb-6 ${CARD}`}>
            <CardHead>
              Cartera vs S&amp;P 500
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                cierre diario · base 100 en la primera compra
              </span>
            </CardHead>
            <div className="p-4">
              <HistoryChart points={hist} />
            </div>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
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
                    <p className="mb-1 text-[9px] uppercase tracking-wide text-slate-300">
                      {anon ? "Detalle por posición — acceso privado" : "Pincha una acción para el detalle"}
                    </p>
                    {perf.positions.map((p, i) => {
                      const up = Number(p.unrealized_pnl);
                      const pct = p.pnl_pct ?? p.unrealized_pct ?? 0;
                      const label = anon ? (p.label ?? `Posición ${i + 1}`) : p.ticker;
                      const row = (
                        <>
                          <span className="flex items-center gap-1.5 font-medium text-slate-600">
                            {label}
                            {!anon && (
                              <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-300 opacity-0 transition group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            )}
                          </span>
                          <span className="flex items-center gap-2 tabular-nums">
                            <span className={`text-[10px] ${up >= 0 ? "text-emerald-500/70" : "text-rose-400/70"}`}>
                              {up >= 0 ? "+" : "−"}${money(Math.abs(up))}
                            </span>
                            <span className={`font-semibold ${pct >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                              {pct > 0 ? "+" : ""}{pct}%
                            </span>
                          </span>
                        </>
                      );
                      return anon ? (
                        <div key={`pos-${i}`} className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-xs">
                          {row}
                        </div>
                      ) : (
                        <button
                          key={p.ticker} onClick={() => setDetail(p)}
                          className="group -mx-1.5 flex w-[calc(100%+0.75rem)] items-center justify-between rounded-md px-1.5 py-1 text-xs transition hover:bg-slate-50"
                        >
                          {row}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* Estado del escaneo (solo lectura: se lanza desde la Sala Real o el cron semanal) */}
            <section className={CARD}>
              <CardHead>Estado{running ? " · analizando…" : ""}</CardHead>
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
            {anon ? (
              /* Sin sesión: ni se pide /scores /proposal /watchlist — solo un aviso sobrio. */
              <section className={`${CARD} flex min-h-[40vh] flex-col items-center justify-center gap-3 border-dashed p-10 text-center`}>
                <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="max-w-xs text-sm text-slate-400">
                  Cartera propuesta, ranking y watchlist — acceso privado
                </p>
              </section>
            ) : (
              <>
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
              </>
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
          : "El agente escanea el mercado cada semana (o cuando se lanza desde la Sala Real). En cuanto termine, aquí aparece la cartera propuesta — y ya ejecutada en el libro sombra."}
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

function PositionCard({ item, color, held }: {
  item: ProposalItem; color: string; held: boolean;
}) {
  const style = ACTION[item.action] ?? ACTION.mantener;
  const actionable = item.action !== "mantener";
  // Compra/ampliación: ejecutada si el ticker ya está en cartera. Venta/recorte: ejecutada si
  // ya NO está (o ya no lo suficiente). Sin botones: el libro sombra se ejecuta solo al escanear.
  const isBuySide = item.action === "comprar" || item.action === "ampliar";
  const done = isBuySide ? held : !held;
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
        ) : (
          <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
            done ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-500 ring-slate-200"
          }`}>
            {done && (
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            )}
            {done ? "Ejecutada" : "Pendiente"}
          </span>
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

  // Este modal solo se abre con sesión (chips no clicables sin ella), así que el dato viene
  // siempre completo — los `?? 0` son solo para que el tipo (compartido con la vista anónima) cierre.
  const shares = Number(pos.quantity ?? 0);
  const uPnl = Number(pos.unrealized_pnl);
  const rPnl = Number(pos.realized_pnl ?? 0);
  const pct = pos.pnl_pct ?? pos.unrealized_pct ?? 0;
  const up = pct >= 0;
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
            <h3 className="text-lg font-bold tracking-tight text-slate-900">{pos.ticker ?? "—"}</h3>
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
            <span className="ml-2 text-base font-semibold">{up ? "+" : ""}{pct}%</span>
          </p>
        </div>

        {/* Rejilla de métricas */}
        <div className="grid grid-cols-2 gap-px bg-slate-100">
          <ModalStat label="Acciones" value={fmtShares} />
          <ModalStat label="Valor de mercado" value={`$${money(pos.value ?? 0)}`} />
          <ModalStat label="Coste medio" value={`$${money(pos.avg_cost ?? 0)}`} />
          <ModalStat label="Precio actual" value={`$${money(pos.price ?? 0)}`} />
          <ModalStat label="Coste base" value={`$${money(pos.cost_basis ?? 0)}`} />
          <ModalStat
            label="P&L realizado"
            value={`${rPnl >= 0 ? "+" : "−"}$${money(Math.abs(rPnl))}`}
            tone={rPnl === 0 ? undefined : rPnl > 0 ? "pos" : "neg"}
          />
        </div>
        <p className="px-5 py-3 text-center text-[10px] text-slate-400">
          Coste medio ${money(pos.avg_cost ?? 0)} → actual ${money(pos.price ?? 0)} · pincha fuera o Esc para cerrar
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
