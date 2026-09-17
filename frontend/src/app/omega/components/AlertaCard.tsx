// Alertas activas: el carrusel, el banner del gate pendiente y la tarjeta de cada senal
// (compra inicial, cerrar/aumentar una posicion ya ejecutada, gate individual).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { descartarSenal, ejecutarSenal, getGateProgreso, lanzarGate } from '../api';
import type { GateProgreso } from '../api';
import {
  costeBase, distAth, distPicoLocal, esGateRegimen, fmtFecha, fmtRet, precioHoy,
  tituloRegimen, TIPO_LABEL,
} from '../helpers';
import { MONO, NUMS, T } from '../tokens';
import type { Regimen, Senal } from '../types';
import { FormField } from './ui';

/** Carrusel horizontal deslizable (scroll-snap nativo, sin librería) — todas las alertas
 *  cargadas, sin paginar (con 34 tickers no hace falta, ver feedback 7-sep-2026). Los puntos
 *  reflejan la posición real de scroll. */
export function AlertasCarrusel({ alertas, empates, preciosVivos, regimen, onCambio }: {
  alertas: Senal[]; empates: Map<string, Senal[]>; preciosVivos: Record<string, number | null>;
  regimen: Regimen | null;
  onCambio: (id: number, patch: Partial<Senal>) => void;
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
              <AlertaCard s={s} grupo={grupo} precioVivo={preciosVivos[s.ticker] ?? null} regimen={regimen} onCambio={onCambio} />
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
 *  (mismo criterio que "Requiere decisión" en Alpha) y por eso NUNCA se dispara solo:
 *  totalmente invisible si no hay nada pendiente, y el botón es el único gatillo (ver doc §3,
 *  decidido 7-sep-2026 -- el gate lo controla Manuel, no un cron). */
export function GatePendienteBanner({ señales, onEvaluado }: { señales: Senal[]; onEvaluado: () => void }) {
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
    <div className="mb-6 border-l-2 py-1 pl-4" style={{ borderColor: T.warn }}>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: T.warn }} />
        <span className="text-[15px] font-bold tracking-tight" style={{ color: T.warn }}>Gate pendiente: señales del universo</span>
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
        <div className="mt-3 rounded-full py-2 text-center text-[12.5px] font-bold" style={{ background: T.entry, color: "#fff" }}>
          Evaluando {progreso.hecho}/{progreso.total}
          {progreso.ticker_actual ? ` · ${progreso.ticker_actual}` : ""}…
        </div>
      ) : (
        <button onClick={evaluar} disabled={seleccionadas.size === 0}
                className="mt-3 w-full rounded-full py-2 text-[12.5px] font-bold disabled:opacity-40"
                style={{ background: T.entry, color: "#fff" }}>
          Evaluar seleccionadas ({seleccionadas.size})
        </button>
      )}
    </div>
  );
}

export function AlertaCard({ s, grupo, precioVivo, regimen, onCambio }: {
  s: Senal; grupo: Senal[]; precioVivo: number | null; regimen: Regimen | null;
  onCambio: (id: number, patch: Partial<Senal>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [acciones, setAcciones] = useState("");
  const [precio, setPrecio] = useState(String(s.entry_price));
  const [comision, setComision] = useState("0");
  // No se limpia al pulsar "Volver" -- si reabres el formulario en la misma visita, lo escrito
  // sigue ahí (solo se pierde de verdad al recargar la página, como el resto del borrador).
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState<"guardar" | "descartar" | null>(null);
  const [err, setErr] = useState("");

  // Posición ya ejecutada (estado === "ejecutada", de una visita anterior): cerrar (total o
  // parcial) o aumentar -- formulario aparte del de compra inicial de arriba, mismo patrón.
  const [modo, setModo] = useState<"cerrar" | "aumentar" | null>(null);
  const [accionesForm, setAccionesForm] = useState("");
  const [precioForm, setPrecioForm] = useState("");
  const [comisionForm, setComisionForm] = useState("0");
  const [notasForm, setNotasForm] = useState("");
  const [busyForm, setBusyForm] = useState(false);
  const [errForm, setErrForm] = useState("");
  const [cerrado, setCerrado] = useState(false);

  const abrirModo = (m: "cerrar" | "aumentar") => {
    setModo(m);
    setErrForm("");
    setComisionForm("0");
    setNotasForm("");
    setAccionesForm(m === "cerrar" && s.posicion_abierta ? String(Number(s.posicion_abierta.acciones)) : "");
    setPrecioForm(String(precioVivo ?? s.entry_price));
  };

  const submitForm = async () => {
    const n = Number(accionesForm);
    if (!n || n <= 0 || busyForm || !modo) return;
    setBusyForm(true); setErrForm("");
    try {
      const r = await ejecutarSenal(s.id, {
        accion: modo === "cerrar" ? "venta" : "compra",
        acciones: n, precio: Number(precioForm), comision: Number(comisionForm) || 0,
        notas: notasForm.trim() || undefined,
      });
      setCerrado(true);
      setTimeout(() => onCambio(s.id, { estado: r.estado as Senal["estado"] }), 900);
    } catch (e) {
      setErrForm(e instanceof ApiError ? e.message : "No se pudo registrar la operación.");
      setBusyForm(false);
    }
  };

  // Gate individual (9-sep-2026): mismo endpoint/hilo en segundo plano que el banner de arriba,
  // lanzado con un solo id -- no hace falta bajar a la caja naranja para evaluar una sola señal.
  // Solo UN gate corre a la vez en todo el backend (`gate_runner._running`); si ya hay uno en
  // marcha (el del banner u otra tarjeta), no nos "enganchamos" a su progreso -- sería el de
  // OTRO ticker y confundiría -- se avisa y ya está, reintenta cuando termine.
  const [gateProgreso, setGateProgreso] = useState<GateProgreso | null>(null);
  const [gateErr, setGateErr] = useState("");
  const gatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (gatePollRef.current) clearInterval(gatePollRef.current); }, []);

  const sondearGate = useCallback(async () => {
    try {
      const p = await getGateProgreso();
      setGateProgreso(p);
      if (p.status !== "running") {
        if (gatePollRef.current) { clearInterval(gatePollRef.current); gatePollRef.current = null; }
        onCambio(s.id, {});   // patch vacío -- solo dispara la recarga que trae el veredicto real
      }
    } catch { /* fallo puntual de red no corta el sondeo */ }
  }, [onCambio, s.id]);

  const lanzarGateIndividual = async () => {
    if (gateProgreso?.status === "running") return;
    setGateErr("");
    try {
      const r = await lanzarGate([s.id]);
      if (!r.lanzado) {
        setGateErr(r.motivo === "ya en curso"
          ? "Ya hay una evaluación en curso (de otra señal) -- espera a que termine."
          : "No se pudo lanzar el gate.");
        return;
      }
      setGateProgreso({ status: "running", total: 1, hecho: 0, ok: 0, fail: 0, ticker_actual: s.ticker, error: null });
      gatePollRef.current = setInterval(sondearGate, 3000);
    } catch {
      setGateErr("No se pudo lanzar el gate.");
    }
  };

  const submit = async () => {
    const n = Number(acciones);
    if (!n || busy) return;
    setBusy("guardar"); setErr("");
    try {
      const r = await ejecutarSenal(s.id, {
        accion: "compra", acciones: n, precio: Number(precio), comision: Number(comision) || 0,
        notas: notas.trim() || undefined,
      });
      setDone(true);
      // Confirmación breve y a propósito (no una espera de red -- eso ya se aplicó al momento):
      // deja ver el check antes de que la card salga de Alertas activas.
      setTimeout(() => onCambio(s.id, { estado: r.estado as Senal["estado"] }), 900);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo registrar la posición.");
      setBusy(null);
    }
  };

  const descartar = async () => {
    if (busy) return;
    setBusy("descartar");
    try {
      const r = await descartarSenal(s.id);
      onCambio(s.id, { estado: r.estado as Senal["estado"] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo descartar.");
      setBusy(null);
    }
  };

  const esAmbos = grupo.some((g) => g.tipo === "ambos");
  // Color real, no decorativo: el punto junto al ticker es el estado del gate de esta señal.
  const puntoEstado = s.gate_resultado === "pasa" ? T.good : s.gate_resultado === "falla" ? T.bad : T.muted;
  // Precio en vivo si lo hay (referencia visual, best-effort) -- si no, el de siempre (cierre
  // guardado en el último escaneo). Nunca toca lo que se guarda ni cómo se resuelve la señal.
  const precioMostrado = precioVivo ?? precioHoy(s);
  // Contra TU coste real si ya la ejecutaste (`costeBase`, ver doc de esa función) -- antes
  // esta tarjeta solo vivía en señales sin ejecutar, así que `entry_price` bastaba; ahora que
  // también enseña posiciones ya ejecutadas (para poder cerrarlas/aumentarlas), hace falta el
  // mismo criterio que ya usan "Posiciones abiertas" e "Historial".
  const retornoMostrado = precioVivo != null ? (precioVivo / costeBase(s) - 1) * 100 : Number(s.ret);

  return (
    <div className="border-t pt-4" style={{ borderColor: T.grid }}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: puntoEstado }} />
          <span className={`text-[17px] font-bold ${MONO}`} style={{ color: T.ink }}>{s.ticker}</span>
          <span className="text-[10.5px]" style={{ color: T.muted }}>{s.sector}</span>
        </div>
        <div className="shrink-0 text-right">
          <span className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wide"
                style={{ background: "rgba(255,255,255,0.06)", color: T.ink2 }}>
            {TIPO_LABEL[s.tipo]}
          </span>
          <div className="mt-1 whitespace-nowrap text-[9.5px] leading-tight" style={{ color: T.muted }}>
            {esGateRegimen(s) && (
              <b style={{ color: T.bad }} title={tituloRegimen(s, regimen)}>
                ⛔ régimen ·{" "}
              </b>
            )}
            {s.cuidado && <b style={{ color: T.warn }}>CUIDADO · </b>}{fmtFecha(s.entry_date)} · {s.dias}d
          </div>
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
        {s.ref_label === "ATH_referencia" ? "ATH" : "último pico"} (${money(s.ref_price)})
        {distAth(s) != null && (
          <>
            {" "}· <b className={NUMS} style={{ color: T.bad }}>-{distAth(s)!.toFixed(1)}%</b> bajo el ATH (${money(s.ath!)})
          </>
        )}
        {distPicoLocal(s) != null && (
          <>
            {" "}· <b className={NUMS} style={{ color: T.bad }}>-{distPicoLocal(s)!.toFixed(1)}%</b> bajo el último pico (${money(s.ref_price_pico!)})
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div className="min-w-0">
          <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>Señal</div>
          <b className={`${NUMS} text-[14px]`} style={{ color: T.ink }}>${money(s.entry_price)}</b>
        </div>
        <div className="min-w-0">
          <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>Hoy</div>
          <b className={`${NUMS} text-[14px]`} style={{ color: T.ink }}>${money(precioMostrado)}</b>
        </div>
        <div className="min-w-0">
          <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>Retorno</div>
          <b className={`${NUMS} text-[14px]`} style={{ color: retornoMostrado >= 0 ? T.good : T.bad }}>{fmtRet(retornoMostrado)}</b>
        </div>
      </div>

      <div className="mt-2 text-[11px]" style={{ color: T.muted }}>
        Gate:{" "}
        {s.gate_resultado == null ? <b style={{ color: T.warn }}>pendiente</b>
          : s.gate_resultado === "pasa" ? <b style={{ color: T.good }}>pasa</b>
          : <b style={{ color: T.bad }}>falla</b>}
        {s.gate_detalle && <span>. {s.gate_detalle}</span>}
      </div>

      {s.gate_resultado == null && (
        gateProgreso?.status === "running" ? (
          <div className="mt-2 rounded-full py-2 text-center text-[11.5px] font-bold" style={{ background: T.entry, color: "#fff" }}>
            Evaluando…
          </div>
        ) : (
          <>
            <button onClick={lanzarGateIndividual}
                    className="mt-2 w-full rounded-full py-2 text-[11.5px] font-bold"
                    style={{ background: T.entry, color: "#fff" }}>
              Lanzar gate (1 llamada real)
            </button>
            {gateErr && <p className="mt-1 text-[10.5px]" style={{ color: T.bad }}>{gateErr}</p>}
          </>
        )
      )}

      {done ? (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12.5px] font-bold"
             style={{ background: "rgba(51,193,90,0.14)", color: T.good }}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" stroke={T.good} fill="none" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
          Posición registrada
        </div>
      ) : s.estado === "ejecutada" ? (
        cerrado ? (
          <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12.5px] font-bold"
               style={{ background: "rgba(51,193,90,0.14)", color: T.good }}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" stroke={T.good} fill="none" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
            {modo === "cerrar" ? "Cierre registrado" : "Posición aumentada"}
          </div>
        ) : modo == null ? (
          <div className="mt-2.5 border-t pt-2.5" style={{ borderColor: T.grid }}>
            {s.posicion_abierta && (
              <div className="text-[11px]" style={{ color: T.ink2 }}>
                Abierto: <b className={NUMS} style={{ color: T.ink }}>{Number(s.posicion_abierta.acciones)}</b> acc.
                @ <b className={NUMS} style={{ color: T.ink }}>${money(s.posicion_abierta.coste_medio)}</b>
              </div>
            )}
            {s.dias != null && s.dias >= 80 && (
              <div className="mt-1 text-[10.5px] font-semibold" style={{ color: T.warn }}>
                cerca del tope de 90 días
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <button onClick={() => abrirModo("cerrar")} className="flex-1 rounded-full border py-1.5 text-[12px] font-bold"
                      style={{ background: T.panel2, borderColor: T.grid, color: T.ink }}>
                Cerrar posición
              </button>
              <button onClick={() => abrirModo("aumentar")} className="flex-1 rounded-full border py-1.5 text-[12px] font-bold"
                      style={{ background: "transparent", borderColor: T.grid, color: T.ink2 }}>
                Aumentar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2.5 border-t pt-2.5" style={{ borderColor: T.grid }}>
            <div className="grid grid-cols-3 gap-1.5">
              <FormField label={modo === "cerrar" ? "Acciones a vender" : "Acciones"} value={accionesForm} onChange={setAccionesForm} placeholder="0" />
              <FormField label="Precio ($)" value={precioForm} onChange={setPrecioForm} />
              <FormField label="Comisión" value={comisionForm} onChange={setComisionForm} />
            </div>
            <div className="mt-1.5">
              <label className="mb-1 block text-[9px] uppercase tracking-wide" style={{ color: T.muted }}>
                Notas (opcional)
              </label>
              <textarea value={notasForm} onChange={(e) => setNotasForm(e.target.value)} rows={2}
                        placeholder="Por qué, qué vigilar…"
                        className="w-full resize-none rounded-lg px-2 py-1.5 text-[12px] outline-none"
                        style={{ background: T.base, border: `1px solid ${T.ring}`, color: T.ink }} />
            </div>
            {errForm && <p className="mt-1.5 text-[11px]" style={{ color: T.bad }}>{errForm}</p>}
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => { setModo(null); setErrForm(""); }} disabled={busyForm}
                      className="rounded-full border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                      style={{ background: "transparent", borderColor: T.grid, color: T.ink2 }}>
                Volver
              </button>
              <button onClick={submitForm} disabled={busyForm || !accionesForm || Number(accionesForm) <= 0}
                      className="flex-1 rounded-full py-1.5 text-[12px] font-bold disabled:opacity-40"
                      style={{ background: T.ink, color: T.page }}>
                {busyForm ? "Guardando…" : modo === "cerrar" ? "Confirmar venta" : "Guardar aumento"}
              </button>
            </div>
          </div>
        )
      ) : !open ? (
        <div className="mt-2.5 flex gap-2">
          <button onClick={descartar} disabled={busy != null}
                  className="rounded-full border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                  style={{ background: "transparent", borderColor: T.grid, color: T.ink2 }}>
            {busy === "descartar" ? "…" : "Descartar"}
          </button>
          <button onClick={() => setOpen(true)}
                  className="flex-1 rounded-full border py-1.5 text-[12px] font-bold"
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
          <div className="mt-1.5">
            <label className="mb-1 block text-[9px] uppercase tracking-wide" style={{ color: T.muted }}>
              Notas (opcional)
            </label>
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
                      placeholder="Por qué entras, qué vigilar…"
                      className="w-full resize-none rounded-lg px-2 py-1.5 text-[12px] outline-none"
                      style={{ background: T.base, border: `1px solid ${T.ring}`, color: T.ink }} />
          </div>
          {err && <p className="mt-1.5 text-[11px]" style={{ color: T.bad }}>{err}</p>}
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => { setOpen(false); setErr(""); }} disabled={busy != null}
                    className="rounded-full border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                    style={{ background: "transparent", borderColor: T.grid, color: T.ink2 }}>
              Volver
            </button>
            <button onClick={submit} disabled={busy != null || !acciones}
                    className="flex-1 rounded-full py-1.5 text-[12px] font-bold disabled:opacity-40"
                    style={{ background: T.ink, color: T.page }}>
              {busy === "guardar" ? "Guardando…" : "Guardar posición"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
