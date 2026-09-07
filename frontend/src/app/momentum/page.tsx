"use client";

/** Sala Real X: descubrimiento de momentum, independiente del ranker fundamental (Sala Real).
 *  Nunca ejecuta en IBKR — solo alerta y sugiere, Manuel ejecuta a mano y lo reporta aquí.
 *  Ver docs/momentum-sala-real-x.md para el diseño completo. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, getFx } from "@/lib/api";
import { money } from "@/lib/format";
import {
  decidirCandidato, descartarSenal, ejecutarSenal, evaluarPendientesGate, getAlertas,
  getCandidatos, getCuenta, getHistorial, getUniverso, getValidacion, setMantenerUniverso,
} from "./api";
import { NUMS, T } from "./tokens";
import type { Candidato, Cuenta, Senal, UniversoTicker, Validacion } from "./types";

const TIPO_LABEL: Record<string, string> = {
  zigzag: "zigzag", suelo: "doble suelo", ambos: "zigzag + doble suelo",
};

function fmtFecha(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function fmtRet(v: number | string | null): string {
  if (v == null) return "—";
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Precio de hoy = precio de entrada × (1 + retorno actual). El backend no lo manda aparte
 *  porque `ret` ya es mark-to-market sobre `entry_price` — se deriva aquí, no se inventa. */
function precioHoy(s: Senal): number {
  return Number(s.entry_price) * (1 + Number(s.ret ?? 0) / 100);
}

export default function SalaMomentum() {
  return (
    <AuthGate>
      <SalaMomentumRoom />
    </AuthGate>
  );
}

function SalaMomentumRoom() {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [alertas, setAlertas] = useState<Senal[] | null>(null);
  const [historial, setHistorial] = useState<Senal[] | null>(null);
  const [validacion, setValidacion] = useState<Validacion[] | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [universo, setUniverso] = useState<UniversoTicker[] | null>(null);
  const [fx, setFx] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [histVisibles, setHistVisibles] = useState(5);

  // Recarga: re-pide datos y actualiza estado sin navegar ni desmontar la sala -- el scroll y
  // cualquier fila desplegada se quedan donde estaban. La primera carga (sin datos aún) usa
  // pantalla completa; un refresco posterior (botón "actualizar") pone un velo ENCIMA de lo que
  // ya hay, mismo criterio que Sala Real -- consistente como bloqueo de pantalla, sin perder
  // nada de lo que el usuario tenía abierto.
  const load = useCallback(async () => {
    try {
      const [c, a, h, v, cd, u, fxr] = await Promise.all([
        getCuenta(), getAlertas(), getHistorial(), getValidacion(), getCandidatos(), getUniverso(),
        getFx().catch(() => null),
      ]);
      setCuenta(c); setAlertas(a); setHistorial(h); setValidacion(v); setCandidatos(cd); setUniverso(u);
      if (fxr?.rate) setFx(fxr.rate);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sin conexión con el backend.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refrescar = useCallback(() => { setRefreshing(true); load(); }, [load]);

  useEffect(() => { load(); }, [load]);

  const activas = (alertas ?? []).filter((s) => s.estado === "nueva" || s.estado === "cuidado");
  const abiertas = (alertas ?? []).filter((s) => s.estado === "ejecutada");
  // Señales detectadas por el escaneo diario (gratis) que todavía no pasaron por el gate de
  // noticias (el único paso que gasta dinero real) -- ver doc §3, decidido 7-sep-2026.
  const pendientesGate = (alertas ?? []).filter((s) => s.gate_resultado == null);

  // Empate del día: 2+ señales NUEVAS con la misma fecha de entrada. Si alguna del grupo es
  // 'ambos' (zigzag+suelo coinciden), esa se recomienda; si no, se muestra el empate sin
  // destacar ninguna — decide Manuel (ver doc §4, decidido 7-sep-2026).
  const empatesPorFecha = useMemo(() => {
    const grupos = new Map<string, Senal[]>();
    for (const s of activas) {
      const g = grupos.get(s.entry_date) ?? [];
      g.push(s);
      grupos.set(s.entry_date, g);
    }
    return grupos;
  }, [activas]);

  const conectado = cuenta?.cash != null;

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 text-[13px]"
           style={{ background: T.page, color: T.muted }}>
        <span className="h-6 w-6 animate-spin rounded-full border-2"
              style={{ borderColor: T.grid, borderTopColor: T.entry }} />
        <p>Cargando Sala Real X…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-10 text-[13px] antialiased" style={{ background: T.page, color: T.ink2 }}>
      {/* Velo de bloqueo ENCIMA de la sala (no un return que la sustituya): un refresco manual
          no debe perder el scroll ni cerrar ninguna fila desplegada. */}
      {refreshing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 text-[13px]"
             style={{ background: `${T.page}f2` }}>
          <span className="h-6 w-6 animate-spin rounded-full border-2"
                style={{ borderColor: T.grid, borderTopColor: T.entry }} />
          <p style={{ color: T.muted }}>Actualizando…</p>
        </div>
      )}
      <header className="sticky top-0 z-40 border-b backdrop-blur"
              style={{ borderColor: T.ring, background: "rgba(13,13,13,0.92)" }}>
        <div className="mx-auto flex h-11 max-w-[900px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-[12px] transition-colors hover:underline" style={{ color: T.muted }}>
              ← Portada
            </Link>
            <span className="inline-flex items-center gap-2 text-[13px] font-bold tracking-tight" style={{ color: T.ink }}>
              <span className="h-2 w-2 rounded-full" style={{ background: error ? T.bad : T.entry }} />
              SALA REAL X
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold"
                  style={{ color: conectado ? T.good : T.warn }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: conectado ? T.good : T.warn }} />
              {conectado ? "IBKR conectado" : "IBKR sin conexión"}
            </span>
            <button onClick={refrescar} disabled={refreshing}
                    className="text-[11px] font-semibold transition-colors hover:underline disabled:opacity-50" style={{ color: T.entry }}>
              {refreshing ? "actualizando…" : "↻ actualizar"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[900px] px-4 pt-4">
        {error && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-[12.5px]"
               style={{ borderColor: "rgba(208,59,59,0.4)", background: "rgba(208,59,59,0.08)", color: "#e66767" }}>
            <span>{error}</span>
          </div>
        )}

        {/* ---------- Gate pendiente: primero de todo, invisible si no hay nada que decidir --------- */}
        {pendientesGate.length > 0 && <GatePendienteBanner señales={pendientesGate} onEvaluado={load} />}

        {/* ---------- Cuenta ---------- */}
        <Section title="Cuenta">
          <div className="space-y-2.5">
            <div className="rounded-xl border p-4" style={{ borderColor: T.ring, background: T.panel }}>
              <div className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: T.muted }}>Cash en cuenta</div>
              {cuenta?.cash ? (
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                  {Object.entries(cuenta.cash).map(([ccy, v]) => (
                    <div key={ccy} className={`text-[19px] font-extrabold ${NUMS}`} style={{ color: T.ink }}>
                      {money(v)} <span className="text-[12px] font-semibold" style={{ color: T.muted }}>{ccy}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-1.5 text-[13px]" style={{ color: T.muted }}>Sin credenciales IBKR configuradas.</div>
              )}
            </div>
            {cuenta?.cash && fx && (
              <div className="rounded-xl border p-4" style={{ borderColor: T.ring, background: T.panel }}>
                <div className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: T.muted }}>
                  Poder de compra combinado
                </div>
                {(() => {
                  const eur = Number(cuenta.cash.EUR ?? 0) + Number(cuenta.cash.USD ?? 0) / fx;
                  return (
                    <div className="mt-1 flex items-baseline gap-3">
                      <span className={`text-[19px] font-extrabold ${NUMS}`} style={{ color: T.ink }}>€{money(eur)}</span>
                      <span className={`text-[13px] font-semibold ${NUMS}`} style={{ color: T.muted }}>≈ ${money(eur * fx)}</span>
                    </div>
                  );
                })()}
                <p className="mt-1 text-[10px]" style={{ color: T.muted }}>EUR/USD {fx.toFixed(4)} (fx de hoy)</p>
              </div>
            )}
            <div className="rounded-xl border p-4" style={{ borderColor: T.ring, background: T.panel }}>
              <div className="flex items-baseline justify-between">
                <div className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: T.muted }}>
                  Capital momentum — sin slots
                </div>
                <div className="text-[10.5px]" style={{ color: T.muted }}>
                  de ${money(cuenta?.tope_usd ?? 0)} tope
                </div>
              </div>
              <div className={`mt-1 text-[19px] font-extrabold ${NUMS}`} style={{ color: T.ink }}>
                ${money(cuenta?.desplegado_usd ?? 0)}
                <span className="ml-1.5 text-[12px] font-semibold" style={{ color: T.muted }}>desplegado</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: T.grid }}>
                <div className="h-full rounded-full transition-all" style={{
                  background: T.entry,
                  width: `${Math.min(100, (Number(cuenta?.desplegado_usd ?? 0) / Math.max(1, Number(cuenta?.tope_usd ?? 1))) * 100)}%`,
                }} />
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed" style={{ color: T.muted }}>
                El reparto por posición es tuyo — sin tamaño sugerido en ninguna alerta.
              </p>
            </div>
          </div>
        </Section>

        {/* ---------- Alertas activas ---------- */}
        <Section title="Alertas activas" count={activas.length}>
          <p className="mb-2 text-[10.5px]" style={{ color: T.muted }}>
            Sin caducidad — pasados 21 días se marcan &quot;cuidado&quot; (p75 de días-a-objetivo entre las ganadoras históricas).
          </p>
          {activas.length === 0 ? (
            <Empty>Ninguna señal sin resolver ahora mismo.</Empty>
          ) : (
            <AlertasCarrusel alertas={activas} empates={empatesPorFecha} onDone={load} />
          )}
        </Section>

        {/* ---------- Posiciones abiertas ---------- */}
        <Section title="Posiciones abiertas" count={abiertas.length}>
          {abiertas.length === 0 ? (
            <Empty>Ninguna todavía — aparecerán aquí en cuanto marques una alerta como &quot;ejecutada&quot;.</Empty>
          ) : (
            <div className="space-y-2.5">
              {abiertas.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border px-3.5 py-3"
                     style={{ borderColor: T.ring, background: T.panel }}>
                  <div>
                    <b style={{ color: T.ink }}>{s.ticker}</b>
                    <span className="ml-2 text-[11px]" style={{ color: T.muted }}>
                      {TIPO_LABEL[s.tipo]} · entró {fmtFecha(s.entry_date)}
                    </span>
                  </div>
                  <span className={`font-bold ${NUMS}`}
                        style={{ color: Number(s.ret) >= 0 ? T.good : T.bad }}>
                    {fmtRet(s.ret)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ---------- Historial de señales ---------- */}
        <Section title="Historial de señales" count={historial?.length ?? 0}>
          <p className="mb-2 text-[10.5px]" style={{ color: T.muted }}>
            Resultado real del backtest para cada señal ya resuelta — el check marca si la
            ejecutaste de verdad o la dejaste pasar (para revisar tu criterio después).
          </p>
          <div className="rounded-xl border" style={{ borderColor: T.ring, background: T.panel }}>
            {(historial ?? []).slice(0, histVisibles).map((s, i) => {
              const ejecutada = s.estado === "ejecutada" || s.estado === "vendida";
              return (
                <div key={s.id} className="flex items-center gap-3 px-3.5 py-3"
                     style={i > 0 ? { borderTop: `1px solid ${T.grid}` } : undefined}>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
                        style={ejecutada
                          ? { background: T.entry, borderColor: T.entry }
                          : { borderColor: T.ring }}
                        title={ejecutada ? "La ejecutaste" : "No se ejecutó"}>
                    {ejecutada && (
                      <svg viewBox="0 0 16 16" className="h-3 w-3" stroke="#fff" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <b style={{ color: T.ink }}>{s.ticker}</b>
                    <span className="ml-2 text-[11px]" style={{ color: T.muted }}>
                      {TIPO_LABEL[s.tipo]} · {fmtFecha(s.entry_date)}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${NUMS}`} style={{ color: Number(s.ret) >= 0 ? T.good : T.bad }}>
                      {fmtRet(s.ret)}
                    </div>
                    <div className="text-[9.5px]" style={{ color: T.muted }}>{s.motivo}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {(historial?.length ?? 0) > histVisibles && (
            <CargarMasBtn onClick={() => setHistVisibles((n) => n + 5)}
                          restantes={(historial?.length ?? 0) - histVisibles} />
          )}
        </Section>

        {/* ---------- Validación histórica (colapsada) ---------- */}
        <Collapsible title="Validación histórica" count={validacion?.length ?? 0}>
          {(validacion ?? []).map((v, i) => (
            <ValidacionRow key={v.ticker} v={v} first={i === 0} onCambiado={load} />
          ))}
        </Collapsible>

        {/* ---------- Candidatos evaluados (colapsada) ---------- */}
        <Collapsible title="Candidatos evaluados" count={candidatos?.length ?? 0}>
          <p className="px-3.5 pb-2 pt-3 text-[11px] leading-relaxed" style={{ color: T.muted }}>
            Tickers fuera del universo actual que pasaron por el pipeline. Se guarda el rastro
            pase o no pase — la decisión final es siempre tuya.
          </p>
          {(candidatos?.length ?? 0) === 0 ? (
            <div className="px-3.5 pb-3.5 text-[12px]" style={{ color: T.muted }}>Ningún candidato evaluado todavía.</div>
          ) : (
            (candidatos ?? []).map((c, i) => <CandidatoRow key={c.id} c={c} first={i === 0} onDecidido={load} />)
          )}
        </Collapsible>

        {/* ---------- Universo vigilado (colapsada) ---------- */}
        <Collapsible title="Universo vigilado" count={universo?.length ?? 0}>
          <div className="flex flex-wrap gap-1.5 p-3.5">
            {(universo ?? []).map((u) => (
              <span key={u.ticker} className="rounded-full px-2.5 py-1 text-[11px]"
                    style={u.mantener
                      ? { background: T.base, color: T.ink2 }
                      : { background: "rgba(250,178,25,0.12)", color: T.warn, border: "1px solid rgba(250,178,25,0.3)" }}>
                <b style={{ color: u.mantener ? T.ink : T.warn }}>{u.ticker}</b> · {u.sector}
              </span>
            ))}
          </div>
        </Collapsible>
      </div>
    </div>
  );
}

/* ============================== piezas ============================== */

/** Carrusel horizontal deslizable (scroll-snap nativo, sin librería) — todas las alertas
 *  cargadas, sin paginar (con 34 tickers no hace falta, ver feedback 7-sep-2026). Los puntos
 *  reflejan la posición real de scroll. */
function AlertasCarrusel({ alertas, empates, onDone }: {
  alertas: Senal[]; empates: Map<string, Senal[]>; onDone: () => void;
}) {
  const [activo, setActivo] = useState(0);

  return (
    <div>
      <style>{`.momentum-carrusel::-webkit-scrollbar{display:none}`}</style>
      <div onScroll={(e) => setActivo(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
           className="momentum-carrusel flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1"
           style={{ scrollbarWidth: "none" }}>
        {alertas.map((s) => {
          const grupo = empates.get(s.entry_date) ?? [];
          return (
            <div key={s.id} className="w-full shrink-0 snap-start">
              <AlertaCard s={s} grupo={grupo} onDone={onDone} />
            </div>
          );
        })}
      </div>
      {alertas.length > 1 && (
        <div className="mt-2.5 flex justify-center gap-1.5">
          {alertas.map((_, i) => (
            <span key={i} className="h-1.5 rounded-full transition-all"
                  style={{ width: i === activo ? 14 : 5, background: i === activo ? T.entry : T.grid }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** El ÚNICO sitio de toda la sala donde se gasta dinero real — por eso es lo primero que se ve
 *  (mismo criterio que "Requiere decisión" en Sala Real) y por eso NUNCA se dispara solo:
 *  totalmente invisible si no hay nada pendiente, y el botón es el único gatillo (ver doc §3,
 *  decidido 7-sep-2026 -- el gate lo controla Manuel, no un cron). */
function GatePendienteBanner({ señales, onEvaluado }: { señales: Senal[]; onEvaluado: () => void }) {
  const [busy, setBusy] = useState(false);
  const [resumen, setResumen] = useState<{ pasan: number; fallan: number } | null>(null);

  const evaluar = async () => {
    setBusy(true);
    try {
      const { resultados } = await evaluarPendientesGate();
      const pasan = resultados.filter((r) => r.pasa).length;
      setResumen({ pasan, fallan: resultados.length - pasan });
      onEvaluado();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border p-4" style={{ borderColor: "rgba(250,178,25,0.35)", background: "rgba(250,178,25,0.06)" }}>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: T.warn }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.warn }}>Gate pendiente</span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: T.ink2 }}>
        <b style={{ color: T.ink }}>{señales.length} señal{señales.length === 1 ? "" : "es"}</b> detectada{señales.length === 1 ? "" : "s"} por
        el escaneo diario, sin evaluar todavía. Cada evaluación es una llamada real a DeepSeek
        (~$0,001-0,003 cada una) — no se dispara sola, decides tú cuándo.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {señales.map((s) => (
          <span key={s.id} className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: T.base, color: T.ink2 }}>
            <b style={{ color: T.ink }}>{s.ticker}</b>
          </span>
        ))}
      </div>
      {resumen ? (
        <p className="mt-3 text-[12px] font-semibold" style={{ color: T.ink }}>
          Evaluadas: <span style={{ color: T.good }}>{resumen.pasan} pasan</span>
          {" · "}
          <span style={{ color: T.bad }}>{resumen.fallan} fallan</span>
        </p>
      ) : (
        <button onClick={evaluar} disabled={busy}
                className="mt-3 w-full rounded-lg py-2 text-[12.5px] font-bold disabled:opacity-50"
                style={{ background: T.warn, color: "#3a2600" }}>
          {busy ? "Evaluando…" : `Evaluar ahora (${señales.length})`}
        </button>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-2 flex items-baseline justify-between text-[11px] font-bold uppercase tracking-wider"
         style={{ color: T.muted }}>
        {title}
        {count != null && <span className="font-normal normal-case" style={{ color: T.muted }}>{count}</span>}
      </p>
      {children}
    </div>
  );
}

/** Sección colapsada por defecto (Validación histórica / Candidatos / Universo en el mockup
 *  usan `<details>` sin `open`) — aquí con un botón para poder controlar el chevron a mano. */
function Collapsible({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6 rounded-xl border overflow-hidden" style={{ borderColor: T.ring, background: T.panel }}>
      <button onClick={() => setOpen((o) => !o)}
              className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-[12.5px] font-bold" style={{ color: T.ink2 }}>
          {title}{" "}
          {count != null && <span className="font-normal" style={{ color: T.muted }}>{count}</span>}
        </span>
        <span className="text-[11px] transition-transform" style={{ color: T.muted, transform: open ? "rotate(180deg)" : undefined }}>▾</span>
      </button>
      {open && <div className="border-t" style={{ borderColor: T.grid }}>{children}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border px-4 py-4 text-center text-[12px]"
         style={{ borderColor: T.ring, background: T.panel, color: T.muted }}>
      {children}
    </div>
  );
}

function CargarMasBtn({ onClick, restantes }: { onClick: () => void; restantes: number }) {
  return (
    <div className="mt-2 text-center">
      <button onClick={onClick}
              className="rounded-full border px-4 py-1.5 text-[11.5px] font-semibold transition-colors hover:bg-white/5"
              style={{ borderColor: T.ring, color: T.ink2 }}>
        Cargar 5 más ({restantes} ocultas)
      </button>
    </div>
  );
}

function AlertaCard({ s, grupo, onDone }: { s: Senal; grupo: Senal[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [acciones, setAcciones] = useState("");
  const [precio, setPrecio] = useState(String(s.entry_price));
  const [comision, setComision] = useState("0");
  const [busy, setBusy] = useState<"guardar" | "descartar" | null>(null);
  const [err, setErr] = useState("");

  const submit = async () => {
    const n = Number(acciones);
    if (!n || busy) return;
    setBusy("guardar"); setErr("");
    try {
      await ejecutarSenal(s.id, { accion: "compra", acciones: n, precio: Number(precio), comision: Number(comision) || 0 });
      setDone(true);
      // Confirmación visible un momento antes de recargar -- la recarga es en caliente
      // (solo re-pide datos, no navega ni pierde el scroll), así que no hay prisa.
      setTimeout(onDone, 1600);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo registrar la posición.");
      setBusy(null);
    }
  };

  const descartar = async () => {
    if (busy) return;
    setBusy("descartar");
    try {
      await descartarSenal(s.id);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo descartar.");
      setBusy(null);
    }
  };

  const esAmbos = grupo.some((g) => g.tipo === "ambos");

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "rgba(178,75,245,0.4)" }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: T.panel2, borderBottom: `1px solid ${T.grid}` }}>
        <span className="inline-flex items-center gap-1.5 text-[9.5px] font-extrabold uppercase tracking-wide" style={{ color: T.entry }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: T.entry }} />
          {TIPO_LABEL[s.tipo]}
        </span>
        <span className="text-[10px]" style={{ color: T.muted }}>
          {fmtFecha(s.entry_date)} · {s.dias}d{s.cuidado ? " · CUIDADO" : ""}
        </span>
      </div>
      <div className="p-3" style={{ background: T.panel }}>
        {grupo.length >= 2 && (
          <div className="mb-2 rounded-lg px-2.5 py-1.5 text-[10.5px] leading-snug"
               style={{ background: "rgba(178,75,245,0.12)", border: "1px solid rgba(178,75,245,0.3)", color: T.ink2 }}>
            <b style={{ color: T.entry }}>Empate del día —</b> {grupo.length} señales entraron hoy.{" "}
            {esAmbos && s.tipo === "ambos"
              ? "Esta es zigzag+suelo a la vez: la más fuerte del grupo."
              : esAmbos ? "Otra del grupo es zigzag+suelo — mira esa primero." : "Ninguna es zigzag+suelo, decides tú."}
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-[18px] font-extrabold" style={{ color: T.ink }}>
            {s.ticker} <span className="text-[11px] font-medium" style={{ color: T.muted }}>· {s.sector}</span>
          </span>
          <span className="text-[13px] font-extrabold" style={{ color: T.bad }}>−{Number(s.caida_pct).toFixed(1)}%</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-x-2 text-[12px]">
          <div>
            <span className="mr-1 text-[9px] uppercase" style={{ color: T.muted }}>Señal</span>
            <b className={NUMS} style={{ color: T.ink }}>${money(s.entry_price)}</b>
          </div>
          <div>
            <span className="mr-1 text-[9px] uppercase" style={{ color: T.muted }}>Hoy</span>
            <b className={NUMS} style={{ color: T.ink }}>${money(precioHoy(s))}</b>
            <div className={`text-[10.5px] font-bold ${NUMS}`} style={{ color: Number(s.ret) >= 0 ? T.good : T.bad }}>
              {fmtRet(s.ret)}
            </div>
          </div>
          <div>
            <span className="mr-1 text-[9px] uppercase" style={{ color: T.muted }}>
              {s.ref_label === "ATH_referencia" ? "ATH" : "Pico"}
            </span>
            <b className={NUMS} style={{ color: T.ink }}>${money(s.ref_price)}</b>
          </div>
        </div>
        <div className="mt-1.5 text-[11px]" style={{ color: T.muted }}>
          Gate:{" "}
          {s.gate_resultado == null ? <b style={{ color: T.warn }}>pendiente</b>
            : s.gate_resultado === "pasa" ? <b style={{ color: T.good }}>pasa</b>
            : <b style={{ color: T.bad }}>falla</b>}
          {s.gate_detalle && <span> — {s.gate_detalle}</span>}
        </div>

        {done ? (
          <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-bold"
               style={{ background: "rgba(12,163,12,0.14)", color: T.good }}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" stroke={T.good} fill="none" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
            Posición registrada
          </div>
        ) : !open ? (
          <div className="mt-2.5 flex gap-2">
            <button onClick={descartar} disabled={busy != null}
                    className="rounded-lg px-3 py-1.5 text-[12px] font-bold disabled:opacity-40"
                    style={{ background: "transparent", color: T.bad, border: "1px solid rgba(208,59,59,0.5)" }}>
              {busy === "descartar" ? "…" : "Descartar"}
            </button>
            <button onClick={() => setOpen(true)}
                    className="flex-1 rounded-lg py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: T.entry }}>
              Marcar ejecutada
            </button>
          </div>
        ) : (
          <div className="mt-2.5 border-t pt-2.5" style={{ borderColor: T.grid }}>
            <div className="grid grid-cols-3 gap-1.5">
              <FormField label="Acciones" value={acciones} onChange={setAcciones} placeholder="0" />
              <FormField label="Precio ($)" value={precio} onChange={setPrecio} />
              <FormField label="Comisión" value={comision} onChange={setComision} />
            </div>
            {err && <p className="mt-1.5 text-[11px]" style={{ color: T.bad }}>{err}</p>}
            <button onClick={submit} disabled={busy != null || !acciones}
                    className="mt-2 w-full rounded-lg py-1.5 text-[12px] font-bold disabled:opacity-40"
                    style={{ background: T.ink, color: T.page }}>
              {busy === "guardar" ? "Guardando…" : "Guardar posición"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[9px] uppercase tracking-wide" style={{ color: T.muted }}>{label}</label>
      <input type="number" value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)}
             className="w-full rounded-lg px-2 py-1.5 text-[13px] font-bold outline-none"
             style={{ background: T.base, border: `1px solid ${T.ring}`, color: T.ink }} />
    </div>
  );
}

/** Fila de Validación histórica: resumen siempre visible, checklist + nota + toggle "mantener
 *  en universo" al desplegar (mockup: `.valid-top` con onclick, colapsado por defecto). */
function ValidacionRow({ v, first, onCambiado }: { v: Validacion; first: boolean; onCambiado: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const revisar = v.n === 0 || v.n === 1 || (v.pct_positivas ?? 100) < 90;

  const toggleMantener = async () => {
    setBusy(true);
    try {
      await setMantenerUniverso(v.ticker, !v.mantener);
      onCambiado();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={!first ? { borderTop: `1px solid ${T.grid}` } : undefined}>
      <button onClick={() => setOpen((o) => !o)}
              className="flex w-full flex-col gap-1.5 px-3.5 py-3 text-left sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <b style={{ color: T.ink }}>{v.ticker}</b>
          <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                style={revisar
                  ? { background: "rgba(250,178,25,0.16)", color: T.warn }
                  : { background: "rgba(12,163,12,0.14)", color: T.good }}>
            {revisar ? "revisar" : "cumple"}
          </span>
          {!v.mantener && (
            <span className="text-[9px] font-bold uppercase" style={{ color: T.warn }}>fuera</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" style={{ color: T.muted }}>
          <span><b style={{ color: T.ink2 }}>{v.n}</b> señales</span>
          <span><b style={{ color: T.ink2 }}>{v.media != null ? fmtRet(v.media) : "—"}</b> media</span>
          <span><b style={{ color: T.ink2 }}>{v.pct_positivas ?? "—"}%</b> pos.</span>
        </div>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5">
          <p className="text-[11.5px] leading-relaxed" style={{ color: T.ink2 }}>
            {v.n === 0 ? "Cero entradas resueltas en el periodo."
              : v.n === 1 ? `Mediana ${fmtRet(v.mediana)}. Muestra insuficiente (n=1) para confiar en el patrón.`
              : revisar ? `Mediana ${fmtRet(v.mediana)}. ${v.pct_positivas}% de acierto — varianza más alta que el resto del universo.`
              : `Mediana ${fmtRet(v.mediana)}. ${v.n} entradas resueltas (${v.sector}), ${v.pct_positivas}% positivas. Sigue cumpliendo el criterio de admisión.`}
          </p>
          {revisar && (
            <div className="mt-2.5 flex items-center justify-between rounded-lg px-3 py-2" style={{ background: T.base }}>
              <span className="text-[12px] font-semibold" style={{ color: T.ink2 }}>Mantener en universo</span>
              <Toggle checked={v.mantener} onChange={toggleMantener} disabled={busy} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button onClick={onChange} disabled={disabled} aria-pressed={checked}
            className="relative h-[21px] w-9 shrink-0 rounded-full transition-colors disabled:opacity-50"
            style={{ background: checked ? T.entry : T.grid }}>
      <span className="absolute top-[2px] h-[17px] w-[17px] rounded-full bg-white transition-transform"
            style={{ transform: checked ? "translateX(17px)" : "translateX(2px)" }} />
    </button>
  );
}

/** Candidato: resumen (ticker + decisión) siempre visible, checklist completo al desplegar
 *  (mockup: `.valid-row`/`.valid-top`, colapsado por defecto). */
function CandidatoRow({ c, first, onDecidido }: { c: Candidato; first: boolean; onDecidido: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"incorporado" | "descartado" | null>(null);

  const decidir = async (decision: "incorporado" | "descartado") => {
    setBusy(decision);
    try {
      await decidirCandidato(c.id, decision);
      onDecidido();
    } finally {
      setBusy(null);
    }
  };

  const check = (v: boolean | number | null, label: string, detalle: string) => (
    <div className="flex gap-2">
      <span className="shrink-0" style={{ color: v ? T.good : T.bad }}>{v ? "✓" : "✗"}</span>
      <div className="min-w-0">
        <span className="font-semibold" style={{ color: T.ink2 }}>{label}</span>
        <span className="ml-1" style={{ color: T.muted }}>{detalle}</span>
      </div>
    </div>
  );

  return (
    <div style={!first ? { borderTop: `1px solid ${T.grid}` } : undefined}>
      <button onClick={() => setOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left">
        <div className="min-w-0">
          <b style={{ color: T.ink }}>{c.ticker}</b>
          <span className="ml-2 text-[11px]" style={{ color: T.muted }}>{c.nombre}</span>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
              style={c.decision === "incorporado"
                ? { background: "rgba(12,163,12,0.14)", color: T.good }
                : { background: "rgba(250,178,25,0.16)", color: T.warn }}>
          {c.decision}
        </span>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5">
          <div className="space-y-2 text-[11.5px] leading-relaxed">
            {check(c.filtro_sector_pass, "Sector", c.filtro_sector_detalle)}
            {check(c.estadistica_pass, "Estadística", c.estadistica_detalle)}
            {check(c.gate_pass, "Gate fundamental", c.gate_detalle)}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => decidir("incorporado")} disabled={busy != null || c.decision === "incorporado"}
                    className="flex-1 rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-40"
                    style={{ background: "rgba(12,163,12,0.14)", color: T.good, border: "1px solid rgba(12,163,12,0.35)" }}>
              {busy === "incorporado" ? "…" : "Incorporar"}
            </button>
            <button onClick={() => decidir("descartado")} disabled={busy != null || c.decision === "descartado"}
                    className="flex-1 rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-40"
                    style={{ background: "transparent", color: T.bad, border: "1px solid rgba(208,59,59,0.5)" }}>
              {busy === "descartado" ? "…" : "Mantener fuera"}
            </button>
          </div>
          <p className="mt-2 text-[10px]" style={{ color: T.muted }}>
            {c.decidido_por === "manual" ? "Decisión tuya." : "Propuesta del sistema — decides tú."}
          </p>
        </div>
      )}
    </div>
  );
}
