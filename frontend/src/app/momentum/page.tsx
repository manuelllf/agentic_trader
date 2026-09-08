"use client";

/** Sala Real X: descubrimiento de momentum, independiente del ranker fundamental (Sala Real).
 *  Nunca ejecuta en IBKR — solo alerta y sugiere, Manuel ejecuta a mano y lo reporta aquí.
 *  Ver docs/momentum-sala-real-x.md para el diseño completo. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, getFx } from "@/lib/api";
import { money, signMoney } from "@/lib/format";
import {
  adminDetectarCandidatos, adminScan, buscarCandidato, comprobarFiltrosCandidato,
  crearCandidatoManual, decidirCandidato, descartarSenal, ejecutarSenal, getAlertas,
  getCandidatos, getCuenta, getGateProgreso, getHistorial, getValidacion,
  lanzarGate, lanzarGateCandidato, setMantenerUniverso,
} from "./api";
import type { GateProgreso } from "./api";
import { MONO, NUMS, SANS, T } from "./tokens";
import type { Candidato, Cuenta, Senal, Validacion } from "./types";

const TIPO_LABEL: Record<string, string> = {
  zigzag: "zigzag", suelo: "doble suelo", ambos: "zigzag + doble suelo",
};

function fmtFecha(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function fmtRet(v: number | string | null): string {
  if (v == null) return "-";
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
  const [fx, setFx] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  const [detectando, setDetectando] = useState(false);
  const [detectMsg, setDetectMsg] = useState("");
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [histVisibles, setHistVisibles] = useState(5);

  // Recarga: re-pide datos y actualiza estado sin navegar ni desmontar la sala -- el scroll y
  // cualquier fila desplegada se quedan donde estaban. La primera carga (sin datos aún) usa
  // pantalla completa; un refresco posterior (botón "actualizar") pone un velo ENCIMA de lo que
  // ya hay, mismo criterio que Sala Real -- consistente como bloqueo de pantalla, sin perder
  // nada de lo que el usuario tenía abierto.
  const load = useCallback(async () => {
    try {
      const [c, a, h, v, cd, fxr] = await Promise.all([
        getCuenta(), getAlertas(), getHistorial(), getValidacion(), getCandidatos(),
        getFx().catch(() => null),
      ]);
      setCuenta(c); setAlertas(a); setHistorial(h); setValidacion(v); setCandidatos(cd);
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

  // Rescate manual del escaneo diario (cron 16:45 ET): gratis, sin gate. Separado de
  // "actualizar" a propósito -- ese solo relee lo que ya hay, esto hace ~34 llamadas a yfinance.
  const escanear = async () => {
    setScanning(true);
    setScanMsg("");
    try {
      const r = await adminScan();
      setScanMsg(r.ok ? `${r.nuevas} señal(es) nueva(s) de ${r.total_universo} revisadas.` : `Error: ${r.error}`);
      if (r.ok) await load();
    } catch (e) {
      setScanMsg(e instanceof ApiError ? e.message : "No se pudo lanzar el escaneo.");
    } finally {
      setScanning(false);
    }
  };

  // Rescate manual de la detección diaria de ApeWisdom (cron 16:10 ET): gratis, sin gate.
  const detectarCandidatos = async () => {
    setDetectando(true);
    setDetectMsg("");
    try {
      const r = await adminDetectarCandidatos();
      setDetectMsg(r.ok ? `${r.nuevos} candidato(s) nuevo(s) detectado(s).` : `Error: ${r.error}`);
      if (r.ok) await load();
    } catch (e) {
      setDetectMsg(e instanceof ApiError ? e.message : "No se pudo lanzar la detección.");
    } finally {
      setDetectando(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  const activas = (alertas ?? []).filter((s) => s.estado === "nueva" || s.estado === "cuidado");
  const abiertas = (alertas ?? []).filter((s) => s.estado === "ejecutada");
  // Señales detectadas por el escaneo diario (gratis) que todavía no pasaron por el gate de
  // noticias (el único paso que gasta dinero real) -- ver doc §3, decidido 7-sep-2026.
  const pendientesGate = (alertas ?? []).filter((s) => s.gate_resultado == null);
  // Candidatos detectados por ApeWisdom, sin decisión todavía, vs. los ya evaluados (con o
  // sin gate) -- la decisión es lo único que separa "por revisar" de "evaluados" (ver doc §1).
  const candidatosPorRevisar = (candidatos ?? []).filter((c) => c.decision === "pendiente");
  const candidatosEvaluados = (candidatos ?? []).filter((c) => c.decision !== "pendiente");
  // De los "por revisar", cuáles ya pasaron sector+estadística y solo les falta el gate -- se
  // recuerda arriba junto al otro gasto real para que no se pierdan al fondo de un acordeón.
  const candidatosListos = candidatosPorRevisar.filter((c) => c.filtro_sector_pass && c.estadistica_pass);

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
    <div className="min-h-[100dvh] pb-10 text-[13px] antialiased" style={{ background: T.page, color: T.ink2, fontFamily: SANS }}>
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
        <div className="mx-auto flex min-h-11 max-w-[900px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-[12px] transition-colors hover:underline" style={{ color: T.muted }}>
              ← Portada
            </Link>
            <span className="inline-flex items-center gap-2 text-[13px] font-bold tracking-tight" style={{ color: T.ink }}>
              <span className="h-2 w-2 rounded-full" style={{ background: error ? T.bad : T.entry }} />
              SALA REAL X
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-[10.5px] font-bold"
                style={{ color: conectado ? T.good : T.warn }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: conectado ? T.good : T.warn }} />
            <span className="hidden sm:inline">{conectado ? "IBKR conectado" : "IBKR sin conexión"}</span>
          </span>
        </div>
        {/* Fila propia, centrada -- cada acción se distingue por su texto, no por un color
            arbitrario (antes: iconos solos + leyenda aparte explicándolos, redundante). */}
        <div className="mx-auto flex max-w-[900px] flex-wrap justify-center gap-2 px-4 pb-2.5">
          <ActionChip onClick={escanear} busy={scanning} label="Recalcular señales"
                      title="Recalcular señales ahora (gratis, por si el cron 16:05 ET no ha corrido)">
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
          </ActionChip>
          <ActionChip onClick={detectarCandidatos} busy={detectando} label="Detectar rupturas"
                      title="Fuerza la detección de rupturas de ApeWisdom ahora (gratis, por si el cron 16:10 ET no ha corrido). Automático: solo mira lo que ApeWisdom ya trae."
                      stroke>
            <path d="M2 13h3l2-7 3 15 3-11 2 3h5" />
          </ActionChip>
          <ActionChip onClick={() => setBuscadorAbierto(true)} label="Añadir ticker"
                      title="Añade o revisa un ticker a mano, sin esperar a ApeWisdom" stroke>
            <circle cx="10" cy="10" r="6.5" />
            <path d="M20 20l-4.3-4.3M10 7v6M7 10h6" />
          </ActionChip>
          <ActionChip onClick={refrescar} busy={refreshing} label="Actualizar" stroke>
            <path d="M3 12a9 9 0 0 1 15.3-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.3 6.3L3 16M3 21v-5h5" />
          </ActionChip>
        </div>
        {scanMsg && <AvisoTemporal texto={scanMsg} onCerrar={() => setScanMsg("")} />}
        {detectMsg && <AvisoTemporal texto={detectMsg} onCerrar={() => setDetectMsg("")} />}
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
        {/* Recordatorio aparte: candidatos listos para el gate no dependen de que haya señales
            pendientes -- si no, se pierden al fondo del acordeón de Candidatos (ver doc). */}
        {candidatosListos.length > 0 && (
          <p className="mb-6 flex items-center gap-2 text-[11.5px]" style={{ color: T.muted }}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: T.good }} />
            {candidatosListos.length} candidato{candidatosListos.length === 1 ? "" : "s"} de ApeWisdom ya{" "}
            {candidatosListos.length === 1 ? "pasó" : "pasaron"} sus filtros y{" "}
            {candidatosListos.length === 1 ? "espera" : "esperan"} tu gate:{" "}
            <a href="#candidatos" className="font-semibold" style={{ color: T.good }}>
              {candidatosListos.map((c) => c.ticker).join(", ")} ↓
            </a>
          </p>
        )}

        {/* ---------- Cuenta: el resultado manda, la mecánica de cuenta es contexto detrás ---------- */}
        <Section title="Cuenta">
          {(() => {
            const pnlAbUsd = Number(cuenta?.pnl_abierto_usd ?? 0);
            const pnlReUsd = Number(cuenta?.pnl_realizado_usd ?? 0);
            const signoTotal = pnlAbUsd + pnlReUsd >= 0 ? T.good : T.bad;
            const eur = cuenta?.cash && fx ? Number(cuenta.cash.EUR ?? 0) + Number(cuenta.cash.USD ?? 0) / fx : null;
            return (
              <>
                <div className="rounded-xl border p-4" style={{ borderColor: T.ring, background: T.panel, borderTop: `2px solid ${signoTotal}` }}>
                  <div className="flex gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: T.muted }}>Capital total</div>
                      <div className={`mt-1 text-[18px] font-bold ${NUMS}`} style={{ color: T.ink }}>${money(cuenta?.desplegado_usd ?? 0)}</div>
                    </div>
                    <div className="min-w-0 flex-1 border-l pl-3" style={{ borderColor: T.grid }}>
                      <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: T.muted }}>PnL abierto</div>
                      <div className={`mt-1 text-[18px] font-bold ${NUMS}`} style={{ color: pnlAbUsd >= 0 ? T.good : T.bad }}>
                        {signMoney(pnlAbUsd)}
                      </div>
                      <div className={`text-[10.5px] ${NUMS}`} style={{ color: pnlAbUsd >= 0 ? T.good : T.bad }}>
                        {fmtRet(cuenta?.pnl_abierto_pct ?? null)}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 border-l pl-3" style={{ borderColor: T.grid }}>
                      <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: T.muted }}>PnL realizado</div>
                      <div className={`mt-1 text-[18px] font-bold ${NUMS}`} style={{ color: pnlReUsd >= 0 ? T.good : T.bad }}>
                        {signMoney(pnlReUsd)}
                      </div>
                      <div className={`text-[10.5px] ${NUMS}`} style={{ color: pnlReUsd >= 0 ? T.good : T.bad }}>
                        {fmtRet(cuenta?.pnl_realizado_pct ?? null)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="rounded-lg border p-2.5" style={{ borderColor: T.ring, background: T.panel }}>
                    <div className="text-[8.5px] font-bold uppercase tracking-wide" style={{ color: T.muted }}>Cash</div>
                    {cuenta?.cash ? (
                      <div className={`mt-1 text-[13px] font-bold ${NUMS}`} style={{ color: T.ink }}>
                        {money(cuenta.cash.EUR ?? 0, 0)} <span className="text-[9px] font-medium" style={{ color: T.muted }}>EUR</span>
                      </div>
                    ) : (
                      <div className="mt-1 text-[10.5px]" style={{ color: T.muted }}>sin IBKR</div>
                    )}
                  </div>
                  <div className="rounded-lg border p-2.5" style={{ borderColor: T.ring, background: T.panel }}>
                    <div className="text-[8.5px] font-bold uppercase tracking-wide" style={{ color: T.muted }}>Poder compra</div>
                    <div className={`mt-1 text-[13px] font-bold ${NUMS}`} style={{ color: T.ink }}>
                      {eur != null ? `€${money(eur, 0)}` : "-"}
                    </div>
                    {eur != null && fx && (
                      <div className={`text-[8.5px] ${NUMS}`} style={{ color: T.muted }}>≈ ${money(eur * fx, 0)}</div>
                    )}
                  </div>
                  <div className="rounded-lg border p-2.5" style={{ borderColor: T.ring, background: T.panel }}
                       title={`${cuenta?.gate_llamadas ?? 0} llamada(s) real(es) a DeepSeek, señales + candidatos`}>
                    <div className="text-[8.5px] font-bold uppercase tracking-wide" style={{ color: T.muted }}>Gate gasto</div>
                    <div className={`mt-1 text-[13px] font-bold ${NUMS}`} style={{ color: T.warn }}>
                      ${money(cuenta?.gate_gastado_usd ?? 0, 2)}
                    </div>
                    <div className="text-[8.5px]" style={{ color: T.muted }}>{cuenta?.gate_llamadas ?? 0} llam.</div>
                  </div>
                </div>
              </>
            );
          })()}
        </Section>

        {/* ---------- Alertas activas ---------- */}
        <Section title="Alertas activas" count={activas.length}>
          <p className="mb-2 text-[10.5px]" style={{ color: T.muted }}>
            Sin caducidad: pasados 21 días se marcan &quot;cuidado&quot; (p75 de días-a-objetivo entre las ganadoras históricas).
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
            <Empty>Ninguna todavía: aparecerán aquí en cuanto marques una alerta como &quot;ejecutada&quot;.</Empty>
          ) : (
            <div className="space-y-2.5">
              {abiertas.map((s) => {
                // Sin objetivo fijo por precio (son tramos, ver doc §3) -- lo único que se puede
                // avisar sin inventar un progreso falso es cuánto queda del tope real de 90 días.
                const cercaDelTope = s.dias != null && s.dias >= 80;
                return (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border px-3.5 py-3"
                       style={{ borderColor: cercaDelTope ? "rgba(250,178,25,0.4)" : T.ring, background: T.panel }}>
                    <div>
                      <b style={{ color: T.ink }}>{s.ticker}</b>
                      <span className="ml-2 text-[11px]" style={{ color: T.muted }}>
                        {TIPO_LABEL[s.tipo]} · entró {fmtFecha(s.entry_date)}
                        {s.dias != null && ` · ${s.dias}d abierta`}
                      </span>
                      {cercaDelTope && (
                        <div className="mt-0.5 text-[10.5px] font-semibold" style={{ color: T.warn }}>
                          cerca del tope de 90 días
                        </div>
                      )}
                    </div>
                    <span className={`font-bold ${NUMS}`}
                          style={{ color: Number(s.ret) >= 0 ? T.good : T.bad }}>
                      {fmtRet(s.ret)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* ---------- Historial de señales ---------- */}
        <Section title="Historial de señales" count={historial?.length ?? 0}>
          <p className="mb-2 text-[10.5px]" style={{ color: T.muted }}>
            Resultado real del backtest para cada señal ya resuelta: el check marca si la
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

        {/* ---------- Candidatos: "por revisar" + "evaluados" en un módulo, dos pestañas
            (antes eran dos acordeones separados) -- justo antes de Universo, que es a donde
            van a parar si se incorporan. */}
        <div id="candidatos">
          <Collapsible title="Candidatos" count={`${candidatosPorRevisar.length} por revisar · ${candidatosEvaluados.length} evaluados`}>
            <p className="px-3.5 pb-2 pt-3 text-[11px] leading-relaxed" style={{ color: T.muted }}>
              Tickers fuera del universo fijo, con dos entradas posibles: ApeWisdom los trae solo
              (&quot;Detectar rupturas&quot;, menciones sociales) o los metes tú a mano
              (&quot;Añadir ticker&quot;). Sector y estadística son automáticos; el gate es la
              única llamada real, siempre candidato a candidato.
            </p>
            <CandidatosTabs porRevisar={candidatosPorRevisar} evaluados={candidatosEvaluados} onCambiado={load} />
          </Collapsible>
        </div>

        {/* ---------- Universo: fusiona "Validación histórica" + "Universo vigilado" en una
            sola tabla (antes los mismos 34 tickers se repetían en dos acordeones) ---------- */}
        <Collapsible title="Universo" count={validacion?.length ?? 0}>
          <p className="px-3.5 pb-2 pt-3 text-[11px] leading-relaxed" style={{ color: T.muted }}>
            Los 34 tickers fijos con su resultado real acumulado. El interruptor decide si sigues
            vigilando ese ticker o lo apartas (el código nunca lo borra).
          </p>
          <UniversoTabla validacion={validacion ?? []} onCambiado={load} />
        </Collapsible>
      </div>
      {buscadorAbierto && (
        <CandidatoBuscadorModal onClose={() => setBuscadorAbierto(false)} onCambiado={load} />
      )}
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
  const [progreso, setProgreso] = useState<GateProgreso | null>(null);
  const [seleccionadas, setSeleccionadas] = useState<Set<number>>(() => new Set(señales.map((s) => s.id)));
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Lista nueva (recarga tras evaluar, señal nueva del cron) -- selección "todas" por defecto,
  // sin heredar huecos de una selección anterior que ya no aplica.
  const idsKey = señales.map((s) => s.id).join(",");
  useEffect(() => {
    setSeleccionadas(new Set(señales.map((s) => s.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const parar = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Sondeo real (`/gate/progreso`) -- varias llamadas en serie tardan minutos, así que nunca se
  // espera la respuesta del lanzamiento, se pregunta aparte cada 3s (mismo patrón que el
  // escaneo del ranker, ver `CentroOperaciones.tsx`).
  const sondear = useCallback(async () => {
    try {
      const p = await getGateProgreso();
      setProgreso(p);
      if (p.status !== "running") {
        parar();
        onEvaluado();
      }
    } catch { /* fallo puntual de red no corta el sondeo */ }
  }, [onEvaluado, parar]);

  // Al entrar (o recargar a mitad): si ya había un gate corriendo, retoma el sondeo solo.
  useEffect(() => {
    getGateProgreso().then((p) => {
      setProgreso(p);
      if (p.status === "running") pollRef.current = setInterval(sondear, 3000);
    }).catch(() => {});
    return parar;
  }, [sondear, parar]);

  const toggle = (id: number) => {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const evaluar = async () => {
    const ids = Array.from(seleccionadas);
    const r = await lanzarGate(ids);
    if (!r.lanzado) { sondear(); return; }
    setProgreso({ status: "running", total: ids.length, hecho: 0, ok: 0, fail: 0, ticker_actual: null, error: null });
    pollRef.current = setInterval(sondear, 3000);
  };

  const corriendo = progreso?.status === "running";

  return (
    <div className="mb-6 rounded-xl border p-4" style={{ borderColor: "rgba(250,178,25,0.35)", background: "rgba(250,178,25,0.06)" }}>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: T.warn }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.warn }}>Gate pendiente: señales del universo</span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: T.ink2 }}>
        <b style={{ color: T.ink }}>{señales.length} señal{señales.length === 1 ? "" : "es"}</b> del
        universo fijo, detectada{señales.length === 1 ? "" : "s"} por el escaneo diario, sin evaluar.
        Cada evaluación es una llamada real a DeepSeek (~$0,001-0,003); toca una para quitarla,
        decides tú cuáles entran.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {señales.map((s) => {
          const on = seleccionadas.has(s.id);
          return (
            <button key={s.id} onClick={() => toggle(s.id)} disabled={corriendo}
                    className="rounded-full px-2 py-0.5 text-[10.5px] transition disabled:opacity-60"
                    style={on
                      ? { background: T.base, color: T.ink2 }
                      : { background: "transparent", color: T.muted, border: `1px solid ${T.grid}` }}>
              <b style={{ color: on ? T.ink : T.muted }}>{s.ticker}</b>
            </button>
          );
        })}
      </div>
      {corriendo && progreso ? (
        <div className="mt-3 rounded-lg py-2 text-center text-[12.5px] font-bold" style={{ background: T.warn, color: "#3a2600" }}>
          Evaluando {progreso.hecho}/{progreso.total}
          {progreso.ticker_actual ? ` · ${progreso.ticker_actual}` : ""}…
        </div>
      ) : (
        <button onClick={evaluar} disabled={seleccionadas.size === 0}
                className="mt-3 w-full rounded-lg py-2 text-[12.5px] font-bold disabled:opacity-40"
                style={{ background: T.warn, color: "#3a2600" }}>
          Evaluar seleccionadas ({seleccionadas.size})
        </button>
      )}
    </div>
  );
}

/** Botón de acción con icono + texto -- reemplaza los 4 iconos-solo + leyenda aparte de antes.
 *  Sin color propio: el texto ya dice lo que hace, ningún tono decorativo que aprender. */
function ActionChip({ onClick, label, title, busy, stroke, children }: {
  onClick: () => void; label: string; title?: string; busy?: boolean; stroke?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={busy} title={title}
            className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition active:opacity-60 disabled:opacity-50"
            style={{ borderColor: T.grid, background: T.panel2, color: T.ink2 }}>
      <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 shrink-0 ${busy ? (stroke ? "animate-spin" : "animate-pulse") : ""}`}
           fill={stroke ? "none" : "currentColor"}
           stroke={stroke ? "currentColor" : undefined}
           strokeWidth={stroke ? 2.2 : undefined} strokeLinecap={stroke ? "round" : undefined} strokeLinejoin={stroke ? "round" : undefined}>
        {children}
      </svg>
      {label}
    </button>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-2 flex items-baseline justify-between text-[11px] font-bold uppercase tracking-wider"
         style={{ color: T.muted }}>
        <span><span className="mr-1 font-semibold normal-case">{"›"}</span>{title}</span>
        {count != null && <span className="font-normal normal-case" style={{ color: T.muted }}>{count}</span>}
      </p>
      {children}
    </div>
  );
}

/** Sección colapsada por defecto (Validación histórica / Candidatos / Universo en el mockup
 *  usan `<details>` sin `open`) — aquí con un botón para poder controlar el chevron a mano. */
function Collapsible({ title, count, children }: { title: string; count?: number | string; children: React.ReactNode }) {
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
  // Color real, no decorativo: el punto junto al ticker es el estado del gate de esta señal.
  const puntoEstado = s.gate_resultado === "pasa" ? T.good : s.gate_resultado === "falla" ? T.bad : T.muted;

  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: T.ring, background: T.panel }}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: puntoEstado }} />
          <span className={`text-[17px] font-bold ${MONO}`} style={{ color: T.ink }}>{s.ticker}</span>
          <span className="text-[10.5px]" style={{ color: T.muted }}>{s.sector}</span>
        </div>
        <div className="shrink-0 whitespace-nowrap text-right text-[9.5px] leading-tight" style={{ color: T.muted }}>
          <div className="font-semibold uppercase tracking-wide" style={{ color: T.ink2 }}>{TIPO_LABEL[s.tipo]}</div>
          <div>{s.cuidado && <b style={{ color: T.warn }}>CUIDADO · </b>}{fmtFecha(s.entry_date)} · {s.dias}d</div>
        </div>
      </div>

      {grupo.length >= 2 && (
        <div className="my-2 flex gap-1.5 border-y py-1.5 text-[10px] leading-snug" style={{ borderColor: T.grid, color: T.ink2 }}>
          <span className={`shrink-0 font-bold ${MONO}`} style={{ color: T.warn }}>i</span>
          <span>
            Empate del día: {grupo.length} señales entraron hoy.{" "}
            {esAmbos && s.tipo === "ambos"
              ? "Esta es zigzag+suelo a la vez: la más fuerte del grupo."
              : esAmbos ? "Otra del grupo es zigzag+suelo, mira esa primero." : "Ninguna es zigzag+suelo, decides tú."}
          </span>
        </div>
      )}

      <div className="mt-2 text-[12px]" style={{ color: T.ink2 }}>
        <b className={NUMS} style={{ color: T.bad }}>-{Number(s.caida_pct).toFixed(1)}%</b> bajo el{" "}
        <span style={{ color: T.muted }}>
          {s.ref_label === "ATH_referencia" ? "ATH" : "último pico"} (${money(s.ref_price)})
        </span>
      </div>

      <div className="mt-2.5 flex border-t pt-2.5 text-[12px]" style={{ borderColor: T.grid }}>
        <div className="min-w-0 flex-1">
          <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>Señal</div>
          <b className={NUMS} style={{ color: T.ink }}>${money(s.entry_price)}</b>
        </div>
        <div className="min-w-0 flex-1 border-l pl-2.5" style={{ borderColor: T.grid }}>
          <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>Hoy</div>
          <b className={NUMS} style={{ color: T.ink }}>${money(precioHoy(s))}</b>
        </div>
        <div className="min-w-0 flex-1 border-l pl-2.5" style={{ borderColor: T.grid }}>
          <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>Retorno</div>
          <b className={NUMS} style={{ color: Number(s.ret) >= 0 ? T.good : T.bad }}>{fmtRet(s.ret)}</b>
        </div>
      </div>

      <div className="mt-2 text-[11px]" style={{ color: T.muted }}>
        Gate:{" "}
        {s.gate_resultado == null ? <b style={{ color: T.warn }}>pendiente</b>
          : s.gate_resultado === "pasa" ? <b style={{ color: T.good }}>pasa</b>
          : <b style={{ color: T.bad }}>falla</b>}
        {s.gate_detalle && <span>. {s.gate_detalle}</span>}
      </div>

      {done ? (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-bold"
             style={{ background: "rgba(51,193,90,0.14)", color: T.good }}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" stroke={T.good} fill="none" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
          Posición registrada
        </div>
      ) : !open ? (
        <div className="mt-2.5 flex gap-2">
          <button onClick={descartar} disabled={busy != null}
                  className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                  style={{ background: "transparent", borderColor: T.grid, color: T.ink2 }}>
            {busy === "descartar" ? "…" : "Descartar"}
          </button>
          <button onClick={() => setOpen(true)}
                  className="flex-1 rounded-lg border py-1.5 text-[12px] font-bold"
                  style={{ background: T.panel2, borderColor: T.grid, color: T.ink }}>
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

/** Universo: fusiona lo que antes eran "Validación histórica" + "Universo vigilado" (mismos
 *  34 tickers repetidos en dos acordeones) en una sola tabla. Cada fila se despliega para el
 *  diagnóstico + el toggle "mantener" -- ese solo importa en los bordes (revisar), no en los
 *  34 a la vez, así que no hace falta un interruptor permanente por fila. */
function UniversoTabla({ validacion, onCambiado }: { validacion: Validacion[]; onCambiado: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr style={{ color: T.muted }}>
            {["Ticker", "Sector", "n", "Media", "% pos"].map((h, i) => (
              <th key={h} className={`whitespace-nowrap px-2.5 pb-2 text-[9px] font-bold uppercase tracking-wide ${i >= 2 ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {validacion.map((v, i) => <UniversoRow key={v.ticker} v={v} first={i === 0} onCambiado={onCambiado} />)}
        </tbody>
      </table>
    </div>
  );
}

function UniversoRow({ v, first, onCambiado }: { v: Validacion; first: boolean; onCambiado: () => void }) {
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

  const celda = "px-2.5 py-2";
  const borde = !first ? { borderTop: `1px solid ${T.grid}` } : undefined;

  return (
    <>
      <tr onClick={() => setOpen((o) => !o)} className="cursor-pointer" style={borde}>
        <td className={`${celda} ${MONO} font-semibold`} style={{ color: v.mantener ? T.ink : T.warn }}>{v.ticker}</td>
        <td className={celda} style={{ color: T.muted }}>{v.sector}</td>
        <td className={`${celda} ${NUMS} text-right`} style={{ color: T.ink2 }}>{v.n}</td>
        <td className={`${celda} ${NUMS} text-right`} style={{ color: v.media == null ? T.muted : v.media >= 0 ? T.good : T.bad }}>
          {v.media != null ? fmtRet(v.media) : "-"}
        </td>
        <td className={`${celda} ${NUMS} text-right`} style={{ color: T.ink2 }}>{v.pct_positivas ?? "-"}{v.pct_positivas != null && "%"}</td>
        <td className={`${celda} text-right`} style={{ color: T.muted }}>{open ? "▴" : "▾"}</td>
      </tr>
      {open && (
        <tr style={{ background: T.panel2 }}>
          <td colSpan={6} className="px-2.5 pb-3 pt-1">
            <p className="text-[11.5px] leading-relaxed" style={{ color: T.ink2 }}>
              {v.n === 0 ? "Cero entradas resueltas en el periodo."
                : v.n === 1 ? `Mediana ${fmtRet(v.mediana)}. Muestra insuficiente (n=1) para confiar en el patrón.`
                : revisar ? `Mediana ${fmtRet(v.mediana)}. ${v.pct_positivas}% de acierto: varianza más alta que el resto del universo.`
                : `Mediana ${fmtRet(v.mediana)}. ${v.n} entradas resueltas (${v.sector}), ${v.pct_positivas}% positivas. Sigue cumpliendo el criterio de admisión.`}
            </p>
            {revisar && (
              <div className="mt-2.5 flex items-center justify-between rounded-lg px-3 py-2" style={{ background: T.base }}>
                <span className="text-[12px] font-semibold" style={{ color: T.ink2 }}>Mantener en universo</span>
                <Toggle checked={v.mantener} onChange={toggleMantener} disabled={busy} />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button onClick={onChange} disabled={disabled} aria-pressed={checked}
            className="relative h-[21px] w-9 shrink-0 rounded-full transition-colors disabled:opacity-50"
            style={{ background: checked ? T.entry : T.grid }}>
      <span className="absolute left-[2px] top-[2px] h-[17px] w-[17px] rounded-full bg-white transition-transform"
            style={{ transform: checked ? "translateX(15px)" : "translateX(0)" }} />
    </button>
  );
}

/** Mensaje de resultado bajo la cabecera (escaneo/detección manual): se borra solo a los 6s,
 *  o al momento con la X -- antes se quedaba pegado hasta el siguiente clic en ese botón. */
function AvisoTemporal({ texto, onCerrar }: { texto: string; onCerrar: () => void }) {
  useEffect(() => {
    const t = setTimeout(onCerrar, 6000);
    return () => clearTimeout(t);
  }, [texto, onCerrar]);

  return (
    <div className="mx-auto flex max-w-[900px] items-center justify-between gap-2 px-4 pb-2 text-[11px]"
         style={{ color: T.muted }}>
      <span>{texto}</span>
      <button onClick={onCerrar} aria-label="Cerrar aviso" className="shrink-0 hover:opacity-70">✕</button>
    </div>
  );
}

/** Buscador de un candidato por ticker -- para cuando Manuel detecta algo por su cuenta (o
 *  quiere revisar uno ya visto) sin bucear en las listas. Une alta manual + comprobar filtros +
 *  gate + decisión en un solo sitio; "Incorporar"/"Mantener fuera" cierran la emergente solos.
 *  Mismo patrón de emergente que `real/ScanFullModal.tsx` (velo + tarjeta + cerrar por X/Escape/
 *  click fuera), con los tokens propios de esta sala. */
function CandidatoBuscadorModal({ onClose, onCambiado }: { onClose: () => void; onCambiado: () => void }) {
  const [ticker, setTicker] = useState("");
  const [candidato, setCandidato] = useState<Candidato | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const buscar = async () => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true);
    setErr("");
    try {
      const existente = await buscarCandidato(t);
      setCandidato(existente ?? await crearCandidatoManual(t));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo buscar el candidato.");
    } finally {
      setBusy(false);
    }
  };

  const recargar = async (fn: () => Promise<Candidato>) => {
    setBusy(true);
    setErr("");
    try {
      setCandidato(await fn());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  const decidir = async (decision: "incorporado" | "descartado") => {
    if (!candidato) return;
    setBusy(true);
    try {
      await decidirCandidato(candidato.id, decision);
      onCambiado();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const sinComprobar = candidato != null && candidato.filtro_sector_pass == null;
  const listoParaGate = candidato != null && !sinComprobar
    && !!candidato.filtro_sector_pass && !!candidato.estadistica_pass && candidato.gate_pass == null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10"
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Añadir ticker"
           className="w-full max-w-md rounded-xl border shadow-xl"
           style={{ borderColor: T.ring, background: T.panel }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: T.grid }}>
          <b style={{ color: T.ink }}>Añadir ticker</b>
          <button onClick={onClose} aria-label="Cerrar" className="hover:opacity-70" style={{ color: T.muted }}>✕</button>
        </div>

        <div className="px-4 py-3.5 text-[12.5px]">
          <div className="flex gap-2">
            <input ref={inputRef} value={ticker} onChange={(e) => setTicker(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && buscar()}
                   placeholder="Ticker (ej. HUMA)" disabled={busy}
                   className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[12px] uppercase"
                   style={{ background: T.panel2, color: T.ink, border: `1px solid ${T.grid}` }} />
            <button onClick={buscar} disabled={busy || !ticker.trim()}
                    className="shrink-0 rounded-lg px-3 py-2 text-[11.5px] font-bold disabled:opacity-40"
                    style={{ background: T.base, color: T.ink2 }}>
              {busy && !candidato ? "…" : "Buscar"}
            </button>
          </div>
          {err && <p className="mt-2 text-[11px]" style={{ color: T.bad }}>{err}</p>}

          {candidato && (
            <div className="mt-3.5 border-t pt-3.5" style={{ borderColor: T.grid }}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <b style={{ color: T.ink }}>{candidato.ticker}</b>
                  {candidato.nombre && <span className="ml-2 text-[11px]" style={{ color: T.muted }}>{candidato.nombre}</span>}
                </div>
                <button onClick={() => { setCandidato(null); setTicker(""); }}
                        className="shrink-0 text-[10.5px] underline" style={{ color: T.muted }}>
                  nueva búsqueda
                </button>
              </div>

              {!sinComprobar && (
                <div className="mt-2 space-y-1.5 leading-relaxed">
                  <div className="flex gap-2">
                    <span style={{ color: candidato.filtro_sector_pass ? T.good : T.bad }}>
                      {candidato.filtro_sector_pass ? "✓" : "✗"}
                    </span>
                    <span style={{ color: T.ink2 }}>Sector <span style={{ color: T.muted }}>{candidato.filtro_sector_detalle}</span></span>
                  </div>
                  <div className="flex gap-2">
                    <span style={{ color: candidato.estadistica_pass ? T.good : T.bad }}>
                      {candidato.estadistica_pass ? "✓" : "✗"}
                    </span>
                    <span style={{ color: T.ink2 }}>Estadística <span style={{ color: T.muted }}>{candidato.estadistica_detalle}</span></span>
                  </div>
                  {candidato.gate_pass != null && (
                    <div className="flex gap-2">
                      <span style={{ color: candidato.gate_pass ? T.good : T.bad }}>{candidato.gate_pass ? "✓" : "✗"}</span>
                      <span style={{ color: T.ink2 }}>Gate fundamental <span style={{ color: T.muted }}>{candidato.gate_detalle}</span></span>
                    </div>
                  )}
                </div>
              )}

              {sinComprobar ? (
                <button onClick={() => recargar(() => comprobarFiltrosCandidato(candidato.id))} disabled={busy}
                        className="mt-3 w-full rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-40"
                        style={{ background: T.base, color: T.ink2 }}>
                  {busy ? "Comprobando…" : "Comprobar filtros (gratis)"}
                </button>
              ) : listoParaGate ? (
                <button onClick={() => recargar(() => lanzarGateCandidato(candidato.id))} disabled={busy}
                        className="mt-3 w-full rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-40"
                        style={{ background: T.warn, color: "#3a2600" }}>
                  {busy ? "Evaluando…" : "Lanzar gate (1 llamada real)"}
                </button>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => decidir("incorporado")} disabled={busy || candidato.decision === "incorporado"}
                          className="flex-1 rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-40"
                          style={{ background: "rgba(12,163,12,0.14)", color: T.good, border: "1px solid rgba(12,163,12,0.35)" }}>
                    Incorporar
                  </button>
                  <button onClick={() => decidir("descartado")} disabled={busy || candidato.decision === "descartado"}
                          className="flex-1 rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-40"
                          style={{ background: "transparent", color: T.bad, border: "1px solid rgba(208,59,59,0.5)" }}>
                    Mantener fuera
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pestañas "Por revisar" / "Evaluados" dentro de un único módulo Candidatos (antes eran dos
 *  acordeones separados -- fusionados 8-sep-2026 para no amontonar módulos). */
function CandidatosTabs({ porRevisar, evaluados, onCambiado }: {
  porRevisar: Candidato[]; evaluados: Candidato[]; onCambiado: () => void;
}) {
  const [tab, setTab] = useState<"revisar" | "evaluados">("revisar");
  const tabBtn = (activo: boolean) => ({
    background: activo ? T.panel : "transparent",
    color: activo ? T.ink : T.muted,
    boxShadow: activo ? `0 1px 0 ${T.grid}` : undefined,
  });

  return (
    <div>
      <div className="mx-3.5 mt-1 flex gap-1 rounded-lg p-1" style={{ background: T.panel2 }}>
        <button onClick={() => setTab("revisar")}
                className="flex-1 rounded-md py-1.5 text-center text-[11px] font-semibold" style={tabBtn(tab === "revisar")}>
          Por revisar · {porRevisar.length}
        </button>
        <button onClick={() => setTab("evaluados")}
                className="flex-1 rounded-md py-1.5 text-center text-[11px] font-semibold" style={tabBtn(tab === "evaluados")}>
          Evaluados · {evaluados.length}
        </button>
      </div>
      <div className="mt-1">
        {tab === "revisar" ? (
          porRevisar.length === 0 ? (
            <div className="px-3.5 pb-3.5 pt-2.5 text-[12px]" style={{ color: T.muted }}>Nada nuevo detectado.</div>
          ) : (
            porRevisar.map((c, i) => <CandidatoPorRevisarRow key={c.id} c={c} first={i === 0} onCambiado={onCambiado} />)
          )
        ) : (
          evaluados.length === 0 ? (
            <div className="px-3.5 pb-3.5 pt-2.5 text-[12px]" style={{ color: T.muted }}>Ningún candidato evaluado todavía.</div>
          ) : (
            evaluados.map((c, i) => <CandidatoRow key={c.id} c={c} first={i === 0} onDecidido={onCambiado} />)
          )
        )}
      </div>
    </div>
  );
}

/** Detectado por ApeWisdom (ruptura de menciones) o añadido a mano, sin decisión todavía.
 *  Sector + estadística son automáticos a un clic; el gate LLM es la única llamada que gasta
 *  dinero, y siempre candidato a candidato -- nunca un "evaluar todos" (8-sep-2026). */
function CandidatoPorRevisarRow({ c, first, onCambiado }: { c: Candidato; first: boolean; onCambiado: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const sinComprobar = c.filtro_sector_pass == null;
  const listoParaGate = !sinComprobar && !!c.filtro_sector_pass && !!c.estadistica_pass;

  const accionar = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      onCambiado();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3.5 py-3" style={!first ? { borderTop: `1px solid ${T.grid}` } : undefined}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <b style={{ color: T.ink }}>{c.ticker}</b>
          {c.nombre && <span className="ml-2 text-[11px]" style={{ color: T.muted }}>{c.nombre}</span>}
        </div>
        <span className="shrink-0 text-[10px]" style={{ color: T.muted }}>{fmtFecha(c.fecha_evaluacion)}</span>
      </div>

      {!sinComprobar && (
        <div className="mt-2 space-y-1 text-[11.5px] leading-relaxed">
          <div className="flex gap-2">
            <span style={{ color: c.filtro_sector_pass ? T.good : T.bad }}>{c.filtro_sector_pass ? "✓" : "✗"}</span>
            <span style={{ color: T.ink2 }}>Sector <span style={{ color: T.muted }}>{c.filtro_sector_detalle}</span></span>
          </div>
          <div className="flex gap-2">
            <span style={{ color: c.estadistica_pass ? T.good : T.bad }}>{c.estadistica_pass ? "✓" : "✗"}</span>
            <span style={{ color: T.ink2 }}>Estadística <span style={{ color: T.muted }}>{c.estadistica_detalle}</span></span>
          </div>
        </div>
      )}
      {err && <p className="mt-1.5 text-[11px]" style={{ color: T.bad }}>{err}</p>}

      <div className="mt-2.5 flex gap-2">
        {sinComprobar ? (
          <button onClick={() => accionar(() => comprobarFiltrosCandidato(c.id))} disabled={busy}
                  className="flex-1 rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-40"
                  style={{ background: T.base, color: T.ink2 }}>
            {busy ? "Comprobando…" : "Comprobar filtros (gratis)"}
          </button>
        ) : listoParaGate ? (
          <button onClick={() => accionar(() => lanzarGateCandidato(c.id))} disabled={busy}
                  className="flex-1 rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-40"
                  style={{ background: T.warn, color: "#3a2600" }}>
            {busy ? "Evaluando…" : "Lanzar gate (1 llamada real)"}
          </button>
        ) : null}
        {/* Descartar sin necesidad de comprobar nada antes -- cada ticker es una decisión
            independiente, nunca hace falta procesar uno para poder quitarlo de la lista. */}
        <button onClick={() => accionar(() => decidirCandidato(c.id, "descartado"))} disabled={busy}
                className="rounded-lg px-3 py-2 text-[11.5px] font-bold disabled:opacity-40"
                style={{ background: "transparent", color: T.bad, border: "1px solid rgba(208,59,59,0.5)" }}>
          Descartar
        </button>
      </div>
    </div>
  );
}

function CandidatoRow({ c, first, onDecidido }: { c: Candidato; first: boolean; onDecidido: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"incorporado" | "descartado" | "reintentar" | null>(null);

  const decidir = async (decision: "incorporado" | "descartado") => {
    setBusy(decision);
    try {
      await decidirCandidato(c.id, decision);
      onDecidido();
    } finally {
      setBusy(null);
    }
  };

  // Solo tiene sentido antes del gate: un fallo de sector/estadística puede ser un yfinance
  // caído en su momento, no un veredicto final -- reintentar no pisa nunca una decisión tuya
  // (el backend solo reactiva "pendiente" si la decisión actual era automática).
  const puedeReintentar = c.gate_pass == null && (!c.filtro_sector_pass || !c.estadistica_pass);
  const reintentar = async () => {
    setBusy("reintentar");
    try {
      await comprobarFiltrosCandidato(c.id);
      onDecidido();
    } finally {
      setBusy(null);
    }
  };

  const check = (v: boolean | number | null, label: string, detalle: string) => {
    const marca = v == null ? "-" : v ? "✓" : "✗";
    const color = v == null ? T.muted : v ? T.good : T.bad;
    return (
      <div className="flex gap-2">
        <span className="shrink-0" style={{ color }}>{marca}</span>
        <div className="min-w-0">
          <span className="font-semibold" style={{ color: T.ink2 }}>{label}</span>
          <span className="ml-1" style={{ color: T.muted }}>{detalle || "Sin comprobar todavía."}</span>
        </div>
      </div>
    );
  };

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
          {puedeReintentar && (
            <button onClick={reintentar} disabled={busy != null}
                    className="mt-2.5 w-full rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-40"
                    style={{ background: T.base, color: T.ink2 }}>
              {busy === "reintentar" ? "Reintentando…" : "Reintentar filtros (gratis)"}
            </button>
          )}
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
            {c.decidido_por === "manual" ? "Decisión tuya." : "Propuesta del sistema: decides tú."}
          </p>
        </div>
      )}
    </div>
  );
}
