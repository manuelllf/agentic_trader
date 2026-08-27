"use client";

/** Real room: control panel for live account. Agent proposes; you approve/reject orders.
 *  Hierarchy: header (title, scan status, analyze button) → decisions → live book. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  approveTrade, fetchAnalyticsConfianzaPrescore, fetchAnalyticsCosteEtapa, fetchAnalyticsPeSector,
  fetchAnalyticsPeSectorFechas, fetchAnalyticsScans,
  getApprovals, getConfig, getDemoStatus, getFx, getHistory,
  getPerformance, getPersonal, getPushKey, getReal, getScanFunnel, getScanReport, logout,
  reconcileApprovals, rejectTrade, resetShadow,
  subscribePush,
  syncPersonal, testPush,
  type ScanReport,
} from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import HistoryChart from "@/components/HistoryChart";
import { fmtPct, fmtTime, money, qty4, signMoney } from "@/lib/format";
import {
  cascada, fmtNum, fmtScanCost, sectoresTop, universoLinea, type FunnelScan,
} from "@/lib/scan";
import type {
  AppConfig, Approval, ApprovalsResponse, DemoStatus, HistoryPoint, Performance,
  PersonalSummary, RealSummary,
} from "@/lib/types";
import { CapitalForm } from "./CapitalForm";
import { CentroOperaciones } from "./CentroOperaciones";
import { MemorySearch } from "./MemorySearch";
import { ScanFullButton } from "./ScanFullModal";
import { OrderRow } from "./OrderRow";
import { TickerAudit } from "./TickerAudit";
import { NUMS, SERIES, T } from "./tokens";
import { Empty, Field, Kpi, Panel, SideTag, Td, Th } from "./ui";

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
  const [peSector, setPeSector] = useState<{ data: Record<string, unknown>[] | null; loading: boolean; error: string }>({ data: null, loading: false, error: "" });
  const [costeEtapa, setCosteEtapa] = useState<{ data: Record<string, unknown>[] | null; loading: boolean; error: string }>({ data: null, loading: false, error: "" });
  const [confianzaPrescore, setConfianzaPrescore] = useState<{ data: Record<string, unknown>[] | null; loading: boolean; error: string }>({ data: null, loading: false, error: "" });
  // Navegador de escaneo compartido por coste-etapa/confianza-prescore: -1 = "Total" (agregado
  // histórico, sin scan_run_id), 0 = el más reciente, 1 = el siguiente más antiguo, etc.
  const [analyticsScans, setAnalyticsScans] = useState<{ id: number; at: string; cadence: string }[]>([]);
  const [costeScanPos, setCosteScanPos] = useState(-1);
  const [confianzaScanPos, setConfianzaScanPos] = useState(-1);
  // Navegador de fecha para PER por sector: -1 = snapshot más reciente de cada ticker (de
  // siempre), 0 = el día más reciente CON fecha fija, 1 = el anterior, etc. Independiente de
  // `analyticsScans` (que es de escaneos, no de días de captura).
  const [peSectorFechas, setPeSectorFechas] = useState<string[]>([]);
  const [peSectorPos, setPeSectorPos] = useState(-1);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);   // guard de desmontaje (mismo patrón que la portada)

  const load = useCallback(async () => {
    try {
      const [s, a, c, pp, st, sp, fxr, hs, sr, fn] = await Promise.all([
        getReal(), getApprovals(), getConfig().catch(() => null), getPersonal().catch(() => null),
        getDemoStatus().catch(() => null), getPerformance().catch(() => null),
        getFx().catch(() => null), getHistory("real").catch(() => null),
        getScanReport().catch(() => null), getScanFunnel(1).catch(() => null),
      ]);
      if (!alive.current) return;   // desmontada: un GET lento no debe pintar nada
      setSummary(s);
      setApprovals(a);
      if (c) setCfg(c);
      if (pp) setPersonal(pp);
      if (st) setScanStatus(st);
      setShadowPerf(sp);
      if (fxr?.rate) setFx(fxr.rate);
      if (hs) setHist(hs.series);
      if (sr) setReport(sr.report);
      if (fn) setFunnel(fn.scans[0] ?? null);
      setError("");
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Sin conexión con el backend.");
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
    setPeSectorPos(-1);
    setPeSector({ data: null, loading: true, error: "" });
    setCosteEtapa({ data: null, loading: true, error: "" });
    setConfianzaPrescore({ data: null, loading: true, error: "" });
    fetchAnalyticsPeSector()
      .then((r) => setPeSector({ data: r.items, loading: false, error: "" }))
      .catch((e) => setPeSector({ data: null, loading: false, error: e instanceof Error ? e.message : "No se pudo cargar." }));
    fetchAnalyticsPeSectorFechas()
      .then((r) => setPeSectorFechas(r.items))
      .catch(() => setPeSectorFechas([]));
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

  /** Recarga PER por sector para la fecha en `pos` (-1 = último snapshot de cada ticker, de
   *  siempre). Navegador propio: no depende de `analyticsScans`, esta tabla nunca lo usó. */
  function loadPeSectorForDate(pos: number) {
    setPeSectorPos(pos);
    const fecha = pos >= 0 ? peSectorFechas[pos] : undefined;
    setPeSector((s) => ({ ...s, loading: true, error: "" }));
    fetchAnalyticsPeSector(fecha)
      .then((r) => setPeSector({ data: r.items, loading: false, error: "" }))
      .catch((e) => setPeSector({ data: null, loading: false, error: e instanceof Error ? e.message : "No se pudo cargar." }));
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

  // Volver a esta pestaña (o al navegador) tras un rato fuera: los datos en pantalla pueden
  // llevar minutos de retraso (caja, aprobaciones pendientes, precios) — dinero real de por
  // medio, así que se trata como una carga desde cero (pantalla de carga completa, sin dejar
  // el libro clicable con números que ya no son ciertos) en vez de refrescar en silencio por
  // detrás. El sondeo de cada 60s mientras la pestaña sigue activa NO entra por aquí: ese sí
  // sigue siendo silencioso, sería muy molesto tapar la pantalla cada minuto mientras se lee.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setLoading(true);
        load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  // Escaneo bajo demanda: el agente puntúa el universo, propone la cartera real (a tu Sí/No) y
  // ejecuta sola la sombra. Se sondea el estado mientras corre, igual que hacía la Sala Sombra.
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

  const irAOperaciones = () => {
    document.getElementById("centro-operaciones")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
  const pending = approvals?.pending ?? [];
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

  // Carga completa (primer montaje o volver a la pestaña tras un rato fuera): NADA de la sala
  // se pinta hasta que todo llegue a la vez — ni un botón clicable, ni un número a medio
  // refrescar. Mejor 1-2s de pantalla en blanco que un hueco donde algo parezca al día sin
  // serlo, con dinero real de por medio.
  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 text-[13px]"
           style={{ background: T.page, color: T.muted }}>
        <span className="h-6 w-6 animate-spin rounded-full border-2"
              style={{ borderColor: T.grid, borderTopColor: T.buy }} />
        <p>Cargando Sala Real…</p>
      </div>
    );
  }

  return (
      <div className="real-room min-h-[100dvh] pb-8 text-[13px] antialiased"
           style={{ background: T.page, color: T.ink2 }}>

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

      {/* ---------- cabecera ---------- */}
      <header className="sticky top-0 z-40 border-b backdrop-blur"
              style={{ borderColor: T.ring, background: "rgba(13,13,13,0.92)" }}>
        <div className="mx-auto flex h-auto max-w-[1500px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:h-11 sm:flex-nowrap sm:py-0 lg:px-6">
          {/* Cuatro cosas y ninguna más: volver, dónde estoy, lanzar, y con qué dinero. El
              lema y la fecha del último análisis se fueron al centro de operaciones — repetían
              lo que ya dicen la card de abajo y el pie de ajustes. */}
          <div className="flex items-center gap-3">
            <button onClick={exit} className="text-[12px] transition-colors hover:underline" style={{ color: T.muted }}>
              ← Portada
            </button>
            <span className="inline-flex items-center gap-2 text-[13px] font-bold tracking-tight" style={{ color: T.ink }}>
              <span className="h-2 w-2 rounded-full" style={{ background: error ? T.bad : T.good }}
                    title={error ? "sin conexión" : "conectado"} />
              SALA REAL
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={irAOperaciones}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1 text-[11.5px] font-semibold transition-opacity hover:opacity-90"
                    style={{ background: isScanning ? "rgba(57,135,229,0.15)" : T.buy,
                             color: isScanning ? "#85b7eb" : "#fff" }}>
              <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${isScanning ? "animate-spin" : ""}`}
                   fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                   strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="0.5" fill="currentColor" />
                <path d="M15.51 15.56a5 5 0 1 0 -3.51 1.44" />
                <path d="M18.83 17.86a9 9 0 1 0 -6.83 3.14" />
              </svg>
              {isScanning ? "Analizando…" : "Escanear"}
            </button>
            {summary && (
              // Un punto y una palabra. Es lo único de la cabecera que no puede faltar: distingue
              // dinero de verdad de dinero de mentira.
              <span title={summary.broker.detail}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide"
                    style={{ color: dry ? T.warn : T.good }}>
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: dry ? T.warn : T.good }} />
                {dry ? "DRY-RUN" : "LIVE"}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 pt-4 lg:px-6">

        {/* ---------- avisos ---------- */}
        {error && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2 text-[12.5px]"
               style={{ borderColor: "rgba(208,59,59,0.4)", background: "rgba(208,59,59,0.08)", color: "#e66767" }}>
            <span>{error}</span>
            <button onClick={() => { setLoading(true); load(); }}
                    className="rounded border px-3 py-1 text-[11.5px] font-bold transition-opacity hover:opacity-80"
                    style={{ borderColor: "rgba(208,59,59,0.5)", color: "#e66767" }}>
              Reintentar
            </button>
          </div>
        )}
        {flash && (
          <div className="mb-3 flex items-center justify-between rounded-lg border px-4 py-2 text-[12.5px]"
               style={{ borderColor: T.ring, background: T.panel, color: T.ink2 }}>
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
                        <Th> </Th><Th>Instrumento</Th><Th right>Peso obj.</Th><Th right>Precio</Th>
                        <Th right>Obj. 3m</Th><Th right>Upside</Th><Th right>Score</Th><Th right>Decisión</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((a) => (
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
                <div className="rounded-lg border p-3.5" style={{ borderColor: T.grid }}>
                  <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                    <b style={{ color: T.ink2 }}>1</b> · capital del agente
                  </p>
                  <CapitalForm onDone={(s, msg) => { setSummary(s); setFlash(msg); }} onError={setError} />
                </div>
                <div className="rounded-lg border p-3.5" style={{ borderColor: T.grid }}>
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
            <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border md:grid-cols-4 xl:grid-cols-7"
                     style={{ borderColor: T.ring, background: T.grid }}>
              <Kpi big label="Patrimonio"
                   value={summary && fx && equity > 0 ? `€${money(equity / fx, 0)}` : "—"}
                   sub={summary ? `≈ $${money(equity)}` : undefined} />
              <Kpi label="Caja €" value={summary ? `€${money(summary.cash.eur)}` : "—"} />
              <Kpi label="Caja $" value={summary ? `$${money(summary.cash.usd)}` : "—"} />
              <Kpi label="Invertido" value={summary ? `$${money(summary.positions_value)}` : "—"}
                   sub={summary ? `${summary.positions.length}/${cfg?.max_positions ?? 5} posiciones` : undefined} />
              <Kpi label="P&L abierto" value={summary ? signMoney(uPnl) : "—"}
                   tone={uPnl > 0 ? "good" : uPnl < 0 ? "bad" : undefined}
                   sub={summary && equity > 0 ? `${((uPnl / equity) * 100).toFixed(2)}% del patrimonio` : undefined} />
              <Kpi label="P&L realizado" value={summary ? signMoney(rPnl) : "—"}
                   tone={rPnl > 0 ? "good" : rPnl < 0 ? "bad" : undefined} sub="ventas cerradas" />
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
              <div className="mb-4 max-w-[520px] rounded-xl border px-4 py-3"
                   style={{ borderColor: T.ring, background: T.panel }}>
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
        <div id="centro-operaciones" className="mt-4 scroll-mt-16">
          <CentroOperaciones report={report} escaneando={isScanning}
                             onScanStarted={onScanStarted} onReload={load}
                             onLoadAnalytics={loadAnalytics} />
        </div>

        {report && (
          <div className="mt-4">
            <ScanReportPanel r={report} scan={funnel} />
          </div>
        )}

        {/* ---------- 4 · cómo piensa: memoria (buscador) + analítica del método (tablero).
            Ambas son introspección; el buscador va arriba porque se usa escribiendo, no
            ojeando, y entre tres tablas se perdía. El botón de sincronizar vive en la card. ---------- */}
        <div className="mt-4">
          <Panel title="Cómo piensa el agente"
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
                  PER por sector, coste por etapa del embudo y confianza del prescore — 3
                  consultas sobre un fichero DuckDB local, sincronizado desde Postgres a diario.
                </p>
                <button onClick={loadAnalytics}
                        className="shrink-0 rounded px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90"
                        style={{ background: T.buy }}>
                  Cargar analítica
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-4 p-4 lg:grid-cols-3">
                  <AnalyticsTable title="PER por sector" state={peSector}
                    nav={<ScanNav
                      scans={peSectorFechas.map((f) => ({ id: f, at: f, cadence: "" }))}
                      pos={peSectorPos} onMove={loadPeSectorForDate}
                      totalLabel="Más reciente"
                      formatLabel={(f) => new Date(f).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                    />} />
                  <AnalyticsTable title="Coste por etapa" state={costeEtapa}
                    nav={<ScanNav scans={analyticsScans} pos={costeScanPos} onMove={loadCosteForScan} />} />
                  <AnalyticsTable title="Confianza del prescore" state={confianzaPrescore}
                    nav={<ScanNav scans={analyticsScans} pos={confianzaScanPos} onMove={loadConfianzaForScan} />} />
                </div>
              </>
            )}
          </Panel>
        </div>

        {/* ---------- 5 · libro del agente: composición y trayectoria juntas ---------- */}
        {(!summary || hasCapital) && (
        <div className="mt-4">
        <Panel title={`Posiciones del agente · ${summary?.positions.length ?? 0}/${cfg?.max_positions ?? 5}`}
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
                      <Th>Instrumento</Th><Th right>Cantidad</Th><Th right>Coste medio</Th>
                      <Th right>Último</Th><Th right>Valor</Th><Th right>Peso</Th>
                      <Th>P&L abierto</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.positions.map((p, i) => {
                      const pr = perf?.positions.find((x) => x.ticker === p.ticker);
                      const pnl = pr ? Number(pr.unrealized_pnl) : null;
                      const pnlPct = pr?.pnl_pct ?? null;
                      const w = equity > 0 ? (Number(p.value) / equity) * 100 : 0;
                      return (
                        <tr key={p.ticker} className="border-t" style={{ borderColor: T.grid }}>
                          <Td>
                            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                                  style={{ background: SERIES[i % SERIES.length] }} />
                            <button onClick={() => setAuditTicker(p.ticker)}
                                    className="font-bold underline-offset-2 hover:underline"
                                    style={{ color: T.ink }}
                                    title="Ver la historia de este ticker a través de los escaneos">
                              {p.ticker}
                            </button>
                          </Td>
                          <Td right><span className={NUMS}>{qty4(p.quantity)}</span></Td>
                          <Td right><span className={NUMS}>${money(p.avg_cost)}</span></Td>
                          <Td right><span className={NUMS}>${money(p.price)}</span></Td>
                          <Td right><span className={NUMS} style={{ color: T.ink }}>${money(p.value)}</span></Td>
                          <Td right><span className={NUMS}>{w.toFixed(1)}%</span></Td>
                          <Td><PnlBar value={pnl} maxAbs={maxAbs} pct={pnlPct} /></Td>
                        </tr>
                      );
                    })}
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
            <Link href="/sombra" className="ml-auto text-[11.5px] font-semibold hover:underline" style={{ color: T.buy }}>
              Ver sombra →
            </Link>
          </div>
        </Panel>
        </div>
        )}

        {/* ---------- 6 · tu dinero real, siempre a la vista (el agente no lo toca) ---------- */}
        <div className="mt-4 space-y-4">
          <Panel title="Cartera personal IBKR"
                 right={personal?.synced_at
                   ? <span className="text-[11px]" style={{ color: T.muted }}>sync {fmtTime(personal.synced_at)}</span>
                   : undefined}>
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
                      <div className={`text-[10.5px] ${NUMS}`} style={{ color: T.muted }}
                           title="al cambio EURUSD indicativo — como te lo consolida IBKR">
                        ≈ €{money(Number(personal.total_value) / fx, 0)}
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
                        <Th>Instr.</Th><Th right>Cant.</Th><Th right>Último</Th>
                        <Th right>Valor</Th><Th right>P&L</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {personal.positions.map((p) => {
                        const pnl = p.unrealized_pnl != null ? Number(p.unrealized_pnl) : null;
                        return (
                          <tr key={`${p.ticker}-${p.description}`} className="border-t" style={{ borderColor: T.grid }}>
                            <Td>
                              <b style={{ color: T.ink }}>{p.ticker}</b>
                              {p.asset_class !== "STK" && (
                                <span className="ml-1 rounded px-1 text-[9.5px] font-bold"
                                      style={{ background: T.base, color: T.ink2 }} title={p.description}>
                                  {p.asset_class}
                                </span>
                              )}
                            </Td>
                            <Td right><span className={NUMS}>{qty4(p.quantity)}</span></Td>
                            <Td right>
                              {/* PRECIO ACTUAL visible (lo que se mira); el coste medio, como sub-línea. */}
                              <div className={NUMS} style={{ color: T.ink }}>
                                {p.price ? `$${money(p.price)}` : "—"}
                                {!p.live && p.price && (
                                  <span className="ml-1 text-[9px]" style={{ color: T.muted }} title="precio del último sync (no cotiza en vivo)">sync</span>
                                )}
                              </div>
                              <div className={`text-[10px] ${NUMS}`} style={{ color: T.muted }}>
                                coste {p.avg_cost ? `$${money(p.avg_cost)}` : "—"}
                              </div>
                            </Td>
                            <Td right><span className={NUMS} style={{ color: T.ink }}>{p.value ? `$${money(p.value)}` : "—"}</span></Td>
                            <Td right>
                              <span className={`${NUMS} font-semibold`}
                                    style={{ color: pnl == null ? T.muted : pnl >= 0 ? T.good : T.bad }}>
                                {pnl != null ? signMoney(pnl) : "—"}
                              </span>
                            </Td>
                          </tr>
                        );
                      })}
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
          </Panel>

        </div>

        {/* ---------- 7 · actividad (histórico de decisiones): justo antes de ajustes —
            son los dos últimos, uso ocasional. ---------- */}
        {history.length > 0 && (
          <div className="mt-4 rounded-lg border text-[11.5px]" style={{ borderColor: T.ring, background: T.panel }}>
            <button onClick={() => setActividadOpen(!actividadOpen)} aria-expanded={actividadOpen}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-white/5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                Actividad · {history.length} decisión(es)
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

        {/* ---------- 8 · ajustes: push, sesión y el reinicio del sombra, todo a la vista ---------- */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5 text-[11.5px]"
             style={{ borderColor: T.ring, background: T.panel }}>
          <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
            Ajustes
          </span>
          <span style={{ color: T.ink2 }}>
            alertas push{" "}
            <b style={{ color: pushOn ? T.good : T.muted }}>
              {pushOn == null ? "…" : pushOn ? "activas" : "inactivas"}
            </b>
          </span>
          {!pushOn ? (
            <button onClick={enablePush}
                    className="rounded px-2.5 py-1 text-[11px] font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: T.buy }}
                    title="Suena cuando el agente propone. En iPhone: instala la app en pantalla de inicio.">
              Activar alertas
            </button>
          ) : (
            <button onClick={async () => setFlash(`Prueba enviada a ${(await testPush()).sent} dispositivo(s).`)}
                    className="rounded border px-2.5 py-1 text-[11px] transition-colors hover:bg-white/5"
                    style={{ borderColor: T.ring, color: T.ink2 }}>
              Enviar prueba
            </button>
          )}
          <button onClick={logout}
                  className="rounded border px-2.5 py-1 text-[11px] font-bold transition-colors hover:bg-white/5"
                  style={{ borderColor: "rgba(208,59,59,0.5)", color: T.bad }}
                  title="Borra el token de sesión de este navegador y vuelve al login.">
            Cerrar sesión
          </button>
          <span className="ml-auto text-right" style={{ color: T.muted }} title={summary?.broker.detail}>
            {dry ? "bróker en dry-run" : "IBKR en vivo"} · el agente nunca ejecuta solo · órdenes a
            límite (ref ± {cfg?.limit_buffer_pct ?? 0.2}%), nunca a mercado
          </span>
          {/* Reiniciar sombra, a la vista: plegarlo tras "mantenimiento" solo añadía un clic a
              algo que ya tiene su propio armar→confirmar. */}
          <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-t pt-2.5"
               style={{ borderColor: T.grid }}>
            <span style={{ color: T.ink2 }}>
              Reiniciar el libro <b>sombra</b>: borra posiciones, operaciones y curva;
              {" "}<b>conserva tu capital</b>. No toca el libro real ni tu cartera personal.
            </span>
            {!resetArmed ? (
              <button onClick={() => setResetArmed(true)}
                      className="rounded border px-2.5 py-1 text-[11px] font-bold transition-colors hover:bg-white/5"
                      style={{ borderColor: "rgba(208,59,59,0.5)", color: T.bad }}>
                Reiniciar sombra
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <button onClick={doResetShadow} disabled={resetting}
                        className="rounded px-2.5 py-1 text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ background: T.bad }}>
                  {resetting ? "Reiniciando…" : "Confirmar borrado"}
                </button>
                <button onClick={() => setResetArmed(false)} disabled={resetting}
                        className="rounded border px-2.5 py-1 text-[11px] transition-colors hover:bg-white/5"
                        style={{ borderColor: T.ring, color: T.ink2 }}>
                  Cancelar
                </button>
              </span>
            )}
          </div>
        </div>

      </div>

      {auditTicker && <TickerAudit ticker={auditTicker} onClose={() => setAuditTicker(null)} />}

      {/* velo de salida hacia la portada */}
      <div aria-hidden
           className={`pointer-events-none fixed inset-0 z-[100] bg-slate-100 transition-opacity duration-[420ms] ease-in ${leaving ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}

/* ========================= piezas propias de la página =========================
   (Panel/Kpi/Empty/Field/Th/Td/SideTag viven en ./ui; CapitalForm y OrderRow — las máquinas
   armar→confirmar — en sus propios ficheros para poder testearlas en aislamiento.) */

/* Distribución de la cartera: barra apilada (huecos de 2px) + leyenda con etiquetas directas. */
function Distribution({ summary, equity, fx }: { summary: RealSummary; equity: number; fx: number | null }) {
  // Mismo consolidado que "Patrimonio": $ + € al cambio indicativo, para que la barra cuadre.
  const cash = Number(summary.cash.usd) + Number(summary.cash.eur) * (fx ?? 0);
  const rows = summary.positions.map((p, i) => ({
    label: p.ticker, value: Number(p.value), color: SERIES[i % SERIES.length],
  }));
  if (cash > 0.005) rows.push({ label: "Caja", value: cash, color: T.base });
  const total = equity > 0 ? equity : rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <div className="px-4 pb-1 pt-2.5">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded">
        {rows.map((r) => (
          <div key={r.label} title={`${r.label} ${(r.value / total * 100).toFixed(1)}%`}
               className="h-full rounded-[3px]"
               style={{ width: `${Math.max(0.75, (r.value / total) * 100)}%`, background: r.color }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pb-1 text-[11.5px]">
        {rows.map((r) => (
          <span key={r.label} className="inline-flex items-center gap-1.5" style={{ color: T.ink2 }}>
            <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />
            {r.label}
            <span className={`font-semibold ${NUMS}`} style={{ color: T.ink }}>
              {((r.value / total) * 100).toFixed(1)}%
            </span>
            <span className={NUMS} style={{ color: T.muted }}>${money(r.value, 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* Una tabla de "Analítica del método": columnas = claves del primer registro (no se tipa cada
   campo, son consultas DuckDB de forma libre). Carga, error (p.ej. 503 sin DuckDB) y vacío,
   cada uno con su mensaje — nada se traga en silencio. overflow-x-auto por si la tabla es ancha. */
/** Navegador compacto ‹ Total › compartido por coste-etapa/confianza-prescore: `pos` -1 = Total
 *  (agregado histórico, sin scan_run_id), 0 = escaneo más reciente, 1 = el siguiente más
 *  antiguo, etc., recorriendo `scans` (orden de `/analytics/scans`, ya descendente por fecha). */
function ScanNav({ scans, pos, onMove, totalLabel = "Total", formatLabel }: {
  scans: { id: number | string; at: string; cadence: string }[];
  pos: number;
  onMove: (pos: number) => void;
  totalLabel?: string;
  formatLabel?: (at: string) => string;
}) {
  const atTotal = pos <= -1;
  const atOldest = scans.length === 0 || pos >= scans.length - 1;
  const label = atTotal ? totalLabel
    : (formatLabel ?? fmtTime)(scans[pos]?.at ?? "");
  return (
    <div className="flex shrink-0 items-center gap-1 text-[10.5px]" style={{ color: T.muted }}>
      <button onClick={() => onMove(pos - 1)} disabled={atTotal}
              className="rounded px-1.5 leading-5 disabled:opacity-30"
              style={{ background: T.panel2 }} aria-label="Escaneo más reciente / total">
        ‹
      </button>
      <span className="min-w-[64px] text-center font-semibold" style={{ color: T.ink2 }}>{label}</span>
      <button onClick={() => onMove(pos + 1)} disabled={atOldest}
              className="rounded px-1.5 leading-5 disabled:opacity-30"
              style={{ background: T.panel2 }} aria-label="Escaneo anterior">
        ›
      </button>
    </div>
  );
}

function AnalyticsTable({ title, state, nav }: {
  title: string;
  state: { data: Record<string, unknown>[] | null; loading: boolean; error: string };
  nav?: React.ReactNode;
}) {
  const cols = state.data && state.data.length > 0 ? Object.keys(state.data[0]) : [];
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
          {title}
        </p>
        {nav}
      </div>
      {state.loading ? (
        <p className="text-[11.5px]" style={{ color: T.muted }}>Cargando…</p>
      ) : state.error ? (
        <p className="text-[11.5px]" style={{ color: T.bad }}>{state.error}</p>
      ) : !state.data || state.data.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: T.muted }}>Sin datos.</p>
      ) : (
        <div className="overflow-x-auto rounded border" style={{ borderColor: T.grid }}>
          <table className={`w-full border-collapse whitespace-nowrap text-[11px] ${NUMS}`}>
            <thead>
              <tr style={{ color: T.muted, background: T.panel2 }}>
                {cols.map((c) => <th key={c} className="px-2 py-1 text-left font-semibold">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {state.data.map((row, i) => (
                <tr key={i} className="border-t" style={{ borderColor: T.grid }}>
                  {cols.map((c) => (
                    <td key={c} className="px-2 py-1" style={{ color: T.ink2 }}>
                      {row[c] == null ? "—" : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* Barra ± de P&L por posición: baseline central, verde derecha / rojo izquierda, a escala común. */
function PnlBar({ value, maxAbs, pct }: { value: number | null; maxAbs: number; pct: number | null }) {
  if (value == null) return <span style={{ color: T.muted }}>—</span>;
  const w = Math.min(100, (Math.abs(value) / maxAbs) * 100);
  const pos = value >= 0;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-block h-[6px] w-[72px] overflow-hidden rounded-full" style={{ background: T.grid }}>
        <span className="absolute inset-y-0 left-1/2 w-px" style={{ background: T.base }} />
        <span className="absolute inset-y-0 rounded-full"
              style={pos
                ? { left: "50%", width: `${w / 2}%`, background: T.good }
                : { right: "50%", width: `${w / 2}%`, background: T.bad }} />
      </span>
      <span className={`font-semibold ${NUMS}`} style={{ color: pos ? T.good : T.bad }}>
        {signMoney(value)}
      </span>
      {pct != null && (
        <span className={`text-[11px] ${NUMS}`} style={{ color: T.muted }}>
          {pct > 0 ? "+" : ""}{pct}%
        </span>
      )}
    </span>
  );
}

/* Informe del último escaneo: una línea si fue sano; lista ámbar de incidencias; rojo si
   reventó entero. Fuente: /scan/report (persistido), no el estado en memoria del runner. */
function ScanReportPanel({ r, scan }: { r: ScanReport; scan: FunnelScan | null }) {
  const failed = !!r.error;
  const issues = r.issues ?? [];
  const clean = !failed && issues.length === 0;
  const pasos = cascada(r, scan);
  const universo = universoLinea(r);
  const sectores = sectoresTop(scan, 6);
  const maxPre = sectores[0]?.pre || 1;

  return (
    <Panel title="Último escaneo"
           accent={failed ? T.bad : issues.length ? T.warn : undefined}
           right={
             <span className="flex items-center gap-2.5">
               <ScanFullButton />
               <span className="text-[11px]" style={{ color: T.muted }}>{fmtTime(r.at)}</span>
             </span>
           }>
      <div className="px-4 py-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span style={{ color: T.ink2 }}>modo <b style={{ color: T.ink }}>{r.mode ?? "—"}</b></span>
          {universo && (
            <span className={NUMS} style={{ color: universo.tone === "ok" ? T.ink2 : T.warn }}>
              universo <b>{universo.texto}</b>
              <span style={{ color: T.muted }}> · {universo.detalle}</span>
            </span>
          )}
          {fmtScanCost(r.cost) && (
            <span className={NUMS} style={{ color: T.muted }}>{fmtScanCost(r.cost)}</span>
          )}
          {clean && <span className="font-bold" style={{ color: T.good }}>✓ sin incidencias</span>}
        </div>

        {/* El embudo como cascada: es LA cifra que cuenta qué hace el sistema. */}
        {pasos.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-stretch gap-1.5">
            {pasos.map((p, i) => (
              <div key={p.label} className="flex items-center gap-1.5">
                {i > 0 && <span style={{ color: T.muted }} aria-hidden>→</span>}
                <div className="rounded-md px-2.5 py-1.5" style={{ background: T.panel2 }} title={p.hint}>
                  <p className={`text-[15px] font-bold leading-none ${NUMS}`} style={{ color: T.ink }}>
                    {fmtNum(p.value)}
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-none" style={{ color: T.muted }}>
                    {p.label}
                    {p.pctOfPrev != null && (
                      <span className={NUMS}> · {p.pctOfPrev < 1 ? p.pctOfPrev.toFixed(1) : Math.round(p.pctOfPrev)}%</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
            {(scan?.sin_datos || scan?.prescore_error || scan?.deep_error) ? (
              <span className={`self-center text-[10.5px] ${NUMS}`} style={{ color: T.muted }}>
                ({scan.sin_datos} sin datos{scan.prescore_error ? ` · ${scan.prescore_error} fallos de pre-score` : ""}{scan.deep_error ? ` · ${scan.deep_error} profundos ilegibles` : ""})
              </span>
            ) : null}
          </div>
        )}

        {/* Por sector: dónde miró y dónde profundizó — responde al "colapso sectorial". */}
        {sectores.length > 0 && (
          <table className={`mt-3 w-full text-[11px] ${NUMS}`}>
            <thead>
              <tr style={{ color: T.muted }}>
                <th className="pb-1 text-left font-semibold">sector</th>
                <th className="pb-1 text-right font-semibold">vistos</th>
                <th className="pb-1 text-right font-semibold">a fondo</th>
                <th className="pb-1 pl-3 text-left font-semibold">peso</th>
              </tr>
            </thead>
            <tbody>
              {sectores.map((s) => (
                <tr key={s.sector} style={{ color: T.ink2 }}>
                  <td className="py-0.5">{s.sector}</td>
                  <td className="py-0.5 text-right">{fmtNum(s.pre)}</td>
                  <td className="py-0.5 text-right" style={{ color: s.deep ? T.ink : T.muted }}>{s.deep}</td>
                  <td className="w-[38%] py-0.5 pl-3">
                    <span className="block h-[6px] rounded-sm"
                          style={{ width: `${Math.max(2, (s.pre / maxPre) * 100)}%`, background: T.buy }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {(r.changes ?? []).length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {(r.changes ?? []).map((c) => (
              <li key={c} style={{ color: T.ink2 }}>
                <span className="mr-1.5" style={{ color: T.buy }} aria-hidden>›</span>{c}
              </li>
            ))}
          </ul>
        )}
        {failed && (
          <p className="mt-2 font-semibold" style={{ color: "#e66767" }}>
            El escaneo FALLÓ: {r.error}
          </p>
        )}
        {issues.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {issues.map((it) => (
              <li key={it} style={{ color: T.ink2 }}>
                <span className="mr-1.5" style={{ color: T.warn }} aria-hidden>▲</span>{it}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}


const HIST_STATUS: Record<string, { label: string; color: string }> = {
  executed: { label: "Ejecutada", color: T.good },
  working: { label: "Trabajando", color: T.warn },
  rejected: { label: "Descartada", color: T.muted },
  failed: { label: "Fallida", color: T.bad },
  expired: { label: "Caducada", color: T.muted },
};

function HistoryRow({ h }: { h: Approval }) {
  const st = HIST_STATUS[h.status] ?? { label: h.status, color: T.muted };
  return (
    <tr className="border-t" style={{ borderColor: T.grid }}>
      <Td><SideTag action={h.action} /></Td>
      <Td><b style={{ color: T.ink }}>{h.ticker}</b></Td>
      <Td>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: st.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
          {st.label}
        </span>
      </Td>
      <Td>
        <span className="block max-w-[420px] truncate text-[12px]" style={{ color: T.muted }} title={h.result_msg}>
          {h.quantity && h.fill_price ? `${qty4(h.quantity)} @ $${money(h.fill_price)} · ` : ""}
          {h.result_msg}
        </span>
      </Td>
      <Td right><span className="text-[11px]" style={{ color: T.muted }}>{fmtTime(h.decided_at)}</span></Td>
    </tr>
  );
}
