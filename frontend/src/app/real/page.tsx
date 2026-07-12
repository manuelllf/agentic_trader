"use client";

/**
 * SALA REAL — panel de control de la cuenta real. El agente propone; tú decides.
 *
 * Sí → la orden LÍMITE se envía (o se simula en dry-run) y queda en el libro real.
 * No → se descarta sin más. Nada se mueve sin tu aprobación explícita.
 *
 * Jerarquía de la sala (mismo lenguaje visual T/SERIES, solo reorganizado):
 *  - Nivel 1, barra de mando (cabecera): título/nav + estado del último escaneo + botón Analizar.
 *  - Nivel 2, "Requiere decisión": propuestas pendientes + órdenes en curso — SOLO si hay algo.
 *  - Nivel 3, permanente: KPIs, posiciones/distribución/P&L del agente, franja de sombra en
 *    paralelo, y las secciones secundarias (cartera personal, comparativas/detalle) plegables
 *    y recordadas por dispositivo (localStorage) para no competir con lo operativo.
 * Legibilidad y claridad del dato por delante de todo, con MÍNIMO scroll. Jerarquía por tamaño y
 * peso tipográfico; color solo donde significa algo (P&L verde/rojo, working ámbar, compra
 * azul / venta roja). Paleta validada (CVD + contraste) sobre superficie dark.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  allocateReal, approveTrade, getApprovals, getConfig, getDemoStatus, getFx, getPerformance,
  getPersonal, getPushKey, getReal, reconcileApprovals, rejectTrade, runDemo,
  subscribePush, syncPersonal, testPush,
} from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import type {
  AppConfig, Approval, ApprovalsResponse, DemoStatus, Performance, PersonalSummary, RealSummary,
  TradeAction,
} from "@/lib/types";

/* ---------- tokens (paleta de referencia validada, modo dark) ---------- */
const T = {
  page: "#0d0d0d",        // plano de página
  panel: "#1a1a19",       // superficie de panel/gráfica
  panel2: "#202020",      // franja de cabecera de panel
  ring: "rgba(255,255,255,0.10)",
  grid: "#2c2c2a",        // hairline interior
  base: "#383835",        // baseline / neutro (caja)
  ink: "#ffffff",
  ink2: "#c3c2b7",
  muted: "#898781",
  good: "#0ca30c",        // P&L positivo (reservado)
  bad: "#d03b3b",         // P&L negativo / venta / crítico
  warn: "#fab219",        // órdenes trabajando / simulación
  buy: "#3987e5",         // compra (slot azul)
};
/* Serie categórica (orden fijo, validado): posiciones 1..5. El verde queda RESERVADO al P&L. */
const SERIES = ["#3987e5", "#199e70", "#c98500", "#9085e9", "#d55181"];

const money = (x: string | number, dec = 2) =>
  Number(x).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const qty4 = (x: string | number) =>
  Number(x).toLocaleString("en-US", { maximumFractionDigits: 4 });
const signMoney = (x: string | number) => {
  const n = Number(x);
  if (n === 0) return "$0.00";           // el cero es neutro: sin signo
  return `${n > 0 ? "+" : "−"}$${money(Math.abs(n))}`;
};
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtPct = (v: number | null | undefined) => (v != null ? `${v > 0 ? "+" : ""}${v}%` : "—");
const isBuy = (a: TradeAction) => a === "comprar" || a === "ampliar";
const NUMS = "tabular-nums";

/* ============================== página ============================== */

export default function SalaReal() {
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a, c, pp, st, sp, fxr] = await Promise.all([
        getReal(), getApprovals(), getConfig().catch(() => null), getPersonal().catch(() => null),
        getDemoStatus().catch(() => null), getPerformance().catch(() => null),
        getFx().catch(() => null),
      ]);
      setSummary(s);
      setApprovals(a);
      if (c) setCfg(c);
      if (pp) setPersonal(pp);
      if (st) setScanStatus(st);
      setShadowPerf(sp);
      if (fxr?.rate) setFx(fxr.rate);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sin conexión con el backend.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (scanTimer.current) clearTimeout(scanTimer.current);
    };
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

  const handleRunScan = async () => {
    setError("");
    try {
      await runDemo();
      setRunning(true);
      setFlash("Análisis en marcha…");
      pollScan();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo lanzar el análisis.");
    }
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

  return (
    <AuthGate>
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
        <div className="mx-auto flex h-11 max-w-[1500px] items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button onClick={exit} className="text-[12px] transition-colors hover:underline" style={{ color: T.muted }}>
              ← Sombra
            </button>
            <span className="h-4 w-px" style={{ background: T.grid }} />
            <span className="inline-flex items-center gap-2 text-[14px] font-bold tracking-tight" style={{ color: T.ink }}>
              <span className={`h-2 w-2 rounded-full ${loading && !summary ? "animate-pulse" : ""}`}
                    style={{ background: error ? T.bad : loading && !summary ? T.warn : T.good }}
                    title={error ? "sin conexión" : "conectado"} />
              SALA REAL
            </span>
            <span className="hidden text-[11.5px] sm:inline" style={{ color: T.muted }}>
              cuenta real · el agente propone, tú decides
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Estado del último escaneo: compacto, siempre visible en la barra de mando. */}
            <span className="hidden items-center rounded px-2.5 py-1 text-[11px] font-semibold sm:inline-flex"
                  style={{ background: "rgba(255,255,255,0.05)", color: T.muted }}
                  title="Puntúa el universo, propone la cartera real (a tu Sí/No) y ejecuta sola la sombra.">
              {isScanning
                ? "analizando…"
                : scanStatus?.finished_at
                  ? `último análisis ${fmtTime(scanStatus.finished_at)}${
                      scanStatus.result?.cost ? ` · $${scanStatus.result.cost.cost_usd.toFixed(3)}` : ""
                    }`
                  : "sin análisis previo"}
            </span>
            <button onClick={handleRunScan} disabled={isScanning}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-[11.5px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: "#5DCAA5", color: "#0d0d0d" }}>
              <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${isScanning ? "animate-spin" : ""}`}
                   fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                   strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="0.5" fill="currentColor" />
                <path d="M15.51 15.56a5 5 0 1 0 -3.51 1.44" />
                <path d="M18.83 17.86a9 9 0 1 0 -6.83 3.14" />
              </svg>
              {isScanning ? "Analizando…" : "Analizar mercado"}
            </button>
            {summary && (
              <span title={summary.broker.detail}
                    className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-bold tracking-wide"
                    style={dry
                      ? { background: "rgba(250,178,25,0.12)", color: T.warn }
                      : { background: "rgba(12,163,12,0.12)", color: T.good }}>
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: dry ? T.warn : T.good }} />
                {dry ? "SIMULACIÓN" : "LIVE · IBKR"}
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
            <button onClick={() => setFlash("")} className="hover:opacity-70" style={{ color: T.muted }}>✕</button>
          </div>
        )}
        {loading && !summary && !error && (
          <div className="mb-3 flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-[12.5px]"
               style={{ borderColor: T.ring, background: T.panel, color: T.muted }}>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                  style={{ borderColor: T.grid, borderTopColor: T.muted }} />
            Conectando con el backend…
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
                    <div key={w.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5">
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
                  ))}
                </div>
                <p className="border-t px-4 py-1.5 text-[11px]" style={{ borderColor: T.grid, color: T.muted }}>
                  Orden límite viva en IBKR (validez: sesión). El libro se cuadra solo al ejecutarse; su
                  caja/acciones quedan reservadas — no hay doble gasto.
                </p>
              </Panel>
            )}
            {pending.length > 0 && (
              <Panel title={`Propuestas del agente · ${pending.length} esperando tu decisión`}>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse whitespace-nowrap text-[13px]">
                    <thead>
                      <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: T.muted }}>
                        <Th> </Th><Th>Instrumento</Th><Th right>Peso obj.</Th><Th right>Precio</Th>
                        <Th right>Obj. 3m</Th><Th right>Upside</Th><Th right>Score</Th><Th right>Decisión</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((a) => <OrderRow key={a.id} a={a} dry={dry} onDecide={decide} />)}
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
                  <CapitalForm fx={fx} onDone={(s, msg) => { setSummary(s); setFlash(msg); }} onError={setError} />
                </div>
                <div className="rounded-lg border p-3.5" style={{ borderColor: T.grid }}>
                  <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                    <b style={{ color: T.ink2 }}>2</b> · análisis
                  </p>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: T.ink2 }}>
                    Automático cada martes a las 10:15 (hora del mercado US), o cuando quieras con
                    «Analizar mercado» arriba.
                  </p>
                  <p className="mt-1.5 text-[11px]" style={{ color: T.muted }}>
                    {scanStatus?.finished_at ? `Último análisis: ${fmtTime(scanStatus.finished_at)}.` : "Aún sin análisis."}
                  </p>
                </div>
              </div>
            </Panel>
          </div>
        )}

        {/* ---------- 2b · libro con capital → KPIs + aportar/retirar ---------- */}
        {(!summary || hasCapital) && (
          <>
            <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border md:grid-cols-3 xl:grid-cols-6"
                     style={{ borderColor: T.ring, background: T.grid }}>
              <Kpi big label="Patrimonio" value={summary ? `$${money(summary.equity)}` : "—"}
                   sub={summary && fx && equity > 0 ? `≈ €${money(equity / fx, 0)}` : undefined} />
              <Kpi label="Caja" value={summary ? `$${money(summary.cash)}` : "—"}
                   sub={summary ? `de $${money(equity)} gestionados` : undefined} />
              <Kpi label="Invertido" value={summary ? `$${money(summary.positions_value)}` : "—"}
                   sub={summary ? `${summary.positions.length}/${cfg?.max_positions ?? 5} posiciones` : undefined} />
              <Kpi label="P&L abierto" value={summary ? signMoney(uPnl) : "—"}
                   tone={uPnl > 0 ? "good" : uPnl < 0 ? "bad" : undefined}
                   sub={summary && equity > 0 ? `${((uPnl / equity) * 100).toFixed(2)}% del patrimonio` : undefined} />
              <Kpi label="P&L realizado" value={summary ? signMoney(rPnl) : "—"}
                   tone={rPnl > 0 ? "good" : rPnl < 0 ? "bad" : undefined} sub="ventas cerradas" />
              <Kpi label="Alpha vs S&P 500"
                   value={perf?.alpha_pct != null ? `${perf.alpha_pct > 0 ? "+" : ""}${perf.alpha_pct}%` : "—"}
                   tone={perf?.alpha_pct != null ? (perf.alpha_pct >= 0 ? "good" : "bad") : undefined}
                   sub={perf?.since ? `desde ${perf.since}` : "sin posiciones aún"} />
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
                <CapitalForm fx={fx}
                             onDone={(s, msg) => { setSummary(s); setFlash(msg); setCapOpen(false); }}
                             onError={setError} />
              </div>
            )}
          </>
        )}

        {/* ---------- 3 · libro del agente (solo cuando hay capital) ---------- */}
        {(!summary || hasCapital) && (
        <Panel title={`Posiciones del agente · ${summary?.positions.length ?? 0}/${cfg?.max_positions ?? 5}`}
               right={summary && Number(summary.positions_value) > 0
                 ? <span className={`text-[12px] font-bold ${NUMS}`} style={{ color: T.ink }}>
                     ${money(summary.positions_value)}
                   </span> : undefined}>
          {!summary || summary.positions.length === 0 ? (
            <Empty>Caja lista{summary ? ` ($${money(summary.cash)})` : ""}. Cuando el agente proponga y
              apruebes una compra, la posición aparecerá aquí con su distribución, coste y P&L en vivo.</Empty>
          ) : (
            <>
              <Distribution summary={summary} equity={equity} />
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
                      const maxAbs = Math.max(1e-9, ...(perf?.positions ?? []).map((x) => Math.abs(Number(x.unrealized_pnl))));
                      const w = equity > 0 ? (Number(p.value) / equity) * 100 : 0;
                      return (
                        <tr key={p.ticker} className="border-t" style={{ borderColor: T.grid }}>
                          <Td>
                            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                                  style={{ background: SERIES[i % SERIES.length] }} />
                            <b style={{ color: T.ink }}>{p.ticker}</b>
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
              {/* pie del panel: rendimiento vs S&P integrado (antes vivía en un desplegable aparte) */}
              {perf && perf.positions.length > 0 && (
                <div className="border-t px-4 pb-3 pt-2" style={{ borderColor: T.grid }}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]" style={{ color: T.muted }}>
                    <span>Rendimiento desde {perf.since ?? "—"}</span>
                    <span className={NUMS}>
                      coste ${money(perf.cost_basis)} → valor ${money(perf.market_value)}
                    </span>
                  </div>
                  <CompareBars
                    rows={[
                      { label: "Cartera", value: perf.portfolio_return_pct, color: T.buy },
                      { label: "S&P 500", value: perf.spy_return_pct ?? 0, color: T.base },
                    ]}
                  />
                </div>
              )}
            </>
          )}
        </Panel>
        )}

        {/* mini-franja: sombra en paralelo vs libro real vs S&P — un vistazo, sin repetir el detalle */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border px-4 py-2.5 text-[12px]"
             style={{ borderColor: T.ring, background: T.panel }}>
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

        {/* ---------- 4 · tu dinero real, siempre a la vista (el agente no lo toca) ---------- */}
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

          {/* actividad: solo existe si hay decisiones tomadas — sin panel vacío de relleno */}
          {history.length > 0 && (
            <Panel title={`Actividad · ${history.length} decisión(es)`}>
              <div className="max-h-[340px] overflow-y-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <tbody>
                    {history.map((h) => <HistoryRow key={h.id} h={h} />)}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>

        {/* ---------- 5 · pie de ajustes: una línea discreta, sin panel ---------- */}
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
          <span className="ml-auto text-right" style={{ color: T.muted }} title={summary?.broker.detail}>
            {dry ? "simulación" : "IBKR en vivo"} · el agente nunca ejecuta solo · órdenes a límite
            (ref ± {cfg?.limit_buffer_pct ?? 0.2}%), nunca a mercado
          </span>
        </div>
      </div>

      {/* velo de salida hacia la sala sombra */}
      <div aria-hidden
           className={`pointer-events-none fixed inset-0 z-[100] bg-slate-100 transition-opacity duration-[420ms] ease-in ${leaving ? "opacity-100" : "opacity-0"}`} />
    </div>
    </AuthGate>
  );
}

/* ============================== piezas ============================== */

function Kpi({ label, value, sub, tone, big }: {
  label: string; value: string; sub?: string; tone?: "good" | "bad"; big?: boolean;
}) {
  return (
    <div className="px-4 py-3" style={{ background: T.panel }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>{label}</p>
      <p className={`mt-1 font-bold leading-none ${NUMS} ${big ? "text-[25px]" : "text-[20px]"}`}
         style={{ color: tone === "good" ? T.good : tone === "bad" ? T.bad : T.ink }}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[10.5px]" style={{ color: T.muted }}>{sub}</p>}
    </div>
  );
}

function Panel({ title, right, accent, children }: {
  title: string; right?: React.ReactNode; accent?: string; children: React.ReactNode;
}) {
  // h-full + flex-col: en una fila de la rejilla, los dos paneles miden lo mismo
  // (el vacío se centra en vez de dejar un hueco negro debajo).
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border"
             style={{ borderColor: accent ? `${accent}55` : T.ring, background: T.panel }}>
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2"
           style={{ borderColor: T.grid, background: T.panel2 }}>
        <h2 className="text-[12px] font-bold tracking-wide" style={{ color: accent ?? T.ink2 }}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/* Aportar / retirar capital del agente. El libro habla DÓLARES y ese es el contrato duro (tope
   de gasto exacto al céntimo). Manuel aporta EUROS sin convertir: IBKR cambia €→$ al ejecutar
   cada compra, así que los € exactos que cueste el presupuesto se fijan entonces (deriva ~1%
   del cálculo indicativo; solo afecta al dinero nuevo — el ciclo interno venta→compra es USD). */
function CapitalForm({ fx, onDone, onError }: {
  fx: number | null;
  onDone: (s: RealSummary, msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [cur, setCur] = useState<"EUR" | "USD">("EUR");
  const [busy, setBusy] = useState(false);
  const v = parseFloat(amount);
  const valid = Number.isFinite(v) && v !== 0;
  const usd = !valid ? null : cur === "USD" ? v : fx ? v * fx : null;

  const submit = async () => {
    if (!valid || busy) return;
    if (usd == null) return onError("Sin cambio EUR/USD ahora mismo — usa $ o reintenta en un minuto.");
    const usdC = Math.round(usd * 100) / 100;              // el libro es cent-exacto
    setBusy(true);
    try {
      const note = cur === "EUR" ? `aportación ${v} EUR @ ${fx?.toFixed(4)}` : "aportación sala real";
      const s = await allocateReal(usdC, note);
      onDone(s, `Capital del agente actualizado: ${usdC > 0 ? "+" : ""}$${money(usdC)}`
        + (cur === "EUR" ? ` (${v > 0 ? "+" : ""}${money(v)} €)` : "") + ".");
      setAmount("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error asignando capital.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && submit()}
               placeholder="0.00" inputMode="decimal"
               className={`w-full rounded border bg-transparent px-3 py-1.5 text-[13px] outline-none ${NUMS}`}
               style={{ borderColor: T.grid, color: T.ink }}
               onFocus={(e) => (e.currentTarget.style.borderColor = T.buy)}
               onBlur={(e) => (e.currentTarget.style.borderColor = T.grid)} />
        <div className="flex shrink-0 overflow-hidden rounded border" style={{ borderColor: T.grid }}>
          {(["EUR", "USD"] as const).map((c) => (
            <button key={c} onClick={() => setCur(c)}
                    className="px-2.5 text-[12px] font-bold transition-colors"
                    style={cur === c ? { background: T.base, color: T.ink } : { color: T.muted }}>
              {c === "EUR" ? "€" : "$"}
            </button>
          ))}
        </div>
        <button onClick={submit} disabled={busy || !valid}
                className="shrink-0 rounded px-4 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: T.buy }}>
          {busy ? "…" : "Aportar"}
        </button>
      </div>
      <p className={`mt-1.5 text-[10.5px] leading-snug ${NUMS}`} style={{ color: T.muted }}>
        {cur === "EUR" && valid && usd != null
          ? `el agente queda autorizado a ${usd >= 0 ? "" : "−"}$${money(Math.abs(usd))} (EURUSD ${fx?.toFixed(4)});
             ese tope en $ es EXACTO — los € que cuesten los fija IBKR al ejecutar cada compra (deriva ~1%)`
          : cur === "EUR" && valid && usd == null
            ? "cambio EUR/USD no disponible — prueba en $"
            : "negativo = retirar · ninguna orden puede gastar más de lo asignado"}
      </p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="my-auto px-4 py-6 text-center text-[12.5px] leading-relaxed" style={{ color: T.muted }}>
      {children}
    </p>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <span className="text-[12px]">
      <span style={{ color: T.muted }}>{k} </span>
      <span className={`font-semibold ${NUMS}`} style={{ color: T.ink2 }}>{v}</span>
    </span>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-1.5 font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({ children, right, colSpan }: { children: React.ReactNode; right?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={`px-3 py-2 ${right ? "text-right" : ""}`}>{children}</td>;
}

function SideTag({ action }: { action: TradeAction }) {
  const buy = isBuy(action);
  return (
    <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded px-1 text-[10.5px] font-bold text-white"
          style={{ background: buy ? T.buy : T.bad }}
          title={buy ? `compra (${action})` : `venta (${action})`}>
      {buy ? "C" : "V"}
    </span>
  );
}

/* Distribución de la cartera: barra apilada (huecos de 2px) + leyenda con etiquetas directas. */
function Distribution({ summary, equity }: { summary: RealSummary; equity: number }) {
  const cash = Number(summary.cash);
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

/* Comparativa cartera vs S&P: barras horizontales con signo, escala común, etiqueta directa. */
function CompareBars({ rows }: { rows: { label: string; value: number; color: string }[] }) {
  const maxAbs = Math.max(0.01, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="mt-3 space-y-2">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / maxAbs) * 100;
        return (
          <div key={r.label} className="flex items-center gap-2 text-[11.5px]">
            <span className="w-14 shrink-0" style={{ color: T.ink2 }}>{r.label}</span>
            <span className="relative h-[10px] flex-1 overflow-hidden rounded" style={{ background: T.grid }}>
              <span className="absolute inset-y-0 left-1/2 w-px" style={{ background: T.base }} />
              <span className="absolute inset-y-0 rounded"
                    style={r.value >= 0
                      ? { left: "50%", width: `${w / 2}%`, background: r.color }
                      : { right: "50%", width: `${w / 2}%`, background: r.color }} />
            </span>
            <span className={`w-14 shrink-0 text-right font-semibold ${NUMS}`} style={{ color: T.ink }}>
              {r.value > 0 ? "+" : ""}{r.value}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function OrderRow({ a, dry, onDecide }: {
  a: Approval; dry: boolean; onDecide: (id: number, yes: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // el Sí exige doble clic: armar → confirmar (5 s para arrepentirse)
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const yes = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!armed) return setArmed(true);
    setBusy(true);
    await onDecide(a.id, true);
    setBusy(false);
  };
  const no = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    await onDecide(a.id, false);
    setBusy(false);
  };

  return (
    <>
      <tr onClick={() => setOpen(!open)}
          className="cursor-pointer border-t transition-colors hover:bg-white/[0.03]"
          style={{ borderColor: T.grid }}>
        <Td><SideTag action={a.action} /></Td>
        <Td>
          <b className="text-[14px]" style={{ color: T.ink }}>{a.ticker}</b>
          <span className="ml-2 text-[11px]" style={{ color: T.muted }}>
            {a.action}{a.sector ? ` · ${a.sector}` : ""}
          </span>
        </Td>
        <Td right><span className={NUMS}>{a.target_weight_pct}%</span></Td>
        <Td right><span className={NUMS}>{a.est_price ? `$${money(a.est_price)}` : "—"}</span></Td>
        <Td right><span className={NUMS}>{a.target_price ? `$${money(a.target_price)}` : "—"}</span></Td>
        <Td right>
          <span className={`font-semibold ${NUMS}`}
                style={{ color: a.upside_pct == null ? T.muted : a.upside_pct >= 0 ? T.good : T.bad }}>
            {a.upside_pct != null ? `${a.upside_pct > 0 ? "+" : ""}${a.upside_pct}%` : "—"}
          </span>
        </Td>
        <Td right>
          <span className={`inline-block min-w-[30px] rounded px-1.5 py-0.5 text-center text-[11.5px] font-bold ${NUMS}`}
                style={{ background: T.base, color: T.ink }}>
            {a.score ?? "—"}
          </span>
        </Td>
        <Td right>
          <span className="inline-flex gap-1.5">
            <button onClick={no} disabled={busy}
                    className="rounded border px-3 py-1.5 text-[11.5px] font-bold transition-colors hover:bg-white/5 disabled:opacity-40"
                    style={{ borderColor: "rgba(208,59,59,0.5)", color: T.bad }}>
              No
            </button>
            <button onClick={yes} disabled={busy}
                    className="rounded px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity disabled:opacity-40"
                    style={{ background: armed ? "#66a5f2" : T.buy, minWidth: armed ? undefined : 38 }}>
              {busy ? "…" : armed ? `Confirmar${dry ? " (sim)" : ""}` : "Sí"}
            </button>
          </span>
        </Td>
      </tr>
      {open && (
        <tr style={{ background: "rgba(255,255,255,0.02)" }}>
          <Td colSpan={8}>
            <div className="max-w-[900px] space-y-1.5 whitespace-normal py-1 text-[12.5px] leading-relaxed">
              {a.thesis && <DetailLine k="Tesis" v={a.thesis} />}
              {a.edge && <DetailLine k="Ventaja" v={a.edge} />}
              {a.risk && <DetailLine k="Riesgo" v={a.risk} color={T.warn} />}
              {a.macro_summary && <DetailLine k="Macro" v={a.macro_summary} dim />}
              <p className="text-[11px]" style={{ color: T.muted }}>
                Propuesta {fmtTime(a.created_at)} · caduca a los 3 días sin decisión
              </p>
            </div>
          </Td>
        </tr>
      )}
    </>
  );
}

function DetailLine({ k, v, color, dim }: { k: string; v: string; color?: string; dim?: boolean }) {
  return (
    <p style={{ color: dim ? T.muted : T.ink2 }}>
      <span className="mr-1.5 font-bold" style={{ color: color ?? T.ink }}>{k}:</span>
      {v}
    </p>
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
