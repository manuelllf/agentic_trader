"use client";

/**
 * SALA SOMBRA — el escaparate del método (tema claro, alma propia; el dark es de la Real).
 *
 * La página responde CUATRO preguntas, en este orden (rediseño 2026-07-21):
 *  1. ¿Bate al mercado?  → veredicto grande + curva (una sola vez, aquí).
 *  2. ¿Qué tiene y cómo va?  → LA CARTERA como tabla densa; la tesis expande por fila.
 *  3. ¿Qué decidió y cuándo vuelve a decidir?  → decisión mensual compacta + próxima fecha.
 *  4. ¿Qué está aprendiendo?  → observatorio semanal + ranking a fondo (sección, no tab).
 * La tira de KPIs se conserva arriba como línea operativa. Sin cards de propuesta, sin modal,
 * sin tabs: tablas y secciones. Vista pública = veredicto + curva + KPIs + cartera anónima.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
  DemoStatus,
  HistoryPoint,
  LedgerSnapshot,
  Macro,
  Performance,
  Proposal,
  ScoreRow,
  TradeAction,
  WatchItem,
} from "@/lib/types";
import RealDoor from "@/components/RealDoor";
import { fmtTime, money } from "@/lib/format";

/* ---------- helpers ---------- */
const ACTION_LABEL: Record<TradeAction, string> = {
  comprar: "Comprar", ampliar: "Ampliar", mantener: "Mantener",
  recortar: "Recortar", vender: "Vender",
};
const MACRO_STYLE: Record<string, string> = {
  "risk-on": "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  neutral: "bg-slate-50 text-slate-600 ring-slate-500/20",
  "risk-off": "bg-rose-50 text-rose-700 ring-rose-600/20",
  desconocido: "bg-slate-50 text-slate-400 ring-slate-400/20",
};
const POS_COLOR = ["bg-emerald-500", "bg-teal-500", "bg-sky-500", "bg-indigo-500", "bg-violet-500"];
const scoreColor = (s: number) =>
  s >= 80 ? "bg-emerald-500" : s >= 65 ? "bg-teal-500" : s >= 50 ? "bg-amber-400" : "bg-slate-300";
const CARD = "rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.06)]";
const sign = (v: number) => (v > 0 ? "+" : "");
const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "—";

/** Próximo primer martes de mes (la fecha de la próxima DECISIÓN de cartera). */
function nextDecisionLabel(): string {
  const firstTue = (y: number, m: number) => {
    const d = new Date(y, m, 1);
    while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
    return d;
  };
  const now = new Date();
  let d = firstTue(now.getFullYear(), now.getMonth());
  if (d.getTime() <= now.getTime()) d = firstTue(now.getFullYear(), now.getMonth() + 1);
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}

/* ---------- page ---------- */
export default function SombraDashboard() {
  const [ledger, setLedger] = useState<LedgerSnapshot | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [hist, setHist] = useState<HistoryPoint[]>([]);
  const [macro, setMacro] = useState<Macro | null>(null);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openPos, setOpenPos] = useState<string | null>(null);   // fila de cartera expandida
  const [q, setQ] = useState("");                                // buscador del ranking
  const [sectorF, setSectorF] = useState<string | null>(null);   // filtro de sector del ranking
  const [authed, setAuthed] = useState(false);   // sesión detectada en el último refresco
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);                    // guard de desmontaje (mismo patrón que portada)

  const refresh = useCallback(async () => {
    try {
      // El ledger es crítico (define la conexión); el resto degrada con gracia si falla.
      const l = await getLedger();
      const [m, pf, st, hs] = await Promise.all([
        getMacro().catch(() => null),
        getPerformance().catch(() => null),
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
      if (!alive.current) return;   // la página ya no está montada: un GET lento no pinta nada
      setLedger(l); setProposal(p); setScores(s); setWatch(w); setMacro(m); setPerf(pf); setStatus(st);
      if (hs) setHist(hs.series);
      setAuthed(withSession);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "No se pudo contactar con el backend.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    // Solo lectura: el escaneo se lanza desde la Sala Real (o el cron semanal), así que aquí nos
    // limitamos a refrescar cada poco para reflejarlo en cuanto termine, sin ningún botón.
    timer.current = setInterval(refresh, 45_000);
    return () => {
      alive.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  const equity = ledger ? Number(ledger.equity) : 0;
  const heldSet = new Set((ledger?.positions ?? []).map((p) => p.ticker));
  const items = proposal?.items ?? [];
  const trades = items.filter((i) => i.action !== "mantener");
  const running = status?.status === "running";
  // Vista anónima: sin sesión, o si el backend ya vino anonimizado (token caducado en esta
  // pestaña) — la propia forma del dato manda, no solo el token guardado.
  const anon = !authed || (!!perf && perf.positions.length > 0 && !perf.positions[0].ticker);
  // Ranking navegable: filtro por sector + búsqueda por ticker/tesis (50 profundos son muchos).
  const sectors = Array.from(new Set(scores.map((s) => s.sector).filter(Boolean))).sort();
  const qn = q.trim().toUpperCase();
  const scoresView = scores.filter((s) =>
    (!sectorF || s.sector === sectorF) &&
    (!qn || s.ticker.toUpperCase().includes(qn) || (s.headline ?? "").toUpperCase().includes(qn)));
  const investedPct = equity > 0 && ledger ? (Number(ledger.positions_value) / equity) * 100 : 0;
  const watchTop = [...watch].sort((a, b) => b.score - a.score);

  return (
    <div className="min-h-[100dvh] bg-slate-100/70 text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
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

      <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8">
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

        {/* KPI strip (línea operativa; el veredicto de abajo es quien cuenta la historia) */}
        <section className={`mb-6 grid grid-cols-2 gap-px overflow-hidden ${CARD} bg-slate-200 p-0 md:grid-cols-3 lg:grid-cols-6`}>
          <Kpi label="Patrimonio" value={`$${money(equity)}`} accent />
          <Kpi label="Caja" value={`$${money(ledger?.cash ?? 0)}`} />
          <Kpi label="Invertido" value={`$${money(ledger?.positions_value ?? 0)}`} />
          <Kpi label="P&L abierto" value={`$${money(ledger?.unrealized_pnl ?? 0)}`}
               tone={Number(ledger?.unrealized_pnl ?? 0) >= 0 ? "pos" : "neg"}
               sub={`realizado $${money(ledger?.realized_pnl ?? 0)}`} />
          <Kpi label="vs S&P 500"
               value={perf?.alpha_pct != null ? `${sign(perf.alpha_pct)}${perf.alpha_pct}%` : "—"}
               sub={perf?.spy_return_pct != null
                 ? `cart ${sign(perf.portfolio_return_pct)}${perf.portfolio_return_pct}% · S&P ${sign(perf.spy_return_pct)}${perf.spy_return_pct}%`
                 : "sin cartera"}
               tone={perf?.alpha_pct != null ? (perf.alpha_pct >= 0 ? "pos" : "neg") : undefined} />
          <Kpi label="Régimen" value={macro?.regime ?? "—"} sub={macro?.vix != null ? `VIX ${macro.vix}` : ""} />
        </section>

        {/* 1 · ¿Bate al mercado? — veredicto + curva, una sola vez */}
        {(perf?.spy_return_pct != null || hist.length >= 2) && (
          <section className={`mb-6 ${CARD}`}>
            <div className="p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                ¿Bate al mercado?{perf?.since ? ` · desde el ${fmtDay(perf.since)}` : ""}
              </p>
              {perf?.spy_return_pct != null && (
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-7 gap-y-1 tabular-nums">
                  <span>
                    <span className={`text-3xl font-bold tracking-tight ${perf.portfolio_return_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {sign(perf.portfolio_return_pct)}{perf.portfolio_return_pct}%
                    </span>
                    <span className="ml-1.5 text-xs text-slate-500">cartera</span>
                  </span>
                  <span>
                    <span className="text-xl font-bold text-slate-500">{sign(perf.spy_return_pct)}{perf.spy_return_pct}%</span>
                    <span className="ml-1.5 text-xs text-slate-500">S&amp;P 500</span>
                  </span>
                  {perf.alpha_pct != null && (
                    <span>
                      <span className={`text-xl font-bold ${perf.alpha_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {sign(perf.alpha_pct)}{perf.alpha_pct} pp
                      </span>
                      <span className="ml-1.5 text-xs text-slate-500">alpha</span>
                    </span>
                  )}
                </div>
              )}
              {hist.length >= 2 && (
                <div className="mt-3">
                  <HistoryChart points={hist} />
                </div>
              )}
            </div>
          </section>
        )}

        {/* 2 · La cartera — tabla densa; la tesis expande por fila (con sesión) */}
        <section className={`mb-6 ${CARD}`}>
          <CardHead>
            La cartera{perf && perf.positions.length > 0 ? ` · ${perf.positions.length} posiciones` : ""}
            {investedPct > 0 && (
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                {investedPct.toFixed(0)}% invertido
              </span>
            )}
          </CardHead>
          {!perf || perf.positions.length === 0 ? (
            <Empty running={running} />
          ) : (
            <>
              <div className="overflow-x-auto px-4">
                <table className="w-full border-collapse whitespace-nowrap text-xs tabular-nums">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                      <th className="py-2 pr-3 font-semibold">Posición</th>
                      {!anon && <th className="px-3 py-2 text-right font-semibold">Peso</th>}
                      {!anon && <th className="px-3 py-2 text-right font-semibold">Coste medio</th>}
                      {!anon && <th className="px-3 py-2 text-right font-semibold">Último</th>}
                      {!anon && <th className="px-3 py-2 text-right font-semibold">Valor</th>}
                      <th className="px-3 py-2 text-right font-semibold">P&L</th>
                      <th className="w-6 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {perf.positions.map((p, i) => {
                      const up = Number(p.unrealized_pnl);
                      const pct = p.pnl_pct ?? p.unrealized_pct ?? 0;
                      const srow = p.ticker ? scores.find((s) => s.ticker === p.ticker) : undefined;
                      const label = anon ? (p.label ?? `Posición ${i + 1}`) : p.ticker;
                      const w = !anon && equity > 0 && p.value ? (Number(p.value) / equity) * 100 : null;
                      const open = !anon && openPos === p.ticker;
                      return (
                        <PositionRows
                          key={label ?? i} anon={anon} color={POS_COLOR[i % POS_COLOR.length]}
                          label={label ?? `Posición ${i + 1}`} sector={srow?.sector} pos={p}
                          weightPct={w} up={up} pct={pct} open={open} srow={srow}
                          onToggle={() => p.ticker && setOpenPos(open ? null : p.ticker)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-slate-100 px-4 py-2 text-[11px] tabular-nums text-slate-400">
                caja ${money(ledger?.cash ?? 0)}{equity > 0 ? ` (${(100 - investedPct).toFixed(0)}%)` : ""} ·
                patrimonio ${money(equity)} · P&L realizado ${money(ledger?.realized_pnl ?? 0)}
                {anon ? " · detalle por posición: acceso privado" : " · pincha una fila para su tesis"}
              </p>
            </>
          )}
        </section>

        {anon ? (
          /* Sin sesión: decisión, observatorio y ranking son del método — candado sobrio. */
          <section className={`${CARD} flex min-h-[26vh] flex-col items-center justify-center gap-3 border-dashed p-10 text-center`}>
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="max-w-xs text-sm text-slate-400">
              Decisión mensual, observatorio y ranking — acceso privado
            </p>
          </section>
        ) : (
          <>
            {/* 3 · Decisión mensual + 4 · Observatorio semanal */}
            <div className="mb-6 grid gap-6 md:grid-cols-2">
              <section className={CARD}>
                <CardHead>
                  Decisión{proposal?.created_at ? ` del ${fmtDay(proposal.created_at)}` : ""}
                  <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                    próxima: {nextDecisionLabel()}
                  </span>
                </CardHead>
                <div className="p-4 text-xs leading-relaxed text-slate-600">
                  {trades.length === 0 ? (
                    <p className="text-slate-400">
                      {items.length > 0
                        ? "La última decisión mantuvo la cartera tal cual — cero operaciones."
                        : "Aún no hay ninguna decisión de cartera."}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {trades.map((it) => {
                        const buySide = it.action === "comprar" || it.action === "ampliar";
                        const done = buySide ? heldSet.has(it.ticker) : !heldSet.has(it.ticker);
                        return (
                          <p key={it.ticker} className="tabular-nums">
                            <span className={done ? "text-emerald-600" : "text-slate-300"}>{done ? "✓" : "○"}</span>{" "}
                            {ACTION_LABEL[it.action]} <b className="font-semibold text-slate-800">{it.ticker}</b>
                            {it.target_weight_pct ? ` · ${it.target_weight_pct}%` : ""}
                            {it.score != null && <span className="text-slate-400"> · score {it.score}</span>}
                          </p>
                        );
                      })}
                    </div>
                  )}
                  {proposal != null && (
                    <p className="mt-2 tabular-nums text-slate-400">objetivo en caja {proposal.cash_target_pct}%</p>
                  )}
                  {proposal?.macro_summary && (
                    <p className="mt-2 border-t border-slate-100 pt-2 text-[11.5px] italic leading-relaxed text-slate-500">
                      “{proposal.macro_summary}”
                    </p>
                  )}
                </div>
              </section>

              <section className={CARD}>
                <CardHead>
                  Observatorio semanal
                  {status?.finished_at && (
                    <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                      {fmtTime(status.finished_at)}
                    </span>
                  )}
                </CardHead>
                <div className="p-4 text-xs leading-relaxed text-slate-600">
                  <p className="tabular-nums">
                    {status?.result
                      ? <>{status.result.prescored} nombres estudiados · {status.result.deep} a fondo
                          {status.result.cost ? ` · $${status.result.cost.cost_usd.toFixed(3)}` : ""}</>
                      : "Cada martes el agente estudia el universo entero para aprender."}
                  </p>
                  {scores.length > 0 && (
                    <p className="mt-1.5">
                      top del ranking:{" "}
                      {scores.slice(0, 3).map((s, i) => (
                        <span key={s.ticker}>
                          {i > 0 && " · "}
                          <b className="font-semibold text-slate-800">{s.ticker} {s.score}</b>
                        </span>
                      ))}
                    </p>
                  )}
                  {watchTop.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {watchTop.slice(0, 10).map((w) => (
                        <button
                          key={w.ticker} title={w.thesis}
                          onClick={() => { setSectorF(null); setQ(w.ticker); }}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:bg-white hover:ring-slate-300"
                        >
                          {w.ticker}<span className="tabular-nums text-slate-400">{w.score}</span>
                        </button>
                      ))}
                      {watchTop.length > 10 && (
                        <span className="text-[11px] text-slate-400">+{watchTop.length - 10} en seguimiento</span>
                      )}
                    </div>
                  )}
                  <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                    la cartera no se toca hasta la decisión mensual (o un análisis manual)
                  </p>
                </div>
              </section>
            </div>

            {/* 5 · Ranking a fondo — sección propia, con buscador y filtro por sector */}
            <section className={`mb-6 ${CARD} p-5`}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold tracking-tight">Ranking a fondo</h2>
                <span className="text-[11px] text-slate-400">
                  {scores.length} analizados{status?.result?.prescored ? ` · ${status.result.prescored} pre-cribados` : ""}
                </span>
              </div>
              {scores.length === 0 ? (
                <Empty running={running} />
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input
                      value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ticker o tesis…"
                      aria-label="Buscar ticker o tesis"
                      className="h-8 w-44 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none placeholder:text-slate-300 focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <div className="flex flex-wrap gap-1">
                      <SectorChip active={!sectorF} onClick={() => setSectorF(null)}>Todos</SectorChip>
                      {sectors.map((sec) => (
                        <SectorChip key={sec} active={sectorF === sec}
                                    onClick={() => setSectorF(sectorF === sec ? null : sec)}>
                          {sec}
                        </SectorChip>
                      ))}
                    </div>
                  </div>
                  {scoresView.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 py-8 text-center text-sm text-slate-400">
                      Nada coincide con ese filtro.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {scoresView.map((s) => <ScoreRowItem key={s.id} row={s} />)}
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}

        <footer className="mt-10 border-t border-slate-200 pt-4 text-center text-[11px] text-slate-400">
          No constituye recomendación de inversión · sala sombra · operaciones simuladas, sin dinero real · metodología tipo whitepaper DeepSeek
        </footer>
      </div>
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

function SectorChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition ${
        active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-500 ring-slate-200 hover:ring-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ running }: { running: boolean }) {
  return (
    <div className="m-4 flex min-h-[22vh] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 text-center">
      <p className="text-3xl">{running ? "🛰️" : "📡"}</p>
      <p className="mt-3 max-w-sm text-sm text-slate-500">
        {running
          ? "El agente puntúa el universo y construye la cartera…"
          : "El agente escanea cada semana para aprender y decide cartera el primer martes del mes (o al lanzarlo desde la Sala Real). Cuando decida, aquí aparece la cartera, ya ejecutada en el libro sombra."}
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, accent, tone }: {
  label: string; value: string; sub?: string; accent?: boolean; tone?: "pos" | "neg";
}) {
  return (
    <div className="bg-white px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums tracking-tight ${
        accent ? "text-slate-900" : tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-rose-600" : "text-slate-800"
      }`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

/* Par de filas de la tabla de cartera: la fila de datos + (si está abierta) su tesis. */
function PositionRows({ anon, color, label, sector, pos, weightPct, up, pct, open, srow, onToggle }: {
  anon: boolean; color: string; label: string; sector?: string;
  pos: { avg_cost?: string | null; price?: string | null; value?: string | null };
  weightPct: number | null; up: number; pct: number; open: boolean;
  srow?: { headline: string | null; score: number; target_price: number | null };
  onToggle: () => void;
}) {
  const clickable = !anon;
  return (
    <>
      <tr
        onClick={clickable ? onToggle : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-expanded={clickable ? open : undefined}
        onKeyDown={clickable ? (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
        } : undefined}
        className={`border-t border-slate-100 ${clickable ? "cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none" : ""}`}
      >
        <td className="py-2 pr-3">
          <span className={`mr-2 inline-block h-2 w-2 rounded-sm align-middle ${color}`} />
          <b className="font-semibold text-slate-800">{label}</b>
          {sector && <span className="ml-2 text-[10px] text-slate-400">{sector}</span>}
        </td>
        {!anon && <td className="px-3 py-2 text-right">{weightPct != null ? `${weightPct.toFixed(1)}%` : "—"}</td>}
        {!anon && <td className="px-3 py-2 text-right text-slate-500">{pos.avg_cost ? `$${money(pos.avg_cost)}` : "—"}</td>}
        {!anon && <td className="px-3 py-2 text-right">{pos.price ? `$${money(pos.price)}` : "—"}</td>}
        {!anon && <td className="px-3 py-2 text-right text-slate-800">{pos.value ? `$${money(pos.value)}` : "—"}</td>}
        <td className="px-3 py-2 text-right">
          <span className={`text-[11px] ${up >= 0 ? "text-emerald-500/80" : "text-rose-400/80"}`}>
            {up >= 0 ? "+" : "−"}${money(Math.abs(up))}
          </span>{" "}
          <span className={`font-semibold ${pct >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
            {pct > 0 ? "+" : ""}{pct}%
          </span>
        </td>
        <td className="py-2 text-right text-slate-300">
          {clickable && (
            <svg viewBox="0 0 24 24" className={`inline h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-50 bg-slate-50/50">
          <td colSpan={7} className="px-3 py-2 text-[11.5px] leading-relaxed text-slate-500">
            {srow?.headline
              ? <><span className="font-semibold text-slate-600">Tesis</span> · {srow.headline}
                  <span className="ml-1 text-slate-400">
                    · score {srow.score}{srow.target_price != null ? ` · objetivo $${money(srow.target_price)}` : ""}
                  </span></>
              : "Sin tesis reciente para este nombre (saldrá en el próximo análisis a fondo)."}
          </td>
        </tr>
      )}
    </>
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
