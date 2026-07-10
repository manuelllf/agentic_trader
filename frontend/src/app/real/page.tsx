"use client";

/**
 * SALA REAL — panel de control de la cuenta real. El agente propone; tú decides.
 *
 * Sí → la orden LÍMITE se envía (o se simula en dry-run) y queda en el libro real.
 * No → se descarta sin más. Nada se mueve sin tu aprobación explícita.
 *
 * Diseño: legibilidad y claridad del dato por delante de todo, con MÍNIMO scroll: rejilla de
 * 12 columnas que empareja lo operativo (izquierda) con su contexto (derecha) fila a fila, y
 * las utilidades (capital/alertas/conexión) fusionadas en un panel. Jerarquía por tamaño y
 * peso tipográfico; color solo donde significa algo (P&L verde/rojo, working ámbar, compra
 * azul / venta roja). Paleta validada (CVD + contraste) sobre superficie dark.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  allocateReal, approveTrade, getApprovals, getConfig, getPersonal, getPushKey, getReal,
  reconcileApprovals, rejectTrade, subscribePush, syncPersonal, testPush,
} from "@/lib/api";
import type {
  AppConfig, Approval, ApprovalsResponse, PersonalSummary, RealSummary, TradeAction,
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
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a, c, pp] = await Promise.all([
        getReal(), getApprovals(), getConfig().catch(() => null), getPersonal().catch(() => null),
      ]);
      setSummary(s);
      setApprovals(a);
      if (c) setCfg(c);
      if (pp) setPersonal(pp);
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
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

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

  const doAllocate = async () => {
    const v = parseFloat(amount);
    if (!Number.isFinite(v) || v === 0) return;
    try {
      setSummary(await allocateReal(v, "asignación sala real"));
      setAmount("");
      setFlash(`Capital real actualizado: ${v > 0 ? "+" : ""}$${money(v)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error asignando capital.");
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
      setError(e instanceof Error ? e.message : "Error reconciliando órdenes.");
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

        {/* ---------- KPIs ---------- */}
        <section className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border md:grid-cols-3 xl:grid-cols-6"
                 style={{ borderColor: T.ring, background: T.grid }}>
          <Kpi big label="Patrimonio" value={summary ? `$${money(summary.equity)}` : "—"} />
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

        {/* ---------- órdenes EN CURSO (ancho completo, solo si hay) ---------- */}
        {working.length > 0 && (
          <div className="mb-4">
            <Panel accent={T.warn}
                   title={`Órdenes en curso · ${working.length}`}
                   right={<button onClick={reconcile}
                                  className="rounded border px-3 py-1 text-[11.5px] font-bold transition-opacity hover:opacity-80"
                                  style={{ borderColor: "rgba(250,178,25,0.5)", color: T.warn }}>
                            Reconciliar ahora
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
          </div>
        )}

        {/* ---------- rejilla: operativa (izq) + contexto (dcha), fila a fila ---------- */}
        <div className="grid gap-4 xl:grid-cols-12">

          {/* fila 1: propuestas ←→ rendimiento */}
          <div className="xl:col-span-7">
            <Panel title={`Propuestas del agente · ${pending.length} esperando tu decisión`}>
              {pending.length === 0 ? (
                <Empty>Sin propuestas pendientes. El próximo escaneo propondrá aquí y te llegará una alerta.</Empty>
              ) : (
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
              )}
            </Panel>
          </div>
          <div className="xl:col-span-5">
            <Panel title={`Rendimiento vs S&P 500${perf?.since ? ` · desde ${perf.since}` : ""}`}>
              {!perf || perf.positions.length === 0 ? (
                <Empty>Cuando el libro tenga posiciones, aquí verás la rentabilidad del agente contra el
                  S&P 500 desde la entrada.</Empty>
              ) : (
                <div className="p-4">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider" style={{ color: T.muted }}>Alpha</div>
                      <div className={`text-[24px] font-bold leading-none ${NUMS}`}
                           style={{ color: (perf.alpha_pct ?? 0) >= 0 ? T.good : T.bad }}>
                        {perf.alpha_pct != null ? `${perf.alpha_pct > 0 ? "+" : ""}${perf.alpha_pct}%` : "—"}
                      </div>
                    </div>
                    <div className="text-right text-[11.5px]" style={{ color: T.muted }}>
                      <div>Coste base <b className={NUMS} style={{ color: T.ink2 }}>${money(perf.cost_basis)}</b></div>
                      <div>Valor actual <b className={NUMS} style={{ color: T.ink2 }}>${money(perf.market_value)}</b></div>
                    </div>
                  </div>
                  <CompareBars
                    rows={[
                      { label: "Cartera", value: perf.portfolio_return_pct, color: T.buy },
                      { label: "S&P 500", value: perf.spy_return_pct ?? 0, color: T.base },
                    ]}
                  />
                </div>
              )}
            </Panel>
          </div>

          {/* fila 2: posiciones del agente ←→ cartera personal */}
          <div className="xl:col-span-7">
            <Panel title={`Posiciones del agente · ${summary?.positions.length ?? 0}/${cfg?.max_positions ?? 5}`}
                   right={summary && Number(summary.positions_value) > 0
                     ? <span className={`text-[12px] font-bold ${NUMS}`} style={{ color: T.ink }}>
                         ${money(summary.positions_value)}
                       </span> : undefined}>
              {!summary || summary.positions.length === 0 ? (
                <Empty>El libro real está vacío: cuando apruebes una compra, la posición aparecerá aquí con
                  su distribución, coste y P&L en vivo.</Empty>
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
                </>
              )}
            </Panel>
          </div>
          <div className="xl:col-span-5">
            <Panel title="Cartera personal · intocable"
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

          {/* fila 3: historial ←→ controles (capital + alertas + conexión en UN panel) */}
          <div className="xl:col-span-7">
            <Panel title={`Historial de decisiones · ${history.length}`}>
              {history.length === 0 ? (
                <Empty>Aún sin decisiones. Cada Sí/No que tomes queda registrado aquí con su resultado.</Empty>
              ) : (
                <div className="max-h-[340px] overflow-y-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <tbody>
                      {history.map((h) => <HistoryRow key={h.id} h={h} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
          <div className="xl:col-span-5">
            <Panel title="Controles">
              {/* capital */}
              <div className="px-4 py-3">
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                  Capital del sleeve
                </p>
                <div className="flex gap-2">
                  <input value={amount} onChange={(e) => setAmount(e.target.value)}
                         onKeyDown={(e) => e.key === "Enter" && doAllocate()}
                         placeholder="0.00" inputMode="decimal"
                         className={`w-full rounded border bg-transparent px-3 py-1.5 text-[13px] outline-none ${NUMS}`}
                         style={{ borderColor: T.grid, color: T.ink }}
                         onFocus={(e) => (e.currentTarget.style.borderColor = T.buy)}
                         onBlur={(e) => (e.currentTarget.style.borderColor = T.grid)} />
                  <button onClick={doAllocate}
                          className="shrink-0 rounded px-4 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
                          style={{ background: T.buy }}>
                    Asignar
                  </button>
                </div>
                <p className="mt-1.5 text-[10.5px]" style={{ color: T.muted }}>
                  Parte de tu cuenta gestionada por el agente. Negativo = retirar. Ninguna orden puede gastar
                  más de lo asignado.
                </p>
              </div>
              {/* alertas */}
              <div className="border-t px-4 py-3" style={{ borderColor: T.grid }}>
                <div className="flex items-center justify-between">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                    Alertas push · este dispositivo
                  </p>
                  <span className="text-[11.5px] font-bold" style={{ color: pushOn ? T.good : T.muted }}>
                    {pushOn == null ? "…" : pushOn ? "ACTIVAS" : "INACTIVAS"}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  {!pushOn ? (
                    <button onClick={enablePush}
                            className="shrink-0 rounded px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90"
                            style={{ background: T.buy }}>
                      Activar alertas
                    </button>
                  ) : (
                    <button onClick={async () => setFlash(`Prueba enviada a ${(await testPush()).sent} dispositivo(s).`)}
                            className="shrink-0 rounded border px-3 py-1.5 text-[11.5px] transition-colors hover:bg-white/5"
                            style={{ borderColor: T.ring, color: T.ink2 }}>
                      Enviar prueba
                    </button>
                  )}
                  <p className="text-[10.5px] leading-snug" style={{ color: T.muted }}>
                    Suena cuando el agente propone. En iPhone: instala la app en pantalla de inicio.
                  </p>
                </div>
              </div>
              {/* conexión */}
              <div className="border-t px-4 py-3" style={{ borderColor: T.grid }}>
                <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
                  Conexión
                </p>
                <p className="text-[12px] leading-relaxed" style={{ color: T.ink2 }}>
                  {summary?.broker.detail ?? "—"}
                </p>
                <p className="mt-1 text-[10.5px]" style={{ color: T.muted }}>
                  El agente nunca ejecuta solo: cada orden requiere tu confirmación. Órdenes SIEMPRE a
                  límite (ref ± {cfg?.limit_buffer_pct ?? 0.2}%), nunca a mercado.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* velo de salida hacia la sala sombra */}
      <div aria-hidden
           className={`pointer-events-none fixed inset-0 z-[100] bg-slate-100 transition-opacity duration-[420ms] ease-in ${leaving ? "opacity-100" : "opacity-0"}`} />
    </div>
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
