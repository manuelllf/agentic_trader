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
  getScanFunnel,
  getScanOutcomes,
  getScanReport,
  getScores,
  getWatchlist,
  hasToken,
  type OutcomeScan,
  type OutcomeStats,
  type ScanReport,
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
import {
  cascada, fmtNum, fmtScanCost, sectoresTop, universoLinea, type FunnelScan,
} from "@/lib/scan";

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
  // Informe y embudo PERSISTIDOS: `status` es la memoria del runner manual y muere en cada
  // deploy (el cron del martes ni la escribe), así que el observatorio no puede colgar de él.
  const [report, setReport] = useState<ScanReport | null>(null);
  const [funnel, setFunnel] = useState<FunnelScan | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeScan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openPos, setOpenPos] = useState<string | null>(null);   // fila de cartera expandida
  const [q, setQ] = useState("");                                // buscador del ranking
  const [sectorF, setSectorF] = useState<string | null>(null);   // filtro de sector del ranking
  const [authed, setAuthed] = useState(false);   // sesión detectada en el último refresco
  const chartBox = useRef<HTMLDivElement | null>(null);   // contenedor del SVG claro que se exporta
  // El mismo HistoryChart, montado en variante OSCURA pero fuera de pantalla: la tarjeta de X
  // (tema dark) no puede clonar el SVG claro que se ve en la página, así que existe un segundo
  // gráfico invisible solo para eso. `display: contents` no vale (el SVG mide 0 sin caja propia).
  const darkChartBox = useRef<HTMLDivElement | null>(null);
  const [exportMsg, setExportMsg] = useState("");
  const [exportEmbudoMsg, setExportEmbudoMsg] = useState("");
  const [exportGruposMsg, setExportGruposMsg] = useState("");   // tarjeta "¿eligió bien?"
  const [exportScoreMsg, setExportScoreMsg] = useState("");     // tarjeta "¿el score predice?"
  const [rankingOpen, setRankingOpen] = useState(false);   // overlay del ranking semanal (privado)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);                    // guard de desmontaje (mismo patrón que portada)

  const refresh = useCallback(async () => {
    try {
      // El ledger es crítico (define la conexión); el resto degrada con gracia si falla.
      const l = await getLedger();
      const [m, pf, st, hs, sr, fn, oc] = await Promise.all([
        getMacro().catch(() => null),
        getPerformance().catch(() => null),
        getDemoStatus().catch(() => null),
        getHistory("shadow").catch(() => null),
        // Los tres son de doble nivel: sin sesión llegan igual, pero sin tickers ni scores.
        getScanReport().catch(() => null),
        getScanFunnel(1).catch(() => null),
        getScanOutcomes(6).catch(() => null),
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
      if (sr) setReport(sr.report);
      if (fn) setFunnel(fn.scans[0] ?? null);
      if (oc) setOutcomes(oc.scans);
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

  // El overlay del ranking cierra con Escape, además del backdrop y el botón — un modal sin
  // salida por teclado es una trampa para quien navega sin ratón.
  useEffect(() => {
    if (!rankingOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setRankingOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rankingOpen]);

  /** Descarga la curva como TARJETA: cabecera + gráfica + pie legal, en una sola imagen. El
   *  descargo tiene que viajar DENTRO del PNG — en el texto del post se pierde al reenviarlo. */
  const exportarTarjeta = useCallback(async (preset: "x" | "linkedin") => {
    // X (dark) clona el gráfico oscuro OCULTO; LinkedIn (claro) sigue clonando el visible — un
    // gráfico claro dentro de una tarjeta dark quedaría fuera de lugar (y viceversa).
    const box = preset === "x" ? darkChartBox.current : chartBox.current;
    const svg = box?.querySelector("svg");
    if (!svg) return;
    setExportMsg("Componiendo…");
    try {
      const { downloadChartCard, CARD_THEMES, themeForPreset } = await import("@/lib/exportCard");
      const theme = CARD_THEMES[themeForPreset(preset)];
      const hoy = new Date();
      await downloadChartCard({
        preset,
        title: "¿Bate al mercado?",
        subtitle: "Agentic Trader · ranker fundamental sistemático",
        badges: [
          ...(perf?.since ? [{ text: `desde el ${fmtDay(perf.since)}` }] : []),
          { text: `datos a ${fmtDay(hoy.toISOString().slice(0, 10))}` },
        ],
        panels: [{
          label: "CARTERA SOMBRA VS S&P 500",
          note: "índice base 100 · las aportaciones no cuentan como rentabilidad",
          stats: [
            { label: "CARTERA", value: `${sign(perf?.portfolio_return_pct ?? 0)}${perf?.portfolio_return_pct ?? 0}%`,
              color: (perf?.portfolio_return_pct ?? 0) >= 0 ? theme.accent : theme.bad },
            { label: "S&P 500", value: `${sign(perf?.spy_return_pct ?? 0)}${perf?.spy_return_pct ?? 0}%`,
              color: theme.ink2 },
            ...(perf?.alpha_pct != null
              ? [{ label: "ALPHA", value: `${sign(perf.alpha_pct)}${perf.alpha_pct} pp`,
                   color: perf.alpha_pct >= 0 ? theme.accent : theme.bad }]
              : []),
          ],
          body: svg as SVGSVGElement,
        }],
        footer: "No constituye recomendación de inversión · operaciones simuladas, sin dinero real · rentabilidad neta de comisiones simuladas",
        filename: `agentic-trader-${hoy.toISOString().slice(0, 10)}`,
      });
      setExportMsg("");
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : "No se pudo exportar.");
    }
  }, [perf]);

  /** El embudo como tarjeta. Es la imagen del martes: el escaneo semanal no mueve la cartera,
   *  así que lo publicable de ese día es cuánto se miró y por dónde se fue cayendo. */
  const exportarEmbudo = useCallback(async (preset: "x" | "linkedin") => {
    setExportEmbudoMsg("Componiendo…");
    try {
      const [{ downloadChartCard, quoteSvg, CARD_THEMES, themeForPreset }, { funnelCascadeSvg, funnelPie }] = await Promise.all([
        import("@/lib/exportCard"),
        import("@/lib/funnelCard"),
      ]);
      const theme = CARD_THEMES[themeForPreset(preset)];
      const u = universoLinea(report);
      const coste = fmtScanCost(report?.cost ?? null);
      const dia = fmtDay(report?.at ?? new Date().toISOString());
      const pasos = cascada(report, funnel);
      // La tesis DE ESTE escaneo manda; la de la última decisión es el respaldo para informes
      // viejos (anteriores a que el observatorio guardase la suya).
      const tesis = report?.outlook?.trim() || proposal?.macro_summary?.trim();
      const tesisPropia = !!report?.outlook?.trim();
      await downloadChartCard({
        preset,
        title: "El embudo del escaneo",
        subtitle: "Agentic Trader · ranker fundamental sistemático",
        badges: [
          { text: `${report?.mode === "decisión" ? "decisión mensual" : "observatorio semanal"} · ${dia}` },
          ...(macro ? [{ text: `${macro.regime}${macro.vix != null ? ` · VIX ${macro.vix}` : ""}`,
                         tone: macro.regime === "risk-off" ? ("amber" as const) : ("green" as const) }] : []),
          ...(coste ? [{ text: coste.split(" · ")[0] + " de coste" }] : []),
        ],
        panels: [
          {
            // Rótulo corto a propósito: la apostilla de al lado se recorta al ancho del panel,
            // y el universo (lo que de verdad da la escala) importa más que un rótulo bonito.
            label: "EL EMBUDO",
            // Solo el primer tramo del detalle: la apostilla es contexto, no la línea entera.
            note: u ? `${u.texto} · ${u.detalle.split(" · ")[0]}` : undefined,
            weight: tesis ? 0.85 : 1,
            body: funnelCascadeSvg(pasos, theme, funnelPie(pasos, sectoresTop(funnel, 3),
              (funnel?.sin_datos ?? 0) + (funnel?.prescore_error ?? 0))),
          },
          // Los números solos no concluyen nada: la tesis es el marco que los interpreta, y va
          // ÍNTEGRA y con su autoría — es del sistema, no mía.
          ...(tesis
            ? [{ label: "SU TESIS MACRO",
                 // Si la tesis no es de este escaneo, la tarjeta lo dice: emparejar el embudo
                 // del martes con un contexto de hace semanas sin avisar sería mentir.
                 note: tesisPropia
                   ? "íntegra, escrita por el propio sistema en este escaneo"
                   : `íntegra, de la decisión del ${fmtDay(proposal?.created_at ?? null)}`,
                 weight: 1.15, body: quoteSvg(tesis, theme) }]
            : []),
        ],
        footer: "No constituye recomendación de inversión · agregados por etapa y sector, sin nombres · operaciones simuladas, sin dinero real",
        filename: `agentic-trader-embudo-${(report?.at ?? new Date().toISOString()).slice(0, 10)}`,
      });
      setExportEmbudoMsg("");
    } catch (e) {
      setExportEmbudoMsg(e instanceof Error ? e.message : "No se pudo exportar.");
    }
  }, [report, funnel, proposal, macro]);

  /** "¿Eligió bien?": retorno medio por grupo (cartera · elegidos sin fondear · descartados ·
   *  S&P) y la frontera del corte en el pie. Requiere una cohorte con cartera fondeada y con
   *  al menos 5 días de mercado encima — antes de eso el retorno es ruido, no lectura, y una
   *  tarjeta con ~0% en todo no diría nada. Sin esa cohorte, NO se descarga nada: mejor un
   *  botón que avisa que una imagen vacía. */
  const exportarOutcomesGrupos = useCallback(async (preset: "x" | "linkedin") => {
    const c = outcomes.find((s) => s.groups.cartera.n > 0 && s.days >= 5);
    if (!c) { setExportGruposMsg("No disponible aún: sin decisiones con historial suficiente"); return; }
    setExportGruposMsg("Componiendo…");
    try {
      const [{ downloadChartCard, CARD_THEMES, themeForPreset }, { groupBarsSvg }] = await Promise.all([
        import("@/lib/exportCard"),
        import("@/lib/outcomesCard"),
      ]);
      const theme = CARD_THEMES[themeForPreset(preset)];
      const pct = (v: number | null) => (v == null ? "—" : `${sign(v)}${v.toFixed(1)}%`);
      const g = c.groups;
      const barras = [
        ...(g.cartera.n ? [{ label: "en cartera", value: g.cartera.avg ?? 0,
                             n: g.cartera.n, kind: "acento" as const }] : []),
        ...(g.seleccionados.n ? [{ label: "elegidos sin fondear", value: g.seleccionados.avg ?? 0,
                                   n: g.seleccionados.n }] : []),
        ...(g.descartados.n ? [{ label: "descartados", value: g.descartados.avg ?? 0,
                                 n: g.descartados.n }] : []),
        ...(g.spy != null ? [{ label: "S&P 500", value: g.spy, kind: "indice" as const }] : []),
      ];
      const frontera = c.corte.fuera.n && c.corte.dentro.n
        ? `la frontera del corte: los ${c.corte.fuera.n} mejores que quedaron fuera ${pct(c.corte.fuera.avg)} · los ${c.corte.dentro.n} peores que entraron ${pct(c.corte.dentro.avg)}`
        : "";
      await downloadChartCard({
        preset,
        title: "¿Eligió bien?",
        subtitle: "Agentic Trader · ranker fundamental sistemático",
        badges: [
          { text: `${c.mode} del ${fmtDay(c.at)}` },
          { text: `${c.days} día${c.days === 1 ? "" : "s"} de mercado después` },
        ],
        panels: [{
          label: "RETORNO MEDIO POR GRUPO",
          note: "a igual peso dentro de cada grupo · desde el precio del día del escaneo",
          body: groupBarsSvg(barras, theme, frontera),
        }],
        footer: "No constituye recomendación de inversión · agregados de la traza de auditoría, sin nombres · operaciones simuladas, sin dinero real",
        filename: `agentic-trader-eligio-bien-${c.at.slice(0, 10)}`,
      });
      setExportGruposMsg("");
    } catch (e) {
      setExportGruposMsg(e instanceof Error ? e.message : "No se pudo exportar.");
    }
  }, [outcomes]);

  /** "¿El score predice?": la nube score↔retorno, un punto por análisis a fondo. Requiere
   *  alguna cohorte con 5+ días de mercado Y pares que dibujar; sin eso, guard igual que arriba. */
  const exportarOutcomesScore = useCallback(async (preset: "x" | "linkedin") => {
    const c = outcomes.find((s) => s.days >= 5 && s.pairs.length > 0);
    if (!c) { setExportScoreMsg("No disponible aún: sin cohortes con historial suficiente"); return; }
    setExportScoreMsg("Componiendo…");
    try {
      const [{ downloadChartCard, CARD_THEMES, themeForPreset }, { scatterSvg }] = await Promise.all([
        import("@/lib/exportCard"),
        import("@/lib/outcomesCard"),
      ]);
      const theme = CARD_THEMES[themeForPreset(preset)];
      await downloadChartCard({
        preset,
        title: "¿El score predice?",
        subtitle: "Agentic Trader · ranker fundamental sistemático",
        badges: [
          { text: `${c.mode} del ${fmtDay(c.at)}` },
          { text: `${c.days} día${c.days === 1 ? "" : "s"} de mercado después` },
          { text: `${c.pairs.length} análisis a fondo`, tone: "green" as const },
        ],
        panels: [{
          label: "SCORE VS RETORNO",
          note: "cada punto, un análisis a fondo, sin identificar · en verde, los del libro",
          body: scatterSvg(c.pairs.map((p) => ({ score: p.score, ret: p.ret, funded: p.funded })), theme),
        }],
        footer: "No constituye recomendación de inversión · agregados de la traza de auditoría, sin nombres · operaciones simuladas, sin dinero real",
        filename: `agentic-trader-score-predice-${c.at.slice(0, 10)}`,
      });
      setExportScoreMsg("");
    } catch (e) {
      setExportScoreMsg(e instanceof Error ? e.message : "No se pudo exportar.");
    }
  }, [outcomes]);

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
                  <div ref={chartBox}>
                    <HistoryChart points={hist} />
                  </div>
                  {/* Gemelo oscuro del mismo gráfico, fuera de pantalla: la tarjeta de X (dark)
                      clona ESTE SVG, no el claro de arriba. `dark` es la misma prop que usa la
                      Sala Real. Sigue en el documento (no display:none) para que el SVG mida algo. */}
                  <div ref={darkChartBox} aria-hidden className="pointer-events-none fixed -left-[10000px] top-0 w-[660px]">
                    <HistoryChart points={hist} dark />
                  </div>
                  <ExportButtons onExport={exportarTarjeta} msg={exportMsg} />
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
          /* Sin sesión: QUÉ nombres elige el método es privado, pero CÓMO se comporta el
             embudo no identifica a nadie y es lo que da contexto a quien llega de fuera. */
          <>
          <div className="mb-6 grid gap-6 md:grid-cols-2">
            <section className={CARD}>
              <CardHead>
                El embudo del último escaneo
                {report?.at && (
                  <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                    {fmtTime(report.at)}
                  </span>
                )}
              </CardHead>
              <div className="p-4 text-xs leading-relaxed text-slate-600">
                <FunnelCascade report={report} scan={funnel} />
                <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                  cada martes se estudia el mercado entero; la cartera solo se decide una vez al mes
                </p>
                <ExportButtons onExport={exportarEmbudo} msg={exportEmbudoMsg} />
              </div>
            </section>
            <section className={`${CARD} flex flex-col items-center justify-center gap-3 border-dashed p-10 text-center`}>
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="max-w-xs text-sm text-slate-400">
                Qué nombres elige — decisión mensual y ranking — es acceso privado
              </p>
            </section>
          </div>
          <OutcomesRead scans={outcomes}
                        onExportGrupos={exportarOutcomesGrupos} msgGrupos={exportGruposMsg}
                        onExportScore={exportarOutcomesScore} msgScore={exportScoreMsg} />
          </>
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
                  {(proposal?.omitted ?? []).length > 0 && (
                    // Los que se quedaron fuera del top-10. Fondear 5 de 10 obliga a descartar
                    // 5, así que el interés no es el "no" sino el motivo escrito.
                    <details className="mt-2 border-t border-slate-100 pt-2">
                      <summary className="cursor-pointer list-none text-[11px] text-slate-400 hover:text-slate-600">
                        se quedaron fuera {proposal?.omitted?.length} de los seleccionados ▾
                      </summary>
                      <div className="mt-1.5 space-y-1">
                        {(proposal?.omitted ?? []).map((o) => (
                          <p key={o.ticker} className="text-[11.5px] leading-relaxed text-slate-500">
                            <b className="font-semibold text-slate-700">{o.ticker}</b>
                            {o.reason ? ` — ${o.reason}` : ""}
                          </p>
                        ))}
                      </div>
                    </details>
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
                  {report?.at && (
                    <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                      {fmtTime(report.at)}
                    </span>
                  )}
                </CardHead>
                <div className="p-4 text-xs leading-relaxed text-slate-600">
                  <FunnelCascade report={report} scan={funnel} />
                  {scores.length > 0 && (
                    <p className="mt-2.5">
                      top del ranking:{" "}
                      {scores.slice(0, 3).map((s, i) => (
                        <span key={s.ticker}>
                          {i > 0 && " · "}
                          <b className="font-semibold text-slate-800">{s.ticker} {s.score}</b>
                        </span>
                      ))}
                    </p>
                  )}
                  {/* Vista PRIVADA a propósito: el ranking completo con tickers no lleva botón
                      de exportar — publicarlo sería un feed de señales, no "así funciona". */}
                  {!!funnel?.nombres?.length && (
                    <button
                      onClick={() => setRankingOpen(true)}
                      className="mt-1.5 text-[11px] font-medium text-slate-400 underline decoration-slate-200 underline-offset-2 transition hover:text-slate-600"
                    >
                      ver el ranking de este observatorio
                    </button>
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
                  {report?.outlook && (
                    // La tesis macro DE ESTE escaneo: se paga una llamada al modelo grande por
                    // ella y solo se veía al exportar la tarjeta. Plegada y etiquetada como
                    // lectura semanal — la que justificó la cartera vive en la tarjeta de la
                    // decisión, y confundirlas sería mezclar dos fechas distintas.
                    <details className="mt-2 border-t border-slate-100 pt-2">
                      <summary className="cursor-pointer list-none text-[11px] text-slate-400 hover:text-slate-600">
                        su lectura macro de esta semana ▾
                      </summary>
                      <p className="mt-1.5 text-[11.5px] italic leading-relaxed text-slate-500">
                        “{report.outlook}”
                      </p>
                    </details>
                  )}
                  <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                    la cartera no se toca hasta la decisión mensual (o un análisis manual)
                  </p>
                  <ExportButtons onExport={exportarEmbudo} msg={exportEmbudoMsg} />
                </div>
              </section>
            </div>

            {/* 4b · La traza leída: compradas vs descartadas vs índice, por cohorte */}
            <OutcomesRead scans={outcomes}
                          onExportGrupos={exportarOutcomesGrupos} msgGrupos={exportGruposMsg}
                          onExportScore={exportarOutcomesScore} msgScore={exportScoreMsg} />

            {/* 5 · Ranking a fondo — sección propia, con buscador y filtro por sector */}
            <section className={`mb-6 ${CARD} p-5`}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold tracking-tight">
                  Ranking a fondo
                  {/* El ranking visible es el de la DECISIÓN (el semanal ya no lo pisa, solo
                      refresca coincidencias): sin esta etiqueta parecería la foto del último
                      escaneo, que es justo lo que dejó de ser. */}
                  <span className="ml-2 text-[11px] font-normal tracking-normal text-slate-400">
                    {proposal?.created_at ? `decisión del ${fmtDay(proposal.created_at)}` : ""}
                    {report?.mode === "observatorio" && (report?.refreshed ?? 0) > 0
                      ? ` · ${report?.refreshed} refrescados el ${fmtDay(report?.at ?? null)}`
                      : ""}
                  </span>
                </h2>
                {/* Los profundos REALES vienen de la traza; `scores.length` son las filas que
                    se muestran, que es otra cosa (de ahí el viejo "25 a fondo" que no cuadraba). */}
                <span className="text-[11px] tabular-nums text-slate-400">
                  {funnel?.deep ?? report?.deep ?? scores.length} analizados a fondo
                  {(funnel?.pre ?? report?.prescored)
                    ? ` · ${fmtNum(funnel?.pre ?? report?.prescored ?? 0)} pre-cribados`
                    : ""}
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

        {/* Overlay del ranking semanal: vista PRIVADA, sin export — un ranking con tickers
            publicado sería un feed de señales, justo lo que separa "así funciona" de "qué comprar". */}
        {rankingOpen && !!funnel?.nombres?.length && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-10 backdrop-blur-sm"
            onClick={() => setRankingOpen(false)}
          >
            <div
              className={`w-full max-w-lg ${CARD} max-h-[80vh] overflow-y-auto`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-2.5 backdrop-blur">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Ranking de este observatorio
                </h2>
                <button
                  onClick={() => setRankingOpen(false)}
                  aria-label="Cerrar"
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>
              <div className="p-4 text-xs leading-relaxed text-slate-600">
                {report?.outlook && (
                  <p className="mb-3 border-b border-slate-100 pb-3 italic text-slate-500">
                    “{report.outlook}”
                  </p>
                )}
                <div className="divide-y divide-slate-100">
                  {funnel.nombres.map((n) => (
                    <div key={n.ticker} className="flex items-center gap-3 py-1.5 tabular-nums">
                      <span className="w-16 shrink-0 font-semibold text-slate-800">{n.ticker}</span>
                      <span className="flex-1 truncate text-slate-400">{n.sector}</span>
                      <span className="w-10 shrink-0 text-right font-semibold text-slate-700">
                        {n.deep_score ?? n.prescore ?? "—"}
                      </span>
                      <span className="w-24 shrink-0 text-right text-[10px] uppercase tracking-wide text-slate-400">
                        {n.stage}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- components ---------- */

/** El embudo del escaneo: de todo el mercado mirado a los cinco que acaban en cartera.
 *  Es PÚBLICO a propósito — cuenta cómo se comporta el sistema sin nombrar a nadie, que es
 *  justo la línea que separa "así funciona" de un feed de señales. */
function FunnelCascade({ report, scan }: { report: ScanReport | null; scan: FunnelScan | null }) {
  const pasos = cascada(report, scan);
  const universo = universoLinea(report);
  const sectores = sectoresTop(scan, 4);
  const coste = fmtScanCost(report?.cost ?? null);

  if (!pasos.length) {
    return (
      <p className="text-slate-400">
        Cada martes el agente estudia el mercado entero para aprender. Aún no hay traza del
        último escaneo.
      </p>
    );
  }
  return (
    <>
      {universo && (
        <p className={universo.tone === "ok" ? "text-slate-500" : "font-medium text-amber-600"}>
          universo <b className="tabular-nums font-semibold text-slate-800">{universo.texto}</b>
          <span className="text-slate-400"> · {universo.detalle}</span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {pasos.map((p, i) => (
          <div key={p.label} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-300" aria-hidden>→</span>}
            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-inset ring-slate-200"
                 title={p.hint}>
              <p className="text-[15px] font-semibold leading-none tabular-nums text-slate-800">
                {fmtNum(p.value)}
              </p>
              <p className="mt-0.5 text-[10.5px] leading-none text-slate-400">
                {p.label}
                {p.pctOfPrev != null && (
                  <span className="tabular-nums">
                    {" · "}{p.pctOfPrev < 1 ? p.pctOfPrev.toFixed(1) : Math.round(p.pctOfPrev)}%
                  </span>
                )}
              </p>
            </div>
          </div>
        ))}
      </div>
      {sectores.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          a fondo por sector:{" "}
          {sectores.map((s, i) => (
            <span key={s.sector} className="tabular-nums">
              {i > 0 && " · "}{s.sector} <b className="font-semibold text-slate-700">{s.deep}</b>
              <span className="text-slate-400">/{fmtNum(s.pre)}</span>
            </span>
          ))}
        </p>
      )}
      {coste && <p className="mt-1 text-[11px] tabular-nums text-slate-400">coste del escaneo {coste}</p>}
      {(report?.issues ?? []).length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-amber-700">
          {(report?.issues ?? []).map((it) => (
            <li key={it}><span className="mr-1" aria-hidden>▲</span>{it}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Un retorno medio de grupo, coloreado por signo y con el tamaño del grupo al lado. */
function OutPct({ s }: { s: OutcomeStats }) {
  if (!s.n || s.avg == null) return <span className="text-slate-300">—</span>;
  return (
    <>
      <span className={s.avg >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-600"}>
        {sign(s.avg)}{s.avg.toFixed(1)}%
      </span>
      <span className="text-slate-400"> ({s.n})</span>
    </>
  );
}

/** La traza LEÍDA: qué hizo después cada grupo de cada cohorte. Son agregados puros —
 *  visibles también sin sesión, como el embudo: comportamiento sí, nombres no. Cada fila es
 *  un escaneo; el retorno va desde el precio del día del escaneo hasta hoy, a igual peso.
 *  Dos tarjetas, dos preguntas: "¿eligió bien?" (barras por grupo) y "¿el score predice?"
 *  (la nube score↔retorno) — cada una con su propio guard de "aún sin historial suficiente". */
function OutcomesRead({ scans, onExportGrupos, msgGrupos, onExportScore, msgScore }: {
  scans: OutcomeScan[];
  onExportGrupos: (p: "x" | "linkedin") => void; msgGrupos: string;
  onExportScore: (p: "x" | "linkedin") => void; msgScore: string;
}) {
  if (!scans.length) return null;
  const pct = (v: number | null) => (v == null ? "—" : `${sign(v)}${v.toFixed(1)}%`);
  const masVieja = Math.max(...scans.map((s) => s.days));
  return (
    <section className={`mb-6 ${CARD}`}>
      <CardHead>
        La auditoría, leída
        <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
          qué hizo después cada grupo que tocó el embudo
        </span>
      </CardHead>
      <div className="p-4 text-xs leading-relaxed text-slate-600">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse whitespace-nowrap tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="py-1.5 pr-3 font-semibold">Escaneo</th>
                <th className="px-3 py-1.5 text-right font-semibold">En cartera</th>
                <th className="px-3 py-1.5 text-right font-semibold">Elegidos s/fondear</th>
                <th className="px-3 py-1.5 text-right font-semibold">Descartados</th>
                <th className="px-3 py-1.5 text-right font-semibold">S&P 500</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="los 10 mejores pre-scores que no llegaron al profundo vs los 10 peores que sí entraron">
                  Corte: fuera / dentro
                </th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.at} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3">
                    {fmtDay(s.at)}
                    <span className="text-slate-400"> · {s.mode} · hace {s.days} d</span>
                  </td>
                  <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.cartera} /></td>
                  <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.seleccionados} /></td>
                  <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.descartados} /></td>
                  <td className="px-3 py-1.5 text-right">
                    {s.groups.spy == null ? "—" : `${sign(s.groups.spy)}${s.groups.spy.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-500">
                    {s.corte.fuera.n ? `${pct(s.corte.fuera.avg)} / ${pct(s.corte.dentro.avg)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          retorno simple desde el precio del día del escaneo, a igual peso dentro de cada grupo ·
          un profundo ilegible no cuenta como descarte
          {masVieja < 14 &&
            ` · la cohorte más vieja tiene ${masVieja} día${masVieja === 1 ? "" : "s"}: aún es ruido, la lectura seria llega con semanas`}
        </p>
        <ExportButtons onExport={onExportGrupos} msg={msgGrupos} label="¿Eligió bien?" />
        <ExportButtons onExport={onExportScore} msg={msgScore} label="¿El score predice?" />
      </div>
    </section>
  );
}

/** Un formato por red: cada una recorta a su ratio, y lo que no puede perderse en el recorte
 *  es justamente la cabecera y el pie legal — de ahí que se exporte ya al tamaño de destino.
 *  `label` distingue qué tarjeta exporta este grupo de botones cuando un mismo panel ofrece
 *  varias (la lectura de la auditoría, con "¿eligió bien?" y "¿el score predice?"). */
function ExportButtons({ onExport, msg, label }: {
  onExport: (preset: "x" | "linkedin") => void; msg: string; label?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
      {msg && <span className="mr-auto text-[11px] text-slate-400">{msg}</span>}
      <span className="text-[11px] text-slate-400">{label ? `${label} · exportar tarjeta` : "Exportar tarjeta"}</span>
      {([["x", "X", "16:9 · 1600×900"], ["linkedin", "LinkedIn", "1,91:1 · 1200×627"]] as const)
        .map(([key, netLabel, ratio]) => (
          <button
            key={key} onClick={() => onExport(key)}
            title={`PNG ${ratio}, con cabecera, cifras y descargo legal dentro de la imagen`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {netLabel}
          </button>
        ))}
    </div>
  );
}

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
          {/* whitespace-normal: la tabla es nowrap (columnas numéricas), pero la tesis debe
              ENVOLVER — si no, una línea larga estira la tabla y fuerza scroll horizontal. */}
          <td colSpan={7} className="whitespace-normal px-3 py-2 text-[11.5px] leading-relaxed text-slate-500">
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
