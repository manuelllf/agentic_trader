"use client";

/** Shadow room display: performance vs index, portfolio, decisions, and observatory learning.
 *  Public view shows results + KPIs + anonymous positions; logged-in view includes full details. */

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
  type OutcomeBook,
  type OutcomeScan,
  type OutcomeStats,
  type ScanReport,
} from "@/lib/api";
import HistoryChart from "@/components/HistoryChart";
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
import AlphaDoor from "@/components/AlphaDoor";
import { fmtScore, fmtTime, money } from "@/lib/format";
import { richText } from "@/lib/richText";
import {
  cascada, fmtNum, fmtScanCost, sectoresTop, universoLinea, type FunnelScan,
} from "@/lib/scan";

/* ---------- helpers ---------- */
const ACTION_LABEL: Record<TradeAction, string> = {
  comprar: "Comprar", ampliar: "Ampliar", mantener: "Mantener",
  recortar: "Recortar", vender: "Vender",
};
const MACRO_STYLE: Record<string, string> = {
  "risk-on": "bg-[#6BBE8A]/10 text-[#6BBE8A] ring-[#6BBE8A]/30",
  neutral: "bg-[#232323] text-[#A3A3A0] ring-white/10",
  "risk-off": "bg-[#E0776C]/10 text-[#E0776C] ring-[#E0776C]/30",
  desconocido: "bg-[#232323] text-[#6E6E6B] ring-white/10",
};
// Misma serie validada que real/tokens.ts SERIES -- el verde queda reservado al P&L, nunca
// como color de posición (una perdedora en el puesto 1 no debe parecer "en verde").
const POS_COLOR = ["bg-[#4FA39D]", "bg-[#199e70]", "bg-[#c98500]", "bg-[#9085e9]", "bg-[#d55181]"];
/** Order of reading: how far each ticker reached in the funnel (cartera→prescore stages). */
const STAGE_ORDEN: Record<string, number> = {
  cartera: 0, seleccionado: 1, finalista: 2, deep_error: 3, prescore: 4,
  prescore_error: 5, datos: 6,
};
const scoreColor = (s: number) =>
  s >= 80 ? "bg-[#6BBE8A]" : s >= 65 ? "bg-[#4FA39D]" : s >= 50 ? "bg-[#fab219]" : "bg-[#363636]";
const CARD = "rounded-2xl border border-[#303030] bg-[#1C1C1C] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_16px_32px_-20px_rgba(0,0,0,0.65)]";
// Tipografía propia de la sala (IBM Plex vía next/font en layout.tsx) -- mismo patrón que
// Alpha y X: Sans para texto, Mono para cifras (aplicado a `.tabular-nums`, ver el <style> del
// contenedor raíz), en vez de la tipografía de sistema.
const SOMBRA_SANS = "var(--font-sombra-sans), ui-sans-serif, system-ui, sans-serif";
const SOMBRA_MONO = "var(--font-sombra-mono), ui-monospace, 'SFMono-Regular', monospace";
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
  // Report and funnel are persistent; status dies on deploy (cron doesn't write it).
  const [report, setReport] = useState<ScanReport | null>(null);
  const [funnel, setFunnel] = useState<FunnelScan | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeScan[]>([]);
  const [outBook, setOutBook] = useState<OutcomeBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openPos, setOpenPos] = useState<string | null>(null);   // fila de cartera expandida
  const [q, setQ] = useState("");                                // buscador del ranking
  const [sectorF, setSectorF] = useState<string | null>(null);   // filtro de sector del ranking
  const [authed, setAuthed] = useState(false);   // sesión detectada en el último refresco
  const chartBox = useRef<HTMLDivElement | null>(null);   // container for light SVG export
  // Dark-themed chart rendered off-screen for X card export; light chart above is for LinkedIn.
  const darkChartBox = useRef<HTMLDivElement | null>(null);
  const [exportMsg, setExportMsg] = useState("");
  const [exportEmbudoMsg, setExportEmbudoMsg] = useState("");
  const [exportGruposMsg, setExportGruposMsg] = useState("");   // tarjeta "¿eligió bien?"
  const [exportScoreMsg, setExportScoreMsg] = useState("");     // tarjeta "¿el score predice?"
  const [rankingOpen, setRankingOpen] = useState(false);   // overlay del ranking semanal (privado)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);                    // guard de desmontaje (mismo patrón que portada)
  const hasLoadedOnce = useRef(false);   // primera carga: pantalla completa. Recargas después:
                                          // velo encima, sin desmontar nada (ver el `return`)

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
      if (oc) { setOutcomes(oc.scans); setOutBook(oc.book ?? null); }
      setAuthed(withSession);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "No se pudo contactar con el backend.");
    } finally {
      hasLoadedOnce.current = true;
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

  // Volver a esta pestaña: refresca en segundo plano, SIN velo ni espera — a diferencia de Sala
  // Real, aquí no hay nada que aprobar ni decidir (el sombra se ejecuta solo), así que no hay
  // ninguna acción que pueda tomarse sobre un dato obsoleto. Es el mismo sondeo de 45s, solo
  // adelantado para no esperar al siguiente tick tras una ausencia.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
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
            // El titular del PNG es la cartera; índice y alpha, secundarios (mismo criterio
            // que en la web: la comparación acompaña, no compite).
            { label: "CARTERA", value: `${sign(perf?.portfolio_return_pct ?? 0)}${perf?.portfolio_return_pct ?? 0}%`,
              color: (perf?.portfolio_return_pct ?? 0) >= 0 ? theme.accent : theme.bad },
            { label: "S&P 500", value: `${sign(perf?.spy_return_pct ?? 0)}${perf?.spy_return_pct ?? 0}%`,
              color: theme.ink2, secondary: true },
            ...(perf?.alpha_pct != null
              ? [{ label: "ALPHA", value: `${sign(perf.alpha_pct)}${perf.alpha_pct}%`,
                   color: perf.alpha_pct >= 0 ? theme.accent : theme.bad, secondary: true }]
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

  /** La tarjeta del escaneo. El embudo es el método y es SIEMPRE el mismo (el martes de enero
   *  y el de agosto sacan números parecidos): eso se explica una vez, en el observatorio. En
   *  una DECISIÓN mensual lo que hay que contar es otra cosa — qué cambió en la cartera —, así
   *  que ahí el panel principal pasa a ser la rotación y el embudo baja a una línea al pie. */
  const exportarEmbudo = useCallback(async (preset: "x" | "linkedin") => {
    setExportEmbudoMsg("Componiendo…");
    try {
      const [{ downloadChartCard, quoteSvg, CARD_THEMES, themeForPreset },
             { funnelCascadeSvg, funnelPie, rotationSvg }] = await Promise.all([
        import("@/lib/exportCard"),
        import("@/lib/funnelCard"),
      ]);
      const theme = CARD_THEMES[themeForPreset(preset)];
      const esDecision = report?.mode === "decisión";
      const u = universoLinea(report);
      const coste = fmtScanCost(report?.cost ?? null);
      const dia = fmtDay(report?.at ?? new Date().toISOString());
      const pasos = cascada(report, funnel);
      // La tesis DE ESTE escaneo manda; la de la última decisión es el respaldo para informes
      // viejos (anteriores a que el observatorio guardase la suya).
      const tesis = report?.outlook?.trim() || proposal?.macro_summary?.trim();
      const tesisPropia = !!report?.outlook?.trim();
      const panelPrincipal = esDecision
        ? {
            label: "LA ROTACIÓN",
            note: u ? `${u.texto} · ${u.detalle.split(" · ")[0]}` : undefined,
            weight: tesis ? 1.15 : 1,
            body: rotationSvg(proposal?.items ?? [], pasos, theme),
          }
        : {
            // Rótulo corto a propósito: la apostilla de al lado se recorta al ancho del panel,
            // y el universo (lo que de verdad da la escala) importa más que un rótulo bonito.
            label: "EL EMBUDO",
            // Solo el primer tramo del detalle: la apostilla es contexto, no la línea entera.
            note: u ? `${u.texto} · ${u.detalle.split(" · ")[0]}` : undefined,
            weight: tesis ? 0.85 : 1,
            body: funnelCascadeSvg(pasos, theme, funnelPie(pasos, sectoresTop(funnel, 3),
              (funnel?.sin_datos ?? 0) + (funnel?.prescore_error ?? 0))),
          };
      await downloadChartCard({
        preset,
        title: esDecision ? "La rotación de la cartera" : "El embudo del escaneo",
        subtitle: "Agentic Trader · ranker fundamental sistemático",
        badges: [
          { text: `${esDecision ? "decisión mensual" : "observatorio semanal"} · ${dia}` },
          ...(macro ? [{ text: `${macro.regime}${macro.vix != null ? ` · VIX ${macro.vix}` : ""}`,
                         tone: macro.regime === "risk-off" ? ("amber" as const) : ("green" as const) }] : []),
          ...(coste ? [{ text: coste.split(" · ")[0] + " de coste" }] : []),
        ],
        panels: [
          panelPrincipal,
          // Los números solos no concluyen nada: la tesis es el marco que los interpreta, y va
          // ÍNTEGRA y con su autoría — es del sistema, no mía.
          ...(tesis
            ? [{ label: "SU TESIS MACRO",
                 // Si la tesis no es de este escaneo, la tarjeta lo dice: emparejar la decisión
                 // con un contexto de hace semanas sin avisar sería mentir.
                 note: tesisPropia
                   ? "íntegra, escrita por el propio sistema en este escaneo"
                   : `íntegra, de la decisión del ${fmtDay(proposal?.created_at ?? null)}`,
                 weight: esDecision ? 0.85 : 1.15, body: quoteSvg(tesis, theme) }]
            : []),
        ],
        footer: esDecision
          ? "No constituye recomendación de inversión · pesos objetivo, no ejecutados · operaciones simuladas, sin dinero real"
          : "No constituye recomendación de inversión · agregados por etapa y sector, sin nombres · operaciones simuladas, sin dinero real",
        filename: `agentic-trader-${esDecision ? "rotacion" : "embudo"}-${(report?.at ?? new Date().toISOString()).slice(0, 10)}`,
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
    // Solo DECISIONES reales: la cartera de un observatorio es la construcción hipotética de
    // ese martes, y venderla como "¿eligió bien?" en la tarjeta insignia sería mentir.
    const c = outcomes.find((s) => s.mode === "decisión" && s.groups.cartera.n > 0 && s.days >= 5);
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

  // Carga completa (primer montaje o volver a la pestaña tras un rato fuera): nada de la sala
  // se pinta hasta que todo llegue a la vez, mismo criterio que Sala Real.
  // Primera carga: nada montado todavía, un `return` completo no pierde ningún estado.
  if (loading && !hasLoadedOnce.current) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[#131313] text-sm text-[#6E6E6B]"
           style={{ fontFamily: SOMBRA_SANS }}>
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#383838] border-t-[#4FA39D]" />
        <p>Cargando Beta…</p>
      </div>
    );
  }

  return (
    <div className="sombra-room min-h-[100dvh] bg-[#131313] text-white" style={{ fontFamily: SOMBRA_SANS }}>
      {/* Cifras alineadas en mono, como Alpha y X (ver real/tokens.ts) -- una regla que alcanza
          a los `tabular-nums` ya repartidos por la sala en vez de tocar cada className. */}
      <style>{`.sombra-room .tabular-nums { font-family: ${SOMBRA_MONO}; }`}</style>
      {/* Recarga tras volver de una ausencia: velo ENCIMA, no un `return` que sustituya la sala
          — ningún filtro/panel/scroll se pierde por debajo. Bloquea clics de verdad (z-50). */}
      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#131313]/95 text-sm text-[#6E6E6B]">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#383838] border-t-[#4FA39D]" />
          <p>Actualizando…</p>
        </div>
      )}
      {/* ---------- barra fina: solo lo que hace falta alcanzar sin subir scroll en una sala
          larga (volver, saltar a Alpha). El estilo grande vive debajo, sin sticky. ---------- */}
      <div className="sticky top-0 z-40 border-b backdrop-blur"
           style={{ borderColor: "rgba(255,255,255,0.10)", background: "rgba(13,13,13,0.92)" }}>
        <div className="mx-auto flex h-11 max-w-[1500px] items-center justify-between gap-3 px-4 lg:px-6">
          <Link href="/" className="text-[12px] font-semibold text-[#6E6E6B] transition-colors hover:underline">
            ← Portada
          </Link>
          <div className="flex items-center gap-2.5">
            <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${error ? "bg-[#E0776C]" : "bg-[#6BBE8A]"}`} />
            <AlphaDoor />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1500px] px-4 py-6 lg:px-6">

        {/* ---------- cabecera: eyebrow + título + descripción, como Alpha y el resto de la
            casa (ver /mockup). ---------- */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4FA39D]">
              <span className={`h-1.5 w-1.5 rounded-full ${error ? "bg-[#E0776C]" : "bg-[#6BBE8A]"}`} />
              Beta
            </p>
            <h1 className="mt-1 text-[26px] font-bold text-white">Ranker fundamental sistemático</h1>
            <p className="mt-2 max-w-[46ch] text-[14px] text-[#A3A3A0]">
              Réplica pública de Alpha, en papel — mismo motor, sin dinero real.
            </p>
          </div>
          {macro && (
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${MACRO_STYLE[macro.regime] ?? MACRO_STYLE.desconocido}`}>
              {macro.regime}{macro.vix != null && ` · VIX ${macro.vix}`}
            </span>
          )}
        </header>

        {error && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E0776C]/40 bg-[#E0776C]/10 px-4 py-3 text-sm text-[#E0776C]">
            <span className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {error}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => { setLoading(true); refresh(); }} className="rounded-lg bg-[#E0776C] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#c05f55]">Reintentar</button>
              <button onClick={() => setError(null)} className="text-[#E0776C] hover:text-[#e89890]" aria-label="Cerrar">✕</button>
            </div>
          </div>
        )}
        {/* KPI strip (línea operativa; el veredicto de abajo es quien cuenta la historia).
            "Régimen" ya no es su propio tile: es EXACTAMENTE el mismo dato que el badge de la
            cabecera (macro.regime + VIX) -- repetirlo aquí abajo, dos veces en pantalla, era la
            "cabecera de risa" del feedback 9-sep-2026. */}
        <section className={`mb-6 grid grid-cols-2 gap-x-6 gap-y-6 p-5 sm:grid-cols-3 lg:grid-cols-5 ${CARD}`}>
          <Kpi label="Patrimonio" value={`$${money(equity)}`} accent />
          <Kpi label="Caja" value={`$${money(ledger?.cash ?? 0)}`} />
          <Kpi label="Invertido" value={`$${money(ledger?.positions_value ?? 0)}`} />
          <Kpi label="P&L abierto" value={`$${money(ledger?.unrealized_pnl ?? 0)}`}
               tone={Number(ledger?.unrealized_pnl ?? 0) >= 0 ? "pos" : "neg"}
               sub={`realizado $${money(ledger?.realized_pnl ?? 0)}`} />
          {/* El titular es LO QUE LLEVA LA CARTERA; el índice y el alpha son el contexto y
              van en la línea pequeña — la comparación nunca por delante del resultado. */}
          <Kpi label="Rentabilidad"
               value={perf ? `${sign(perf.portfolio_return_pct)}${perf.portfolio_return_pct}%` : "—"}
               sub={perf?.spy_return_pct != null
                 ? `S&P ${sign(perf.spy_return_pct)}${perf.spy_return_pct}%${perf.alpha_pct != null
                     ? ` · alpha ${sign(perf.alpha_pct)}${perf.alpha_pct}%` : ""}`
                 : "sin cartera"}
               tone={perf ? (perf.portfolio_return_pct >= 0 ? "pos" : "neg") : undefined} />
        </section>

        {/* 1 · ¿Bate al mercado? — veredicto + curva, una sola vez */}
        {(perf?.spy_return_pct != null || hist.length >= 2) && (
          <section className={`mb-6 ${CARD}`}>
            <div className="p-5">
              <p className="text-[16px] font-bold text-white">
                ¿Bate al mercado?{" "}
                {perf?.since && <span className="text-[13px] font-normal text-[#6E6E6B]">desde el {fmtDay(perf.since)}</span>}
              </p>
              {perf?.spy_return_pct != null && (
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-7 gap-y-1 tabular-nums">
                  <span>
                    <span className={`text-3xl font-bold tracking-tight ${perf.portfolio_return_pct >= 0 ? "text-[#6BBE8A]" : "text-[#E0776C]"}`}>
                      {sign(perf.portfolio_return_pct)}{perf.portfolio_return_pct}%
                    </span>
                    <span className="ml-1.5 text-xs text-[#6E6E6B]">cartera</span>
                  </span>
                  {/* Un escalón claro por debajo de la cartera: la referencia acompaña, no
                      compite — mismo criterio que en la landing y en los KPI. */}
                  <span>
                    <span className="text-sm font-semibold text-[#6E6E6B]">{sign(perf.spy_return_pct)}{perf.spy_return_pct}%</span>
                    <span className="ml-1.5 text-xs text-[#6E6E6B]">S&amp;P 500</span>
                  </span>
                  {perf.alpha_pct != null && (
                    <span>
                      <span className={`text-sm font-semibold ${perf.alpha_pct >= 0 ? "text-[#6BBE8A]" : "text-[#E0776C]"}`}>
                        {sign(perf.alpha_pct)}{perf.alpha_pct}%
                      </span>
                      <span className="ml-1.5 text-xs text-[#6E6E6B]">alpha</span>
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
              <span className="ml-2 font-normal normal-case tracking-normal text-[#6E6E6B]">
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
                    <tr className="text-left text-[10px] uppercase tracking-wider text-[#6E6E6B]">
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
              <p className="border-t border-[#303030] px-4 py-2 text-[11px] tabular-nums text-[#6E6E6B]">
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
            <Details defaultOpen head={<>
                El embudo del último escaneo
                {report?.at && (
                  <span className="ml-2 font-normal normal-case tracking-normal text-[#6E6E6B]">
                    {fmtTime(report.at)}
                  </span>
                )}
              </>}>
              <div className="p-4 text-xs leading-relaxed text-[#A3A3A0]">
                <FunnelCascade report={report} scan={funnel} />
                <p className="mt-2 border-t border-[#303030] pt-2 text-[11px] text-[#6E6E6B]">
                  cada martes se estudia el mercado entero; la cartera solo se decide una vez al mes
                </p>
                <ExportButtons onExport={exportarEmbudo} msg={exportEmbudoMsg} />
              </div>
            </Details>
            <section className={`${CARD} flex flex-col items-center justify-center gap-3 border-dashed p-10 text-center`}>
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-[#565654]" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="max-w-xs text-sm text-[#6E6E6B]">
                Qué nombres elige — decisión mensual y ranking — es acceso privado
              </p>
            </section>
          </div>
          <OutcomesRead scans={outcomes} book={outBook}
                        onExportGrupos={exportarOutcomesGrupos} msgGrupos={exportGruposMsg}
                        onExportScore={exportarOutcomesScore} msgScore={exportScoreMsg} />
          </>
        ) : (
          <>
            {/* 3 · Decisión mensual + 4 · Observatorio semanal */}
            <div className="mb-6 grid gap-6 md:grid-cols-2">
              <Details defaultOpen head={<>
                  Decisión{proposal?.created_at ? ` del ${fmtDay(proposal.created_at)}` : ""}
                  <span className="ml-2 font-normal normal-case tracking-normal text-[#6E6E6B]">
                    próxima: {nextDecisionLabel()}
                  </span>
                </>}>
                <div className="p-4 text-xs leading-relaxed text-[#A3A3A0]">
                  {trades.length === 0 ? (
                    <p className="text-[#6E6E6B]">
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
                            <span className={done ? "text-[#6BBE8A]" : "text-[#565654]"}>{done ? "✓" : "○"}</span>{" "}
                            {ACTION_LABEL[it.action]} <b className="font-semibold text-white">{it.ticker}</b>
                            {it.target_weight_pct ? ` · ${it.target_weight_pct}%` : ""}
                            {it.score != null && <span className="text-[#6E6E6B]"> · score {fmtScore(it.score)}</span>}
                          </p>
                        );
                      })}
                    </div>
                  )}
                  {proposal != null && (
                    <p className="mt-2 tabular-nums text-[#6E6E6B]">objetivo en caja {proposal.cash_target_pct}%</p>
                  )}
                  {(proposal?.omitted ?? []).length > 0 && (
                    // Los que se quedaron fuera del top-10. Fondear 5 de 10 obliga a descartar
                    // 5, así que el interés no es el "no" sino el motivo escrito.
                    <details className="mt-2 border-t border-[#303030] pt-2">
                      <summary className="cursor-pointer list-none text-[11px] text-[#6E6E6B] hover:text-[#A3A3A0]">
                        se quedaron fuera {proposal?.omitted?.length} de los seleccionados ▾
                      </summary>
                      <div className="mt-1.5 space-y-1">
                        {(proposal?.omitted ?? []).map((o) => (
                          <p key={o.ticker} className="text-[11.5px] leading-relaxed text-[#6E6E6B]">
                            <b className="font-semibold text-[#A3A3A0]">{o.ticker}</b>
                            {o.reason ? ` — ${o.reason}` : ""}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                  {proposal?.macro_summary && (
                    <div className="mt-2 border-t border-[#303030] pt-2 text-[11.5px] italic leading-relaxed text-[#6E6E6B]">
                      “{richText(proposal.macro_summary)}”
                    </div>
                  )}
                </div>
              </Details>

              <Details defaultOpen head={<>
                  Observatorio semanal
                  {report?.at && (
                    <span className="ml-2 font-normal normal-case tracking-normal text-[#6E6E6B]">
                      {fmtTime(report.at)}
                    </span>
                  )}
                </>}>
                <div className="p-4 text-xs leading-relaxed text-[#A3A3A0]">
                  <FunnelCascade report={report} scan={funnel} />
                  {scores.length > 0 && (
                    <p className="mt-2.5">
                      top del ranking:{" "}
                      {scores.slice(0, 3).map((s, i) => (
                        <span key={s.ticker}>
                          {i > 0 && " · "}
                          <b className="font-semibold text-white">{s.ticker} {fmtScore(s.score)}</b>
                        </span>
                      ))}
                    </p>
                  )}
                  {/* Vista PRIVADA a propósito: el ranking completo con tickers no lleva botón
                      de exportar — publicarlo sería un feed de señales, no "así funciona". */}
                  {!!funnel?.nombres?.length && (
                    <button
                      onClick={() => setRankingOpen(true)}
                      className="mt-1.5 text-[11px] font-medium text-[#6E6E6B] underline decoration-[#303030] underline-offset-2 transition hover:text-[#A3A3A0]"
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
                          className="inline-flex items-center gap-1 rounded-md bg-[#232323] px-2 py-0.5 text-[11px] font-medium text-[#A3A3A0] ring-1 ring-inset ring-white/10 transition hover:bg-[#1C1C1C] hover:ring-white/15"
                        >
                          {w.ticker}<span className="tabular-nums text-[#6E6E6B]">{fmtScore(w.score)}</span>
                        </button>
                      ))}
                      {watchTop.length > 10 && (
                        <span className="text-[11px] text-[#6E6E6B]">+{watchTop.length - 10} en seguimiento</span>
                      )}
                    </div>
                  )}
                  {report?.outlook && (
                    // La tesis macro DE ESTE escaneo: se paga una llamada al modelo grande por
                    // ella y solo se veía al exportar la tarjeta. Plegada y etiquetada como
                    // lectura semanal — la que justificó la cartera vive en la tarjeta de la
                    // decisión, y confundirlas sería mezclar dos fechas distintas.
                    <details className="mt-2 border-t border-[#303030] pt-2">
                      <summary className="cursor-pointer list-none text-[11px] text-[#6E6E6B] hover:text-[#A3A3A0]">
                        su lectura macro de esta semana ▾
                      </summary>
                      <div className="mt-1.5 text-[11.5px] italic leading-relaxed text-[#6E6E6B]">
                        “{richText(report.outlook)}”
                      </div>
                    </details>
                  )}
                  <p className="mt-2 border-t border-[#303030] pt-2 text-[11px] text-[#6E6E6B]">
                    la cartera no se toca hasta la decisión mensual (o un análisis manual)
                  </p>
                  <ExportButtons onExport={exportarEmbudo} msg={exportEmbudoMsg} />
                </div>
              </Details>
            </div>

            {/* 4b · La traza leída: compradas vs descartadas vs índice, por cohorte */}
            <OutcomesRead scans={outcomes} book={outBook}
                          onExportGrupos={exportarOutcomesGrupos} msgGrupos={exportGruposMsg}
                          onExportScore={exportarOutcomesScore} msgScore={exportScoreMsg} />

            {/* 5 · Ranking a fondo — sección propia, con buscador y filtro por sector */}
            <div className="mb-6">
            <Details head={<>
                  Ranking a fondo
                  {/* El ranking visible es el de la DECISIÓN (el semanal ya no lo pisa, solo
                      refresca coincidencias): sin esta etiqueta parecería la foto del último
                      escaneo, que es justo lo que dejó de ser. */}
                  <span className="ml-2 text-[13px] font-normal tracking-normal text-[#6E6E6B]">
                    {proposal?.created_at ? `decisión del ${fmtDay(proposal.created_at)}` : ""}
                    {report?.mode === "observatorio" && (report?.refreshed ?? 0) > 0
                      ? ` · ${report?.refreshed} refrescados el ${fmtDay(report?.at ?? null)}`
                      : ""}
                    {" · "}
                    {funnel?.deep ?? report?.deep ?? scores.length} analizados a fondo
                    {(funnel?.pre ?? report?.prescored)
                      ? ` · ${fmtNum(funnel?.pre ?? report?.prescored ?? 0)} pre-cribados`
                      : ""}
                  </span>
                </>}>
              <div className="p-4 pt-0">
              {scores.length === 0 ? (
                <Empty running={running} />
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input
                      value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ticker o tesis…"
                      aria-label="Buscar ticker o tesis"
                      className="h-8 w-44 rounded-lg border border-[#303030] bg-[#1C1C1C] px-2.5 text-xs text-[#A3A3A0] outline-none placeholder:text-[#565654] focus:ring-2 focus:ring-[#6BBE8A]/30"
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
                    <p className="rounded-xl border border-dashed border-[#303030] bg-[#232323]/60 py-8 text-center text-sm text-[#6E6E6B]">
                      Nada coincide con ese filtro.
                    </p>
                  ) : (
                    <div className="divide-y divide-[#303030]">
                      {scoresView.map((s) => <ScoreRowItem key={s.id} row={s} />)}
                    </div>
                  )}
                </>
              )}
              </div>
            </Details>
            </div>
          </>
        )}

        <footer className="mt-10 border-t border-[#303030] pt-4 text-center text-[11px] text-[#6E6E6B]">
          No constituye recomendación de inversión · sala sombra · operaciones simuladas, sin dinero real · metodología tipo whitepaper DeepSeek
        </footer>

        {/* Overlay del ranking semanal: vista PRIVADA, sin export — un ranking con tickers
            publicado sería un feed de señales, justo lo que separa "así funciona" de "qué comprar". */}
        {rankingOpen && !!funnel?.nombres?.length && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
            onClick={() => setRankingOpen(false)}
          >
            <div
              className={`w-full max-w-lg ${CARD} max-h-[80vh] overflow-y-auto`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-[#303030] bg-[#1C1C1C]/95 px-4 py-2.5 backdrop-blur">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#6E6E6B]">
                  Ranking de este observatorio
                </h2>
                <button
                  onClick={() => setRankingOpen(false)}
                  aria-label="Cerrar"
                  className="text-[#6E6E6B] hover:text-[#A3A3A0]"
                >
                  ✕
                </button>
              </div>
              <div className="p-4 text-xs leading-relaxed text-[#A3A3A0]">
                {report?.outlook && (
                  <div className="mb-3 border-b border-[#303030] pb-3 italic text-[#6E6E6B]">
                    “{richText(report.outlook)}”
                  </div>
                )}
                <div className="divide-y divide-[#303030]">
                  {/* Orden de lectura, no de llegada: primero hasta dónde llegó cada nombre
                      (cartera → seleccionado → finalista → profundo fallido → prescore) y,
                      dentro de cada tramo, su score de mayor a menor. */}
                  {[...funnel.nombres]
                    .sort((a, b) =>
                      (STAGE_ORDEN[a.stage] ?? 9) - (STAGE_ORDEN[b.stage] ?? 9)
                      || (b.deep_score ?? -1) - (a.deep_score ?? -1)
                      || (b.prescore ?? -1) - (a.prescore ?? -1))
                    .map((n) => (
                    <div key={n.ticker} className="flex items-center gap-3 py-1.5 tabular-nums">
                      <span className="w-16 shrink-0 font-semibold text-white">{n.ticker}</span>
                      <span className="flex-1 truncate text-[#6E6E6B]">{n.sector}</span>
                      <span className="w-10 shrink-0 text-right font-semibold text-[#A3A3A0]">
                        {fmtScore(n.deep_score ?? n.prescore)}
                      </span>
                      <span className="w-24 shrink-0 text-right text-[10px] uppercase tracking-wide text-[#6E6E6B]">
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
      <p className="text-[#6E6E6B]">
        Cada martes el agente estudia el mercado entero para aprender. Aún no hay traza del
        último escaneo.
      </p>
    );
  }
  return (
    <>
      {universo && (
        <p className={universo.tone === "ok" ? "text-[#6E6E6B]" : "font-medium text-[#fab219]"}>
          universo <b className="tabular-nums font-semibold text-white">{universo.texto}</b>
          <span className="text-[#6E6E6B]"> · {universo.detalle}</span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {pasos.map((p, i) => (
          <div key={p.label} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[#565654]" aria-hidden>→</span>}
            <div className="rounded-lg bg-[#232323] px-2.5 py-1.5 ring-1 ring-inset ring-white/10"
                 title={p.hint}>
              <p className="text-[15px] font-semibold leading-none tabular-nums text-white">
                {fmtNum(p.value)}
              </p>
              <p className="mt-0.5 text-[10.5px] leading-none text-[#6E6E6B]">
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
        <p className="mt-2 text-[11px] text-[#6E6E6B]">
          a fondo por sector:{" "}
          {sectores.map((s, i) => (
            <span key={s.sector} className="tabular-nums">
              {i > 0 && " · "}{s.sector} <b className="font-semibold text-[#A3A3A0]">{s.deep}</b>
              <span className="text-[#6E6E6B]">/{fmtNum(s.pre)}</span>
            </span>
          ))}
        </p>
      )}
      {coste && <p className="mt-1 text-[11px] tabular-nums text-[#6E6E6B]">coste del escaneo {coste}</p>}
      {(report?.issues ?? []).length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-[#fab219]">
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
  if (!s.n || s.avg == null) return <span className="text-[#565654]">—</span>;
  return (
    <>
      <span className={s.avg >= 0 ? "font-semibold text-[#6BBE8A]" : "font-semibold text-[#E0776C]"}>
        {sign(s.avg)}{s.avg.toFixed(1)}%
      </span>
      <span className="text-[#6E6E6B]"> ({s.n})</span>
    </>
  );
}

/** Una cohorte de la traza como fila de la tabla. En los observatorios, "en cartera" es la
 *  construcción HIPOTÉTICA de ese martes (nada se compró); el pie de la tabla lo aclara. */
function OutRow({ s, pct }: { s: OutcomeScan; pct: (v: number | null) => string }) {
  return (
    <tr className="border-t border-[#303030]">
      <td className="py-1.5 pr-3">
        del {fmtDay(s.at)} a hoy
        <span className="text-[#6E6E6B]"> · {s.days} d · {s.mode}</span>
      </td>
      <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.cartera} /></td>
      <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.seleccionados} /></td>
      <td className="px-3 py-1.5 text-right"><OutPct s={s.groups.descartados} /></td>
      <td className="px-3 py-1.5 text-right">
        {s.groups.spy == null ? "—" : `${sign(s.groups.spy)}${s.groups.spy.toFixed(1)}%`}
      </td>
      <td className="px-3 py-1.5 text-right text-[#6E6E6B]">
        {s.corte.fuera.n ? `${pct(s.corte.fuera.avg)} / ${pct(s.corte.dentro.avg)}` : "—"}
      </td>
    </tr>
  );
}

/** La traza LEÍDA: qué hizo después cada grupo de cada cohorte. Son agregados puros —
 *  visibles también sin sesión, como el embudo: comportamiento sí, nombres no. Cada fila es
 *  un escaneo; el retorno va desde el precio del día del escaneo hasta hoy, a igual peso.
 *  Dos tarjetas, dos preguntas: "¿eligió bien?" (barras por grupo) y "¿el score predice?"
 *  (la nube score↔retorno) — cada una con su propio guard de "aún sin historial suficiente". */
function OutcomesRead({ scans, book, onExportGrupos, msgGrupos, onExportScore, msgScore }: {
  scans: OutcomeScan[]; book: OutcomeBook | null;
  onExportGrupos: (p: "x" | "linkedin") => void; msgGrupos: string;
  onExportScore: (p: "x" | "linkedin") => void; msgScore: string;
}) {
  // Por defecto solo DECISIONES (mezclar filas semanales y mensuales invita a compararlas
  // entre sí, y el semanal analiza otra franja); los observatorios quedan tras un toggle —
  // siguen alimentando "¿el score predice?", tirarlos del todo sería desperdiciar señal.
  const [verObs, setVerObs] = useState(false);
  if (!scans.length && !book) return null;
  const pct = (v: number | null) => (v == null ? "—" : `${sign(v)}${v.toFixed(1)}%`);
  const decisiones = scans.filter((s) => s.mode === "decisión");
  const observatorios = scans.filter((s) => s.mode !== "decisión");
  const mostrarObs = verObs || (!book && decisiones.length === 0);
  const masVieja = scans.length ? Math.max(...scans.map((s) => s.days)) : 0;
  const diasLibro = book?.since
    ? Math.max(0, Math.floor((Date.now() - new Date(book.since).getTime()) / 86_400_000))
    : null;
  return (
    <div className="mb-6">
    <Details head={<>
        La auditoría, leída
        {/* La referencia de cada % tiene que estar EN la cabecera, no en la letra pequeña:
            sin "de su escaneo a hoy" la tabla eran números sin origen ni ventana. */}
        <span className="ml-2 text-[13px] font-normal normal-case tracking-normal text-[#6E6E6B]">
          cuánto ha subido o bajado cada grupo de nombres desde su escaneo hasta hoy
        </span>
      </>}>
      <div className="p-4 text-xs leading-relaxed text-[#A3A3A0]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse whitespace-nowrap tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-[#6E6E6B]">
                <th className="py-1.5 pr-3 font-semibold">Escaneo → hoy</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="media del grupo desde el precio del día del escaneo; entre paréntesis, cuántos nombres">En cartera</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="los del top-10 que el constructor dejó sin peso">Elegidos s/fondear</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="analizados a fondo y no seleccionados">Descartados</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="el índice en la misma ventana: la vara de medir">S&P 500</th>
                <th className="px-3 py-1.5 text-right font-semibold" title="los 10 mejores pre-scores que no llegaron al profundo vs los 10 peores que sí entraron">
                  Corte: fuera / dentro
                </th>
              </tr>
            </thead>
            <tbody>
              {/* LO REAL primero: el libro vigente desde su compra (ledger, a valor de
                  mercado). La traza no alcanza a la decisión que lo compró, así que esta
                  fila es la única imagen real hasta que las cohortes nuevas maduren. */}
              {book && (
                <tr className="border-t border-[#303030]"
                    title="libro real a valor de mercado — anterior al inicio de la traza; el resto de columnas no puede reconstruirse">
                  <td className="py-1.5 pr-3">
                    cartera vigente{book.since ? ` · desde el ${fmtDay(book.since)}` : ""}
                    {diasLibro != null && <span className="text-[#6E6E6B]"> · {diasLibro} d</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {book.ret == null ? "—" : (
                      <>
                        <span className={book.ret >= 0 ? "font-semibold text-[#6BBE8A]" : "font-semibold text-[#E0776C]"}>
                          {sign(book.ret)}{book.ret.toFixed(1)}%
                        </span>
                        <span className="text-[#6E6E6B]"> ({book.n})</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                  <td className="px-3 py-1.5 text-right">
                    {book.spy == null ? "—" : `${sign(book.spy)}${book.spy.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#565654]">—</td>
                </tr>
              )}
              {decisiones.map((s) => <OutRow key={s.at} s={s} pct={pct} />)}
              {observatorios.length > 0 && (
                <tr className="border-t border-[#303030]">
                  <td colSpan={6} className="py-1.5">
                    <button onClick={() => setVerObs(!verObs)}
                            className="text-[11px] text-[#6E6E6B] hover:text-[#A3A3A0]">
                      {mostrarObs ? "▴ ocultar" : "▾ ver"} observatorios ({observatorios.length})
                      {mostrarObs ? "" : " — su «en cartera» es hipotético"}
                    </button>
                  </td>
                </tr>
              )}
              {mostrarObs && observatorios.map((s) => <OutRow key={s.at} s={s} pct={pct} />)}
            </tbody>
          </table>
        </div>
        <p className="mt-2 border-t border-[#303030] pt-2 text-[11px] text-[#6E6E6B]">
          retorno simple desde el precio del día del escaneo, a igual peso dentro de cada grupo ·
          un profundo ilegible no cuenta como descarte
          {observatorios.length > 0 &&
            " · en los observatorios, «en cartera» es la construcción hipotética de ese martes, no el libro"}
          {masVieja > 0 && masVieja < 14 &&
            ` · la cohorte más vieja tiene ${masVieja} día${masVieja === 1 ? "" : "s"}: aún es ruido, la lectura seria llega con semanas`}
        </p>
        <ExportButtons onExport={onExportGrupos} msg={msgGrupos} label="¿Eligió bien?" />
        <ExportButtons onExport={onExportScore} msg={msgScore} label="¿El score predice?" />
      </div>
    </Details>
    </div>
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
      {msg && <span className="mr-auto text-[11px] text-[#6E6E6B]">{msg}</span>}
      <span className="text-[11px] text-[#6E6E6B]">{label ? `${label} · exportar tarjeta` : "Exportar tarjeta"}</span>
      {([["x", "X", "16:9 · 1600×900"], ["linkedin", "LinkedIn", "1,91:1 · 1200×627"]] as const)
        .map(([key, netLabel, ratio]) => (
          <button
            key={key} onClick={() => onExport(key)}
            title={`PNG ${ratio}, con cabecera, cifras y descargo legal dentro de la imagen`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#303030] px-2.5 py-1 text-[11px] font-medium text-[#6E6E6B] transition hover:bg-[#232323] hover:text-[#A3A3A0]"
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
    <div className="border-b border-[#303030] px-4 py-3.5 text-[16px] font-bold text-white">
      {children}
    </div>
  );
}

// Card-acordeón del mockup (`details.card`): para módulos de consulta, no de lo que se lee
// siempre (eso sigue en `CardHead`, sección siempre abierta — "La cartera" en el mockup tampoco
// es acordeón). `head` es el mismo children mixto (texto + <span> de meta) que ya usaba CardHead.
function Details({ head, defaultOpen, children }: {
  head: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const toggle = () => setOpen((o) => !o);
  return (
    <section className={CARD}>
      <div className="flex w-full items-center gap-2.5 py-3.5 pl-4 pr-2.5">
        <button onClick={toggle} aria-expanded={open} className="flex-1 text-left text-[16px] font-bold text-white">
          {head}
        </button>
        <button onClick={toggle} aria-expanded={open} aria-label={open ? "Colapsar" : "Desplegar"}
                className="flex shrink-0 items-center rounded p-1.5 text-[#6E6E6B] transition-colors hover:bg-white/5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               className="shrink-0 transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }}>
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>
      {open && <div className="border-t border-[#303030]">{children}</div>}
    </section>
  );
}

function SectorChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition ${
        active ? "bg-[#4FA39D] text-white ring-[#4FA39D]" : "bg-[#1C1C1C] text-[#6E6E6B] ring-white/10 hover:ring-white/15"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ running }: { running: boolean }) {
  return (
    <div className="m-4 flex min-h-[22vh] flex-col items-center justify-center rounded-xl border border-dashed border-[#303030] bg-[#232323]/60 text-center">
      <p className="text-3xl">{running ? "🛰️" : "📡"}</p>
      <p className="mt-3 max-w-sm text-sm text-[#6E6E6B]">
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
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6E6B]">{label}</p>
      <p className={`mt-1.5 text-[22px] font-bold tabular-nums tracking-tight ${
        accent ? "text-white" : tone === "pos" ? "text-[#6BBE8A]" : tone === "neg" ? "text-[#E0776C]" : "text-white"
      }`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-[#6E6E6B]">{sub}</p>}
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
        className={`border-t border-[#303030] ${clickable ? "cursor-pointer transition-colors hover:bg-[#232323] focus-visible:bg-[#232323] focus-visible:outline-none" : ""}`}
      >
        <td className="py-2 pr-3">
          <span className={`mr-2 inline-block h-2 w-2 rounded-sm align-middle ${color}`} />
          <b className="font-semibold text-white">{label}</b>
          {sector && <span className="ml-2 text-[10px] text-[#6E6E6B]">{sector}</span>}
        </td>
        {!anon && <td className="px-3 py-2 text-right">{weightPct != null ? `${weightPct.toFixed(1)}%` : "—"}</td>}
        {!anon && <td className="px-3 py-2 text-right text-[#6E6E6B]">{pos.avg_cost ? `$${money(pos.avg_cost)}` : "—"}</td>}
        {!anon && <td className="px-3 py-2 text-right">{pos.price ? `$${money(pos.price)}` : "—"}</td>}
        {!anon && <td className="px-3 py-2 text-right text-white">{pos.value ? `$${money(pos.value)}` : "—"}</td>}
        <td className="px-3 py-2 text-right">
          <span className={`text-[11px] ${up >= 0 ? "text-[#6BBE8A]/80" : "text-[#E0776C]/80"}`}>
            {up >= 0 ? "+" : "−"}${money(Math.abs(up))}
          </span>{" "}
          <span className={`font-semibold ${pct >= 0 ? "text-[#6BBE8A]" : "text-[#E0776C]"}`}>
            {pct > 0 ? "+" : ""}{pct}%
          </span>
        </td>
        <td className="py-2 text-right text-[#565654]">
          {clickable && (
            <svg viewBox="0 0 24 24" className={`inline h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-[#303030] bg-[#232323]/50">
          {/* whitespace-normal: la tabla es nowrap (columnas numéricas), pero la tesis debe
              ENVOLVER — si no, una línea larga estira la tabla y fuerza scroll horizontal. */}
          <td colSpan={7} className="whitespace-normal px-3 py-2 text-[11.5px] leading-relaxed text-[#6E6E6B]">
            {srow?.headline
              ? <><span className="font-semibold text-[#A3A3A0]">Tesis</span> · {richText(srow.headline)}
                  <span className="ml-1 text-[#6E6E6B]">
                    · score {fmtScore(srow.score)}{srow.target_price != null ? ` · objetivo $${money(srow.target_price)}` : ""}
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
        <span className="w-16 shrink-0 font-semibold tracking-tight text-white">{row.ticker}</span>
        <span className="hidden w-36 shrink-0 truncate text-[11px] text-[#6E6E6B] sm:block">{row.sector}</span>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#1C1C1C]">
          <span className={`absolute inset-y-0 left-0 rounded-full ${scoreColor(row.score)}`} style={{ width: `${row.score}%` }} />
        </span>
        {/* w-14: la nota lleva dos decimales, "78.43" no cabe en 3rem. */}
        <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-[#A3A3A0]">{fmtScore(row.score)}</span>
        {row.held ? (
          <span className="shrink-0 rounded bg-[#6BBE8A]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#6BBE8A] ring-1 ring-inset ring-[#6BBE8A]/30">EN CARTERA</span>
        ) : row.on_watchlist ? (
          <span className="shrink-0 rounded bg-[#232323] px-1.5 py-0.5 text-[9px] font-bold text-[#6E6E6B] ring-1 ring-inset ring-white/15">SEGUIM.</span>
        ) : (
          <span className="hidden w-[62px] shrink-0 sm:block" />
        )}
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#565654] transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      {(row.price != null || row.target_price != null) && (
        <p className="mt-2 pl-16 text-xs tabular-nums text-[#6E6E6B]">
          {row.price != null ? `$${money(row.price)}` : "—"}
          {row.target_price != null && <> → objetivo ${money(row.target_price)}</>}
          {row.price != null && row.target_price != null && (
            <span className={`ml-1 font-semibold ${row.target_price >= row.price ? "text-[#6BBE8A]" : "text-[#E0776C]"}`}>
              ({row.target_price >= row.price ? "+" : ""}{(((row.target_price / row.price) - 1) * 100).toFixed(1)}%)
            </span>
          )}
        </p>
      )}
      {row.headline && <p className="mt-2 pl-16 text-sm text-[#A3A3A0]">{richText(row.headline)}</p>}
      {row.report && <p className="mt-2 whitespace-pre-line pl-16 text-xs leading-relaxed text-[#6E6E6B]">{richText(row.report)}</p>}
    </details>
  );
}
