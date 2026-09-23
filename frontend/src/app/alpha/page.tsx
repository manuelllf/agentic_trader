"use client";

/** Real room: control panel for live account. Agent proposes; you approve/reject orders.
 *  Hierarchy: header (title, scan status, analyze button) → decisions → live book. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  approveTrade, fetchAnalyticsConfianzaPrescore, fetchAnalyticsCosteEtapa,
  fetchAnalyticsScans,
  getApprovals, getConfig, getDemoStatus, getFx, getHistory,
  getPerformance, getPersonal, getPushKey, getReal, getScanFunnel, getScanReport, logout,
  reconcileApprovals, rejectTrade, resetShadow,
  subscribePush,
  syncPersonal, testPush,
  type ScanReport,
} from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import HistoryChart from "@/components/HistoryChart";
import { InfoTip } from "@/components/InfoTip";
import SalaDoor from "@/components/SalaDoor";
import { fmtPct, fmtTime, money, qty4, signMoney } from "@/lib/format";
import type { FunnelScan } from "@/lib/scan";
import type {
  AppConfig, Approval, ApprovalsResponse, DemoStatus, HistoryPoint, Performance,
  PersonalSummary, RealSummary,
} from "@/lib/types";
import { useOrden } from "@/lib/useOrden";
import { AnalyticsTable, ScanNav } from "./AnalyticsPanel";
import { CapitalForm } from "./CapitalForm";
import { CentroOperaciones } from "./CentroOperaciones";
import { Distribution } from "./Distribution";
import { Explorador } from "./Explorador";
import { HistoryRow } from "./HistoryRow";
import { MemorySearch } from "./MemorySearch";
import { OrderRow } from "./OrderRow";
import { PnlBar } from "./PnlBar";
import { ScanReportPanel } from "./ScanReportPanel";
import { TickerAudit } from "./TickerAudit";
import { NUMS, SANS, SERIES, T } from "./tokens";
import { Details, Empty, Field, Kpi, Panel, SideTag, Td, Th } from "./ui";

type PendingSortKey = "ticker" | "target_weight_pct" | "est_price" | "target_price" | "upside_pct" | "score";
type PositionSortKey = "ticker" | "quantity" | "avg_cost" | "price" | "value" | "w" | "pnl";
type PersonalSortKey = "ticker" | "quantity" | "price" | "value" | "pnl";

/* ============================== página ============================== */

export default function SalaReal() {
  // El candado envuelve DESDE FUERA: si la sala montara antes del login, su primer load()
  // saldría sin token → 401 → banner "Sesión caducada" nada más entrar. Así, la sala (y sus
  // efectos de carga) solo existen cuando AuthGate ya validó la sesión.
  return (
    <AuthGate>
      <SalaRealRoom />
    </AuthGate>
  );
}

function SalaRealRoom() {
  const router = useRouter();
  const [summary, setSummary] = useState<RealSummary | null>(null);
  const [approvals, setApprovals] = useState<ApprovalsResponse | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [personal, setPersonal] = useState<PersonalSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [fx, setFx] = useState<number | null>(null);      // EURUSD indicativo (frontera €/$)
  const [capOpen, setCapOpen] = useState(false);          // formulario aportar/retirar (libro andando)
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [scanStatus, setScanStatus] = useState<DemoStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [shadowPerf, setShadowPerf] = useState<Performance | null>(null);   // sombra en paralelo
  const [hist, setHist] = useState<HistoryPoint[]>([]);   // curva del libro real (cierres diarios)
  const [report, setReport] = useState<ScanReport | null>(null);   // informe del último escaneo
  const [funnel, setFunnel] = useState<FunnelScan | null>(null);   // embudo (traza de auditoría)
  const [resetArmed, setResetArmed] = useState(false);    // armar→confirmar el reinicio del sombra
  const [resetting, setResetting] = useState(false);
  // Actividad (histórico de decisiones): colapsada por defecto, penúltima — uso ocasional.
  const [actividadOpen, setActividadOpen] = useState(false);
  // Historia de un ticker a través de los escaneos: se abre desde "Posiciones del agente".
  const [auditTicker, setAuditTicker] = useState<string | null>(null);
  // Analítica del método (DuckDB sobre Postgres): bajo demanda, cada tabla con su propio
  // estado — un 503 (DuckDB no instalado) en una no debe tragarse las otras dos.
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [costeEtapa, setCosteEtapa] = useState<{ data: Record<string, unknown>[] | null; loading: boolean; error: string }>({ data: null, loading: false, error: "" });
  const [confianzaPrescore, setConfianzaPrescore] = useState<{ data: Record<string, unknown>[] | null; loading: boolean; error: string }>({ data: null, loading: false, error: "" });
  // Navegador de escaneo compartido por coste-etapa/confianza-prescore: -1 = "Total" (agregado
  // histórico, sin scan_run_id), 0 = el más reciente, 1 = el siguiente más antiguo, etc.
  const [analyticsScans, setAnalyticsScans] = useState<{ id: number; at: string; cadence: string }[]>([]);
  const [costeScanPos, setCosteScanPos] = useState(-1);
  const [confianzaScanPos, setConfianzaScanPos] = useState(-1);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);   // guard de desmontaje (mismo patrón que la portada)
  const hiddenAt = useRef<number | null>(null);   // cuándo se fue de la pestaña, para medir la ausencia
  const hasLoadedOnce = useRef(false);   // primera carga: pantalla completa. Recargas después:
                                          // velo encima, sin desmontar nada (ver el `return`)

  // Decidir dos propuestas seguidas (cada fila es independiente, sin cerrojo entre ellas)
  // dispara dos `load()`/`loadCritical()` que pueden solaparse -- sin esto, la respuesta más
  // lenta gana aunque sea la más vieja y pisa el estado ya al día con datos de antes de la
  // segunda decisión. Un contador compartido: solo se aplica la respuesta de la llamada más
  // reciente, la que llega tarde se descarta.
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const miSeq = ++loadSeqRef.current;
    const vigente = () => alive.current && miSeq === loadSeqRef.current;
    // Lo que es para mirar se pinta al llegar: antes la sala entera esperaba a la más lenta
    // (IBKR de la cartera personal, yfinance), aunque lo que se decide ya estuviera listo.
    const pinta = <T,>(p: Promise<T>, set: (v: T) => void) =>
      p.then((v) => { if (vigente()) set(v); }).catch(() => {});
    pinta(getConfig(), setCfg);
    pinta(getPersonal(), setPersonal);
    pinta(getDemoStatus(), setScanStatus);
    pinta(getPerformance(), setShadowPerf);
    pinta(getFx(), (fxr) => { if (fxr?.rate) setFx(fxr.rate); });
    pinta(getHistory("real"), (hs) => setHist(hs.series));
    pinta(getScanReport(), (sr) => setReport(sr.report));
    pinta(getScanFunnel(1), (fn) => setFunnel(fn.scans[0] ?? null));
    try {
      // Lo único con lo que se ACTÚA (y la caja contra la que se juzga): con esto ya se enseña.
      const [s, a] = await Promise.all([getReal(), getApprovals()]);
      if (!vigente()) return;
      setSummary(s);
      setApprovals(a);
      setError("");
    } catch (e) {
      if (alive.current && miSeq === loadSeqRef.current) {
        setError(e instanceof Error ? e.message : "Sin conexión con el backend.");
      }
    } finally {
      hasLoadedOnce.current = true;
      if (alive.current) setLoading(false);
    }
  }, []);

  // Al volver de una ausencia larga, lo único con lo que se ACTÚA es la lista de aprobaciones
  // (aceptar/rechazar una orden real) — y el resumen del que sale la caja contra la que se
  // juzgan. El resto (curva, rendimiento, personal, informe del escaneo, config) es para mirar,
  // no para decidir en el momento: se queda con lo último cargado y lo pone al día el sondeo
  // normal de 60s en menos de un minuto. 2 llamadas en vez de 10 → el velo dura una fracción.
  const loadCritical = useCallback(async () => {
    const miSeq = ++loadSeqRef.current;
    try {
      const [s, a] = await Promise.all([getReal(), getApprovals()]);
      if (!alive.current || miSeq !== loadSeqRef.current) return;
      setSummary(s);
      setApprovals(a);
      setError("");
    } catch (e) {
      if (alive.current && miSeq === loadSeqRef.current) {
        setError(e instanceof Error ? e.message : "Sin conexión con el backend.");
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  async function doResetShadow() {
    setResetting(true);
    try {
      const r = await resetShadow();
      setResetArmed(false);
      setFlash(`Libro sombra reiniciado (${r.deleted.positions} posiciones, ${r.deleted.trades} `
        + `operaciones). Caja: $${r.cash_after}. Lanza un escaneo para redesplegarla.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reiniciar el libro sombra.");
    } finally {
      setResetting(false);
    }
  }

  /** Carga las 3 tablas de analítica (DuckDB sobre Postgres) bajo demanda — no se dispara
   *  sola al montar la página. Cada tabla lleva su propio estado: un 503 (DuckDB no
   *  instalado en el backend) en una no debe tapar el resultado de las otras dos. */
  async function loadAnalytics() {
    setAnalyticsLoaded(true);
    setCosteScanPos(-1);
    setConfianzaScanPos(-1);
    setCosteEtapa({ data: null, loading: true, error: "" });
    setConfianzaPrescore({ data: null, loading: true, error: "" });
    fetchAnalyticsScans()
      .then((r) => setAnalyticsScans(r.items))
      .catch(() => setAnalyticsScans([]));
    fetchAnalyticsCosteEtapa()
      .then((r) => setCosteEtapa({ data: r.items, loading: false, error: "" }))
      .catch((e) => setCosteEtapa({ data: null, loading: false, error: e instanceof Error ? e.message : "No se pudo cargar." }));
    fetchAnalyticsConfianzaPrescore()
      .then((r) => setConfianzaPrescore({ data: r.items, loading: false, error: "" }))
      .catch((e) => setConfianzaPrescore({ data: null, loading: false, error: e instanceof Error ? e.message : "No se pudo cargar." }));
  }

  /** Recarga solo coste-etapa para el escaneo en `pos` (-1 = Total, agregado histórico).
   *  Independiente de confianza-prescore aunque compartan `analyticsScans` — mover una no debe
   *  mover la otra, aunque salgan de la misma tabla `llm_call`. */
  function loadCosteForScan(pos: number) {
    setCosteScanPos(pos);
    const scanId = pos >= 0 ? analyticsScans[pos]?.id : undefined;
    setCosteEtapa((s) => ({ ...s, loading: true, error: "" }));
    fetchAnalyticsCosteEtapa(scanId)
      .then((r) => setCosteEtapa({ data: r.items, loading: false, error: "" }))
      .catch((e) => setCosteEtapa({ data: null, loading: false, error: e instanceof Error ? e.message : "No se pudo cargar." }));
  }

  /** Igual que `loadCosteForScan` pero para confianza-prescore, con su propia posición. */
  function loadConfianzaForScan(pos: number) {
    setConfianzaScanPos(pos);
    const scanId = pos >= 0 ? analyticsScans[pos]?.id : undefined;
    setConfianzaPrescore((s) => ({ ...s, loading: true, error: "" }));
    fetchAnalyticsConfianzaPrescore(scanId)
      .then((r) => setConfianzaPrescore({ data: r.items, loading: false, error: "" }))
      .catch((e) => setConfianzaPrescore({ data: null, loading: false, error: e instanceof Error ? e.message : "No se pudo cargar." }));
  }

  useEffect(() => {
    alive.current = true;
    load();
    pollRef.current = setInterval(load, 60_000);
    return () => {
      alive.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
      if (scanTimer.current) clearTimeout(scanTimer.current);
    };
  }, [load]);

  // Volver a esta pestaña tras un rato fuera: recarga lo CRÍTICO (aprobaciones + caja, ver
  // `loadCritical`) — el navegador puede pausar el sondeo de 60s mientras está oculta, así que
  // eso podría llevar minutos sin refrescar, y es lo único con lo que se actúa de verdad. Pero
  // cambiar de pestaña un segundo y volver NO merece nada — antes disparaba en CUALQUIER cambio
  // de visibilidad. El bloqueo en sí (velo, no desmontaje) vive en el `return`.
  useEffect(() => {
    const UMBRAL_MS = 3 * 60_000;
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      if (document.visibilityState !== "visible") return;
      const desde = hiddenAt.current;
      hiddenAt.current = null;
      if (desde !== null && Date.now() - desde < UMBRAL_MS) return;   // ausencia corta, no recarga
      setLoading(true);
      loadCritical();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadCritical]);

  // Escaneo bajo demanda: el agente puntúa el universo, propone la cartera real (a tu Sí/No) y
  // ejecuta sola la sombra. Se sondea el estado mientras corre, igual que hacía Beta.
  const pollScan = useCallback(async () => {
    try {
      const s = await getDemoStatus();
      setScanStatus(s);
      if (s.status === "running") { scanTimer.current = setTimeout(pollScan, 4000); return; }
      setRunning(false);
      if (s.status === "error") setError(s.error ?? "Fallo en el análisis.");
      else if (s.status === "done") setFlash("Análisis completado.");
      await load();
    } catch {
      scanTimer.current = setTimeout(pollScan, 6000);
    }
  }, [load]);

  /** La card lanza; aquí solo arranca el sondeo y el aviso. Así el estado del escaneo sigue
   *  viviendo en la página (lo mira también la cabecera) sin que la card tenga que conocerlo. */
  const onScanStarted = useCallback(() => {
    setError("");
    setRunning(true);
    setFlash("Escaneo en marcha…");
    pollScan();
  }, [pollScan]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    (async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setPushOn(false);
        const reg = await navigator.serviceWorker.ready;
        setPushOn(!!(await reg.pushManager.getSubscription()));
      } catch { setPushOn(false); }
    })();
  }, []);

  const enablePush = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setFlash("Permiso de notificaciones denegado.");
      const reg = await navigator.serviceWorker.ready;
      const { key } = await getPushKey();
      const pad = "=".repeat((4 - (key.length % 4)) % 4);
      const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) as BufferSource,
      });
      await subscribePush(sub.toJSON());
      setPushOn(true);
      setFlash("Alertas activadas en este dispositivo.");
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "No se pudo activar el push.");
    }
  };

  const decide = async (id: number, yes: boolean) => {
    try {
      const out = yes ? await approveTrade(id) : await rejectTrade(id);
      setFlash(yes
        ? out.status === "executed"
          ? `${out.ticker} — ${out.result_msg}`
          : out.status === "working"
            ? `${out.ticker} — orden límite enviada, esperando ejecución.`
            : `${out.ticker} — FALLÓ: ${out.result_msg}`
        : `${out.ticker} — propuesta descartada.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error decidiendo la propuesta.");
    }
  };

  const reconcile = async () => {
    try {
      const { reconciled } = await reconcileApprovals();
      setFlash(reconciled
        ? `${reconciled} orden(es) actualizada(s) con su fill real.`
        : "Sin cambios: la(s) orden(es) siguen sin ejecutar en IBKR.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error sincronizando órdenes con IBKR.");
    }
  };

  const doSyncPersonal = async () => {
    setSyncing(true);
    try {
      const res = await syncPersonal();
      setPersonal(res);
      setFlash(`Cartera personal sincronizada: ${res.synced} posición(es) desde IBKR.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo sincronizar la cartera personal.");
    } finally {
      setSyncing(false);
    }
  };

  const exit = () => {
    setLeaving(true);
    setTimeout(() => router.push("/"), 430);
  };

  const perf = summary?.performance;
  const dry = summary?.broker.mode !== "live";
  // Ventas/recortes primero: liberan caja antes de que lleguen las compras. Aprobar en el orden
  // contrario (visto en producción, 28-ago) dimensiona las compras contra caja casi a cero.
  const libera = (accion: string) => accion === "vender" || accion === "recortar";
  const pending = [...(approvals?.pending ?? [])].sort(
    (a, b) => Number(!libera(a.action)) - Number(!libera(b.action)));
  const historyAll = approvals?.history ?? [];
  const working = historyAll.filter((h) => h.status === "working");
  const history = historyAll.filter((h) => h.status !== "working");
  const equity = summary ? Number(summary.equity) : 0;
  const uPnl = summary ? Number(summary.unrealized_pnl) : 0;
  const rPnl = summary ? Number(summary.realized_pnl) : 0;
  // Escaneo en curso: por el clic local (running) o detectado en el sondeo periódico (otra
  // pestaña, el cron semanal) — el botón se deshabilita en ambos casos.
  const isScanning = running || scanStatus?.status === "running";
  // Máquina de estados de la sala: sin capital → hero de puesta en marcha; con capital → libro.
  const hasCapital = equity > 0 || (summary?.positions.length ?? 0) > 0;
  // Escala común de las barras de P&L por posición (una vez, no dentro del map por fila).
  const maxAbs = Math.max(1e-9, ...(perf?.positions ?? []).map((x) => Math.abs(Number(x.unrealized_pnl))));

  // Orden de las 3 tablas con cabecera (propuestas, posiciones, cartera personal) -- se llaman
  // aquí, antes de cualquier return condicional, para no romper el orden de los hooks.
  const {
    sorted: sortedPending, sortKey: pendingSortKey, sortDir: pendingSortDir,
    toggle: togglePending, ariaSort: pendingAriaSort,
  } = useOrden<Approval, PendingSortKey>(pending, (row, key) => {
    if (key === "est_price") return row.est_price != null ? Number(row.est_price) : null;
    return row[key];
  });

  const positionRows = (summary?.positions ?? []).map((p, i) => {
    const pr = perf?.positions.find((x) => x.ticker === p.ticker);
    return {
      ...p, i,
      pnl: pr ? Number(pr.unrealized_pnl) : null,
      pnlPct: pr?.pnl_pct ?? null,
      w: equity > 0 ? (Number(p.value) / equity) * 100 : 0,
    };
  });
  const {
    sorted: sortedPositions, sortKey: posSortKey, sortDir: posSortDir,
    toggle: togglePos, ariaSort: posAriaSort,
  } = useOrden<typeof positionRows[number], PositionSortKey>(positionRows, (row, key) => {
    if (key === "quantity" || key === "avg_cost" || key === "price" || key === "value") return Number(row[key]);
    return row[key];
  });

  const personalRows = (personal?.positions ?? []).map((p) => ({
    ...p, pnl: p.unrealized_pnl != null ? Number(p.unrealized_pnl) : null,
  }));
  const {
    sorted: sortedPersonal, sortKey: persSortKey, sortDir: persSortDir,
    toggle: togglePers, ariaSort: persAriaSort,
  } = useOrden<typeof personalRows[number], PersonalSortKey>(personalRows, (row, key) => {
    if (key === "quantity") return Number(row.quantity);
    if (key === "price" || key === "value") return row[key] != null ? Number(row[key]) : null;
    return row[key];
  });

  // Primera carga: nada de la sala se pinta hasta que todo llegue junto — mejor un instante en
  // blanco que un hueco donde algo parezca al día sin serlo, con dinero real de por medio. No
  // hay nada montado todavía, así que un `return` completo no pierde ningún estado.
  if (loading && !hasLoadedOnce.current) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 text-[13px]"
           style={{ background: T.page, color: T.muted, fontFamily: SANS }}>
        <span className="h-6 w-6 animate-spin rounded-full border-2"
              style={{ borderColor: T.grid, borderTopColor: T.buy }} />
        <p>Cargando Alpha…</p>
      </div>
    );
  }

  return (
      <div className="real-room min-h-[100dvh] pb-8 text-[13px] antialiased"
           style={{ background: T.page, color: T.ink2, fontFamily: SANS }}>

      {/* Recarga tras volver de una ausencia: un velo ENCIMA, no un `return` que sustituya la
          sala — así ningún filtro escrito, panel abierto o scroll se pierde por debajo. Bloquea
          clics de verdad (cubre toda la pantalla, z-50) mientras dura, mismo criterio de fondo
          que la pantalla de la primera carga: nada de tocar datos que se están refrescando. */}
      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 text-[13px]"
             style={{ background: `${T.page}f2` }}>
          <span className="h-6 w-6 animate-spin rounded-full border-2"
                style={{ borderColor: T.grid, borderTopColor: T.buy }} />
          <p style={{ color: T.muted }}>Actualizando…</p>
        </div>
      )}

      {/* Scroll INTEGRADO en toda la sala (incluida la barra del documento): fino, tono panel,
          sin flechas. El <style> vive solo mientras esta página está montada. */}
      <style>{`
        html { scrollbar-width: thin; scrollbar-color: ${T.base} ${T.page}; }
        html::-webkit-scrollbar { width: 10px; }
        html::-webkit-scrollbar-track { background: ${T.page}; }
        html::-webkit-scrollbar-thumb { background: ${T.base}; border-radius: 5px; border: 2px solid ${T.page}; }
        html::-webkit-scrollbar-thumb:hover { background: ${T.muted}; }
        html::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
        .real-room * { scrollbar-width: thin; scrollbar-color: ${T.base} transparent; }
        .real-room *::-webkit-scrollbar { height: 6px; width: 6px; }
        .real-room *::-webkit-scrollbar-track { background: transparent; }
        .real-room *::-webkit-scrollbar-thumb { background: ${T.base}; border-radius: 3px; }
        .real-room *::-webkit-scrollbar-thumb:hover { background: ${T.muted}; }
        .real-room *::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
      `}</style>

      <div className="mx-auto max-w-[1500px] px-4 pt-6 lg:px-6">

        {/* Sin barra fija -- como la land, la navegación que hace falta vive en el flujo
            normal, no clavada arriba (feedback 12-sep-2026, "el header AI slop fuera"). El
            escaneo ya tiene su propio botón en Centro de operaciones más abajo. */}
        <div className="mb-4 flex items-center justify-between">
          <button onClick={exit} className="text-[12px] font-semibold transition-colors hover:underline" style={{ color: T.muted }}>
            ← Portada
          </button>
          <div className="flex items-center gap-2">
            <SalaDoor to="beta" />
            <SalaDoor to="omega" />
          </div>
        </div>

        {/* ---------- cabecera: eyebrow + título + descripción, como el resto de la casa
            (ver /mockup). El badge dry-run/live va en la MISMA fila que el símbolo, no como
            hermano de todo el bloque -- así no le da por bajar debajo de la descripción en
            pantallas estrechas (feedback 12-sep-2026). ---------- */}
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <p className="flex items-center gap-2 text-[22px] font-medium"
               style={{ color: T.buy, fontFamily: "var(--font-land-serif)", fontStyle: "italic",
                        fontOpticalSizing: "none", fontVariationSettings: '"opsz" 9' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: error ? T.bad : T.good }}
                    role="status" aria-label={error ? "sin conexión" : "conectado"} />
              α
            </p>
            {summary && (
              // Un punto y una palabra, en píldora -- misma forma que el resto de badges de
              // cabecera (Beta, Omega): la única diferencia real de Alpha es que este no es
              // decorativo, distingue dinero de verdad de dinero de mentira.
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide"
                    style={{ background: dry ? "rgba(250,178,25,0.14)" : "rgba(107,190,138,0.14)",
                             color: dry ? T.warn : T.good }}>
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: dry ? T.warn : T.good }} />
                {dry ? "DRY-RUN" : "LIVE"}
                <InfoTip text={summary.broker.detail} />
              </span>
            )}
          </div>
          <h1 className="mt-1 text-[26px] font-bold" style={{ color: T.ink }}>Cartera real</h1>
          <p className="mt-2 max-w-[46ch] text-[14px]" style={{ color: T.ink2 }}>
            El agente propone; cada orden espera tu Sí o tu No.
          </p>
        </header>


        {/* ---------- avisos ---------- */}
        {error && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-l-2 pl-3 text-[12.5px]"
               style={{ borderColor: T.bad, color: T.bad }}>
            <span>{error}</span>
            <button onClick={() => { setLoading(true); load(); }}
                    className="rounded border px-3 py-1 text-[11.5px] font-bold transition-opacity hover:opacity-80"
                    style={{ borderColor: T.bad, color: T.bad }}>
              Reintentar
            </button>
          </div>
        )}
        {flash && (
          <div className="mb-3 flex items-center justify-between text-[12.5px]" style={{ color: T.ink2 }}>
            <span>{flash}</span>
            <button onClick={() => setFlash("")} aria-label="Cerrar" className="hover:opacity-70" style={{ color: T.muted }}>✕</button>
          </div>
        )}
        {/* ---------- 1 · requiere decisión: cuando existe, SIEMPRE lo más alto ---------- */}
        {(pending.length > 0 || working.length > 0) && (
          <div className="mb-4 space-y-4">
            <div className="flex items-center gap-2 px-0.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: T.warn }} />
              <h2 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.warn }}>
                Requiere decisión
              </h2>
            </div>
            {working.length > 0 && (
              <Panel accent={T.warn}
                     title={`Órdenes en curso · ${working.length}`}
                     right={<button onClick={reconcile}
                                    className="rounded border px-3 py-1 text-[11.5px] font-bold transition-opacity hover:opacity-80"
                                    style={{ borderColor: "rgba(250,178,25,0.5)", color: T.warn }}>
                              Sincronizar ahora
                            </button>}>
                <div className="divide-y" style={{ borderColor: T.grid }}>
                  {working.map((w) => (
                    <div key={w.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                        <SideTag action={w.action} />
                        <span className="w-14 text-[14px] font-bold" style={{ color: T.ink }}>{w.ticker}</span>
                        <Field k="Pedidas" v={w.requested_quantity ? qty4(w.requested_quantity) : "—"} />
                        <Field k="Ejecutadas" v={w.quantity ? qty4(w.quantity) : "0"} />
                        <Field k="Precio est." v={w.est_price ? `$${money(w.est_price)}` : "—"} />
                        <Field k="Orden IBKR" v={w.broker_order_id ?? "—"} />
                        <Field k="Enviada" v={fmtTime(w.decided_at)} />
                        <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: T.warn }}>
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: T.warn }} />
                          TRABAJANDO
                        </span>
                      </div>
                      {/* Si el último sondeo tropezó (p. ej. la conversión EUR→USD que IBKR
                          disparó sola aún no aparece en su histórico), que se vea AQUÍ por qué
                          sigue "trabajando" — nunca una caja negra sin explicación. El resto de
                          mensajes ("enviada", estado normal de IBKR) va en tono neutro. */}
                      {w.result_msg && (
                        <p className="mt-1 text-[11px]"
                           style={{ color: w.result_msg.toLowerCase().includes("falló") ? T.bad : T.muted }}>
                          {w.result_msg}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="border-t px-4 py-1.5 text-[11px]" style={{ borderColor: T.grid, color: T.muted }}>
                  Orden límite viva en IBKR (validez: sesión). El libro se cuadra solo al ejecutarse; su
                  caja/acciones quedan reservadas — no hay doble gasto.
                </p>
              </Panel>
            )}
            {pending.length > 0 && (
              <Panel title={`Propuestas del agente · ${pending.length} esperando tu decisión`}
                     right={<span className="text-[11px]" style={{ color: T.muted }}>
                              caducan a los {cfg?.approval_expiry_days ?? 3} días sin decidir
                            </span>}>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse whitespace-nowrap text-[13px]">
                    <thead>
                      <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: T.muted }}>
                        <Th> </Th>
                        <Th sort={{ active: pendingSortKey === "ticker", dir: pendingSortDir, onClick: () => togglePending("ticker"), ariaSort: pendingAriaSort("ticker"), label: "instrumento" }}>Instrumento</Th>
                        <Th right sort={{ active: pendingSortKey === "target_weight_pct", dir: pendingSortDir, onClick: () => togglePending("target_weight_pct"), ariaSort: pendingAriaSort("target_weight_pct"), label: "peso objetivo" }}>Peso obj.</Th>
                        <Th right sort={{ active: pendingSortKey === "est_price", dir: pendingSortDir, onClick: () => togglePending("est_price"), ariaSort: pendingAriaSort("est_price"), label: "precio" }}>Precio</Th>
                        <Th right sort={{ active: pendingSortKey === "target_price", dir: pendingSortDir, onClick: () => togglePending("target_price"), ariaSort: pendingAriaSort("target_price"), label: "objetivo a 3 meses" }}>Obj. 3m</Th>
                        <Th right sort={{ active: pendingSortKey === "upside_pct", dir: pendingSortDir, onClick: () => togglePending("upside_pct"), ariaSort: pendingAriaSort("upside_pct"), label: "upside" }}>Upside</Th>
                        <Th right sort={{ active: pendingSortKey === "score", dir: pendingSortDir, onClick: () => togglePending("score"), ariaSort: pendingAriaSort("score"), label: "score" }}>Score</Th>
                        <Th right>Decisión</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPending.map((a) => (
                        <OrderRow key={a.id} a={a} dry={dry} onDecide={decide}
                                  expiryDays={cfg?.approval_expiry_days ?? 3} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>
        )}

        {/* ---------- 2a · libro vacío → puesta en marcha (la primera aportación vive aquí) ---------- */}
        {summary && !hasCapital && (
          <div className="mb-4">
            <Panel title="Ponlo en marcha">
              <p className="px-4 pt-3 text-[12px] leading-relaxed" style={{ color: T.muted }}>
                Dos pasos. El agente propone; cada orden esperará tu Sí o tu No
                {dry ? " — y ahora mismo en simulación: nada llega a IBKR." : "."}
              </p>
              <div className="grid gap-3 p-4 md:grid-cols-2">
                <div className="border p-3.5" style={{ borderColor: T.grid }}>
                  <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                    <b style={{ color: T.ink2 }}>1</b> · capital del agente
                  </p>
                  <CapitalForm onDone={(s, msg) => { setSummary(s); setFlash(msg); }} onError={setError} />
                </div>
                <div className="border p-3.5" style={{ borderColor: T.grid }}>
                  <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                    <b style={{ color: T.ink2 }}>2</b> · análisis
                  </p>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: T.ink2 }}>
                    El agente escanea cada martes a las 10:15 (hora del mercado US) para
                    aprender — ranking, watchlist y memoria. La decisión de cartera (sombra y
                    propuestas aquí) llega el primer martes del mes — o al momento con
                    «Analizar mercado» arriba.
                  </p>
                  <p className="mt-1.5 text-[11px]" style={{ color: T.muted }}>
                    {report ? `Último análisis: ${fmtTime(report.at)}.` : "Aún sin análisis."}
                  </p>
                </div>
              </div>
            </Panel>
          </div>
        )}

        {/* ---------- 2b · libro con capital → KPIs + aportar/retirar ---------- */}
        {(!summary || hasCapital) && (
          <>
            <section className="grid grid-cols-2 gap-x-6 gap-y-6 border-t pb-1 pt-4 md:grid-cols-3 xl:grid-cols-6"
                     style={{ borderColor: T.grid }}>
              <Kpi big label="Patrimonio"
                   value={summary && fx && equity > 0 ? `€${money(equity / fx, 0)}` : "—"}
                   sub={summary ? `≈ $${money(equity)}` : undefined} />
              <Kpi label="Caja €" value={summary ? `€${money(summary.cash.eur)}` : "—"} />
              <Kpi label="Caja $" value={summary ? `$${money(summary.cash.usd)}` : "—"} />
              <Kpi label="Invertido" value={summary ? `$${money(summary.positions_value)}` : "—"}
                   sub={summary ? `${summary.positions.length}/${cfg?.max_positions ?? 5} posiciones` : undefined} />
              {/* Realizado va de subtexto aquí (no su propio tile): con 7 KPIs la cuadrícula
                  quedaba descuadrada en móvil (2 columnas, última fila con uno solo). */}
              <Kpi label="P&L abierto" value={summary ? signMoney(uPnl) : "—"}
                   tone={uPnl > 0 ? "good" : uPnl < 0 ? "bad" : undefined}
                   sub={summary
                     ? `${equity > 0 ? `${((uPnl / equity) * 100).toFixed(2)}% del patrimonio · ` : ""}realizado ${signMoney(rPnl)}`
                     : undefined} />
              {/* Primero lo que hace TU libro; el índice y el alpha, de contexto en la línea
                  pequeña — la comparación nunca por delante del resultado. */}
              <Kpi label="Rentabilidad"
                   value={perf ? `${perf.portfolio_return_pct > 0 ? "+" : ""}${perf.portfolio_return_pct}%` : "—"}
                   tone={perf ? (perf.portfolio_return_pct >= 0 ? "good" : "bad") : undefined}
                   sub={perf?.spy_return_pct != null
                     ? `S&P ${perf.spy_return_pct > 0 ? "+" : ""}${perf.spy_return_pct}%${perf.alpha_pct != null
                         ? ` · alpha ${perf.alpha_pct > 0 ? "+" : ""}${perf.alpha_pct}%` : ""}`
                     : perf?.since ? `desde ${perf.since}` : "sin posiciones aún"} />
            </section>
            <div className="mb-3 mt-1.5 flex justify-end px-0.5">
              <button onClick={() => setCapOpen(!capOpen)}
                      className="text-[11px] font-semibold transition-colors hover:underline"
                      style={{ color: capOpen ? T.muted : T.buy }}>
                {capOpen ? "✕ cerrar" : "± aportar / retirar capital"}
              </button>
            </div>
            {capOpen && (
              <div className="mb-4 max-w-[520px] border-t px-0.5 pt-3"
                   style={{ borderColor: T.grid }}>
                <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                  Aportar o retirar capital del agente
                </p>
                <CapitalForm onDone={(s, msg) => { setSummary(s); setFlash(msg); setCapOpen(false); }}
                             onError={setError} />
              </div>
            )}
          </>
        )}

        {/* ---------- 3 · operar: lanzar y, justo debajo, lo que salió de lanzar. Antes se
            lanzaba desde cuatro sitios distintos y el informe caía lejos del lanzador. ---------- */}
        <div id="centro-operaciones" className="mt-4">
          <CentroOperaciones report={report} escaneando={isScanning}
                             escaneandoDecide={scanStatus?.decide ?? null}
                             onScanStarted={onScanStarted} onReload={load}
                             onLoadAnalytics={loadAnalytics} />
        </div>

        {report && (
          <div className="mt-4">
            <ScanReportPanel r={report} scan={funnel} />
          </div>
        )}

        {/* ---------- 4a · explorador de universo: filtrar el mercado ya capturado, sin
            objetivo de escaneo — situaciones de mercado, no preparación de cartera. Vive junto
            a "cómo piensa" porque comparte fuente (DuckDB) pero es su propia cosa. ---------- */}
        <div className="mt-4">
          <Details title="Explorador de universo">
            <Explorador />
          </Details>
        </div>

        {/* ---------- 4b · cómo piensa: memoria (buscador) + analítica del método (tablero).
            Ambas son introspección; el buscador va arriba porque se usa escribiendo, no
            ojeando, y entre tres tablas se perdía. El botón de sincronizar vive en la card. ---------- */}
        <div className="mt-4">
          <Details title="Cómo piensa el agente"
                 right={analyticsLoaded
                   ? <button onClick={loadAnalytics}
                             className="text-[11px] font-semibold transition-colors hover:underline"
                             style={{ color: T.buy }}>
                       ↻ recargar
                     </button>
                   : undefined}>
            {/* Sin encabezado propio: `MemorySearch` ya trae el suyo y salían dos "MEMORIA" seguidos. */}
            <div className="border-b px-4 py-3" style={{ borderColor: T.grid }}>
              <MemorySearch />
            </div>
            {!analyticsLoaded ? (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-[12px]" style={{ color: T.muted }}>
                  Coste por etapa del embudo y confianza del prescore — consultas sobre un
                  fichero DuckDB local, sincronizado desde Postgres a diario.
                </p>
                <button onClick={loadAnalytics}
                        className="shrink-0 rounded px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90"
                        style={{ background: T.buy }}>
                  Cargar analítica
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  <AnalyticsTable title="Coste por etapa" state={costeEtapa}
                    nav={<ScanNav scans={analyticsScans} pos={costeScanPos} onMove={loadCosteForScan} />} />
                  <AnalyticsTable title="Confianza del prescore" state={confianzaPrescore}
                    nav={<ScanNav scans={analyticsScans} pos={confianzaScanPos} onMove={loadConfianzaForScan} />} />
                </div>
              </>
            )}
          </Details>
        </div>

        {/* ---------- 5 · libro del agente: composición y trayectoria juntas ---------- */}
        {(!summary || hasCapital) && (
        <div className="mt-4">
        <Details title="Posiciones del agente"
               meta={`${summary?.positions.length ?? 0}/${cfg?.max_positions ?? 5}`}
               defaultOpen
               right={summary && Number(summary.positions_value) > 0
                 ? <span className={`text-[12px] font-bold ${NUMS}`} style={{ color: T.ink }}>
                     ${money(summary.positions_value)}
                   </span> : undefined}>
          {!summary || summary.positions.length === 0 ? (
            <Empty>Caja lista{summary ? ` ($${money(summary.cash.usd)} + €${money(summary.cash.eur)})` : ""}. Cuando el agente proponga y
              apruebes una compra, la posición aparecerá aquí con su distribución, coste y P&L en vivo.</Empty>
          ) : (
            <>
              <Distribution summary={summary} equity={equity} fx={fx} />
              <div className="overflow-x-auto">
                <table className="w-full border-collapse whitespace-nowrap text-[13px]">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: T.muted }}>
                      <Th sort={{ active: posSortKey === "ticker", dir: posSortDir, onClick: () => togglePos("ticker"), ariaSort: posAriaSort("ticker"), label: "instrumento" }}>Instrumento</Th>
                      <Th right sort={{ active: posSortKey === "quantity", dir: posSortDir, onClick: () => togglePos("quantity"), ariaSort: posAriaSort("quantity"), label: "cantidad" }}>Cantidad</Th>
                      <Th right sort={{ active: posSortKey === "avg_cost", dir: posSortDir, onClick: () => togglePos("avg_cost"), ariaSort: posAriaSort("avg_cost"), label: "coste medio" }}>Coste medio</Th>
                      <Th right sort={{ active: posSortKey === "price", dir: posSortDir, onClick: () => togglePos("price"), ariaSort: posAriaSort("price"), label: "último" }}>Último</Th>
                      <Th right sort={{ active: posSortKey === "value", dir: posSortDir, onClick: () => togglePos("value"), ariaSort: posAriaSort("value"), label: "valor" }}>Valor</Th>
                      <Th right sort={{ active: posSortKey === "w", dir: posSortDir, onClick: () => togglePos("w"), ariaSort: posAriaSort("w"), label: "peso" }}>Peso</Th>
                      <Th sort={{ active: posSortKey === "pnl", dir: posSortDir, onClick: () => togglePos("pnl"), ariaSort: posAriaSort("pnl"), label: "P&L abierto" }}>P&L abierto</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPositions.map((p) => (
                        <tr key={p.ticker} className="border-t" style={{ borderColor: T.grid }}>
                          <Td>
                            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                                  style={{ background: SERIES[p.i % SERIES.length] }} />
                            <button onClick={() => setAuditTicker(p.ticker)}
                                    className="font-bold underline-offset-2 hover:underline"
                                    style={{ color: T.ink }}
                                    aria-label={`Ver la historia de ${p.ticker} a través de los escaneos`}>
                              {p.ticker}
                            </button>
                          </Td>
                          <Td right><span className={NUMS}>{qty4(p.quantity)}</span></Td>
                          <Td right><span className={NUMS}>${money(p.avg_cost)}</span></Td>
                          <Td right><span className={NUMS}>${money(p.price)}</span></Td>
                          <Td right><span className={NUMS} style={{ color: T.ink }}>${money(p.value)}</span></Td>
                          <Td right><span className={NUMS}>{p.w.toFixed(1)}%</span></Td>
                          <Td><PnlBar value={p.pnl} maxAbs={maxAbs} pct={p.pnlPct} /></Td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Footer: cost → value only. S&P comparison lives in KPI + curve + mini-band. */}
              {perf && perf.positions.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[11px]"
                     style={{ borderColor: T.grid, color: T.muted }}>
                  <span>Rendimiento desde {perf.since ?? "—"}</span>
                  <span className={NUMS}>
                    coste ${money(perf.cost_basis)} → valor ${money(perf.market_value)}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Curva y sombra DENTRO de esta card: composición ahora y trayectoria responden a la
              misma pregunta, y como dos paneles seguidos ya se leían como uno solo. */}
          {hist.length >= 2 && (
            <div className="border-t px-4 py-3" style={{ borderColor: T.grid }}>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                  Tu curva vs S&amp;P 500
                </span>
                <span className="text-[11px]" style={{ color: T.muted }}>
                  las aportaciones no cuentan como rentabilidad
                </span>
              </div>
              <HistoryChart points={hist} dark />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t px-4 py-2.5 text-[12px]"
               style={{ borderColor: T.grid }}>
            <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
              Sombra en paralelo
            </span>
            <span style={{ color: T.ink2 }}>Sombra <b className={NUMS} style={{ color: (shadowPerf?.portfolio_return_pct ?? 0) >= 0 ? T.good : T.bad }}>{fmtPct(shadowPerf?.portfolio_return_pct)}</b></span>
            <span style={{ color: T.ink2 }}>Real <b className={NUMS} style={{ color: (perf?.portfolio_return_pct ?? 0) >= 0 ? T.good : T.bad }}>{fmtPct(perf?.portfolio_return_pct)}</b></span>
            <span style={{ color: T.ink2 }}>S&amp;P <b className={NUMS} style={{ color: T.ink }}>{fmtPct(shadowPerf?.spy_return_pct ?? perf?.spy_return_pct)}</b></span>
            <Link href="/beta" className="ml-auto text-[11.5px] font-semibold hover:underline" style={{ color: T.buy }}>
              Ver sombra →
            </Link>
          </div>
        </Details>
        </div>
        )}

        {/* ---------- 6 · tu dinero real, siempre a la vista (el agente no lo toca) ---------- */}
        <div className="mt-4 space-y-4">
          <Details title="Cartera personal IBKR"
                 meta={personal?.synced_at ? `sync ${fmtTime(personal.synced_at)}` : undefined}>
            {!personal || personal.positions.length === 0 ? (
              <Empty>Tus posiciones propias de IBKR, separadas del agente. Sincroniza para guardar el snapshot.</Empty>
            ) : (
              <>
                <div className="flex items-baseline justify-between px-4 pt-2.5">
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wider" style={{ color: T.muted }}>Valor total</div>
                    <div className={`text-[20px] font-bold leading-tight ${NUMS}`} style={{ color: T.ink }}>
                      ${money(personal.total_value)}
                    </div>
                    {fx && (
                      <div className={`inline-flex items-center gap-1 text-[10.5px] ${NUMS}`} style={{ color: T.muted }}>
                        ≈ €{money(Number(personal.total_value) / fx, 0)}
                        <InfoTip text="Al cambio EURUSD indicativo — como te lo consolida IBKR." />
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10.5px] uppercase tracking-wider" style={{ color: T.muted }}>P&L abierto</div>
                    <div className={`text-[14px] font-bold ${NUMS}`}
                         style={{ color: Number(personal.total_unrealized_pnl) >= 0 ? T.good : T.bad }}>
                      {signMoney(personal.total_unrealized_pnl)}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider" style={{ color: T.muted }}>
                        <Th sort={{ active: persSortKey === "ticker", dir: persSortDir, onClick: () => togglePers("ticker"), ariaSort: persAriaSort("ticker"), label: "instrumento" }}>Instr.</Th>
                        <Th right sort={{ active: persSortKey === "quantity", dir: persSortDir, onClick: () => togglePers("quantity"), ariaSort: persAriaSort("quantity"), label: "cantidad" }}>Cant.</Th>
                        <Th right sort={{ active: persSortKey === "price", dir: persSortDir, onClick: () => togglePers("price"), ariaSort: persAriaSort("price"), label: "último" }}>Último</Th>
                        <Th right sort={{ active: persSortKey === "value", dir: persSortDir, onClick: () => togglePers("value"), ariaSort: persAriaSort("value"), label: "valor" }}>Valor</Th>
                        <Th right sort={{ active: persSortKey === "pnl", dir: persSortDir, onClick: () => togglePers("pnl"), ariaSort: persAriaSort("pnl"), label: "P&L" }}>P&L</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPersonal.map((p) => (
                          <tr key={`${p.ticker}-${p.description}`} className="border-t" style={{ borderColor: T.grid }}>
                            <Td>
                              <b style={{ color: T.ink }}>{p.ticker}</b>
                              {p.asset_class !== "STK" && (
                                <span className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-[9.5px] font-bold"
                                      style={{ background: T.base, color: T.ink2 }}>
                                  {p.asset_class}
                                  <InfoTip text={p.description} />
                                </span>
                              )}
                            </Td>
                            <Td right><span className={NUMS}>{qty4(p.quantity)}</span></Td>
                            <Td right>
                              {/* PRECIO ACTUAL visible (lo que se mira); el coste medio, como sub-línea. */}
                              <div className={NUMS} style={{ color: T.ink }}>
                                {p.price ? `$${money(p.price)}` : "—"}
                                {!p.live && p.price && (
                                  <span className="ml-1 inline-flex items-center gap-0.5 text-[9px]" style={{ color: T.muted }}>
                                    sync
                                    <InfoTip text="Precio del último sync (no cotiza en vivo)." />
                                  </span>
                                )}
                              </div>
                              <div className={`text-[10px] ${NUMS}`} style={{ color: T.muted }}>
                                coste {p.avg_cost ? `$${money(p.avg_cost)}` : "—"}
                              </div>
                            </Td>
                            <Td right><span className={NUMS} style={{ color: T.ink }}>{p.value ? `$${money(p.value)}` : "—"}</span></Td>
                            <Td right>
                              <span className={`${NUMS} font-semibold`}
                                    style={{ color: p.pnl == null ? T.muted : p.pnl >= 0 ? T.good : T.bad }}>
                                {p.pnl != null ? signMoney(p.pnl) : "—"}
                              </span>
                            </Td>
                          </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="flex items-center gap-3 border-t px-4 py-2.5" style={{ borderColor: T.grid }}>
              <button onClick={doSyncPersonal} disabled={syncing}
                      className="shrink-0 rounded border px-3 py-1.5 text-[11.5px] font-semibold transition-colors hover:bg-white/5 disabled:opacity-40"
                      style={{ borderColor: T.ring, color: T.ink2 }}>
                {syncing ? "Sincronizando…" : "Sincronizar desde IBKR"}
              </button>
              <p className="text-[10.5px] leading-snug" style={{ color: T.muted }}>
                El agente NUNCA opera estas posiciones: solo vende lo que él compró. Si compra un ticker
                tuyo, en IBKR se suman pero aquí siguen separados.
              </p>
            </div>
          </Details>

        </div>

        {/* ---------- 7 · actividad (histórico de decisiones): justo antes de ajustes —
            son los dos últimos, uso ocasional. ---------- */}
        {history.length > 0 && (
          <div className="mt-4 border-t text-[11.5px]" style={{ borderColor: T.grid }}>
            <button onClick={() => setActividadOpen(!actividadOpen)} aria-expanded={actividadOpen}
                    className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:opacity-80">
              <span className="text-[16px] font-bold" style={{ color: T.ink }}>
                Actividad <span className="text-[13px] font-normal" style={{ color: T.muted }}>· {history.length} decisión(es)</span>
              </span>
              <span style={{ color: T.muted }}>{actividadOpen ? "▴" : "▾"}</span>
            </button>
            {actividadOpen && (
              <div className="max-h-[340px] overflow-y-auto border-t px-4 pb-2" style={{ borderColor: T.grid }}>
                <table className="w-full border-collapse text-[12.5px]">
                  <tbody>
                    {history.map((h) => <HistoryRow key={h.id} h={h} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ---------- 8 · ajustes: push, sesión y el reinicio del sombra — consulta ocasional,
            plegado por defecto como en el mockup (antes ocupaba una barra siempre a la vista). ---------- */}
        <div className="mt-4">
          <Details title="Ajustes">
            <div className="space-y-3 px-4 pb-4 pt-3.5 text-[12.5px]" style={{ color: T.ink2 }}>
              <p>
                Alertas push{" "}
                <b style={{ color: pushOn ? T.good : T.muted }}>
                  {pushOn == null ? "…" : pushOn ? "activas" : "inactivas"}
                </b>
                {" — "}
                {!pushOn ? (
                  <button onClick={enablePush}
                          className="underline decoration-dotted underline-offset-4"
                          style={{ color: T.buy }}>
                    Activar
                  </button>
                ) : (
                  <button onClick={async () => setFlash(`Prueba enviada a ${(await testPush()).sent} dispositivo(s).`)}
                          className="underline decoration-dotted underline-offset-4" style={{ color: T.buy }}>
                    Enviar prueba
                  </button>
                )}
              </p>
              {!pushOn && (
                <p className="text-[11px]" style={{ color: T.muted }}>
                  Suena cuando el agente propone. En iPhone: instala la app en pantalla de inicio.
                </p>
              )}
              <p style={{ color: T.muted }}>
                {dry ? "Bróker en dry-run" : "IBKR en vivo"} · el agente nunca ejecuta solo · órdenes a
                límite (ref ± {cfg?.limit_buffer_pct ?? 0.2}%), nunca a mercado.
                {summary?.broker.detail ? ` · ${summary.broker.detail}` : ""}
              </p>
              <p style={{ color: T.muted }}>
                Reiniciar el libro <b>sombra</b> borra posiciones, operaciones y curva —
                {" "}<b>conserva tu capital</b>. No toca el libro real ni tu cartera personal.
              </p>
              {!resetArmed ? (
                <button onClick={() => setResetArmed(true)}
                        className="rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-white/5"
                        style={{ borderColor: "rgba(208,59,59,0.5)", color: T.bad }}>
                  Reiniciar sombra
                </button>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <button onClick={doResetShadow} disabled={resetting}
                          className="rounded-full px-4 py-2 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                          style={{ background: T.bad }}>
                    {resetting ? "Reiniciando…" : "Confirmar borrado"}
                  </button>
                  <button onClick={() => setResetArmed(false)} disabled={resetting}
                          className="rounded-full border px-4 py-2 text-[13px] transition-colors hover:bg-white/5"
                          style={{ borderColor: T.ring, color: T.ink2 }}>
                    Cancelar
                  </button>
                </span>
              )}
              <p>
                <button onClick={logout} className="text-[12.5px]" style={{ color: T.ink2 }}>
                  Cerrar sesión
                </button>
              </p>
            </div>
          </Details>
        </div>

      </div>

      {auditTicker && <TickerAudit ticker={auditTicker} onClose={() => setAuditTicker(null)} />}

      {/* velo de salida hacia la portada */}
      <div aria-hidden
           className={`pointer-events-none fixed inset-0 z-[100] bg-slate-100 transition-opacity duration-[420ms] ease-in ${leaving ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
