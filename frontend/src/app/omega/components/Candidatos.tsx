// Candidatos: el buscador manual de un ticker, la pestaña por-revisar/todos y la fila de
// cada candidato (comprobar filtros, lanzar gate, incorporar/descartar).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  buscarCandidato, comprobarFiltrosCandidato, crearCandidatoManual, decidirCandidato,
  getGateProgresoCandidato, lanzarGateCandidato,
} from '../api';
import { fmtFecha } from '../helpers';
import { T } from '../tokens';
import type { Candidato } from '../types';

/** Buscador de un candidato por ticker -- para cuando Manuel detecta algo por su cuenta (o
 *  quiere revisar uno ya visto) sin bucear en las listas. Une alta manual + comprobar filtros +
 *  gate + decisión en un solo sitio; "Incorporar"/"Mantener fuera" cierran la emergente solos.
 *  Mismo patrón de emergente que `real/ScanFullModal.tsx` (velo + tarjeta + cerrar por X/Escape/
 *  click fuera), con los tokens propios de esta sala. */
export function CandidatoBuscadorModal({ onClose, onCambio }: { onClose: () => void; onCambio: (c: Candidato) => void }) {
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
      const actualizado = await fn();
      setCandidato(actualizado);
      onCambio(actualizado);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  // Gate: solo LANZA en segundo plano y sondea -- esperar la respuesta aquí es lo que daba
  // timeout en el navegador con el gate ya en curso por detrás (14-sep-2026).
  const gatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (gatePollRef.current) clearInterval(gatePollRef.current); }, []);

  const sondearGate = useCallback(async () => {
    if (!candidato) return;
    try {
      const p = await getGateProgresoCandidato(candidato.id);
      if (p.status !== "running") {
        if (gatePollRef.current) { clearInterval(gatePollRef.current); gatePollRef.current = null; }
        setBusy(false);
        if (p.status === "error") setErr(p.error ?? "No se pudo completar el gate.");
        if (p.candidato) { setCandidato(p.candidato); onCambio(p.candidato); }
      }
    } catch { /* fallo puntual de red no corta el sondeo */ }
  }, [candidato, onCambio]);

  const lanzarGate = async () => {
    if (!candidato) return;
    setBusy(true);
    setErr("");
    try {
      await lanzarGateCandidato(candidato.id);
      gatePollRef.current = setInterval(sondearGate, 3000);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo lanzar el gate.");
      setBusy(false);
    }
  };

  const decidir = async (decision: "incorporado" | "descartado") => {
    if (!candidato) return;
    setBusy(true);
    try {
      await decidirCandidato(candidato.id, decision);
      onCambio({ ...candidato, decision, decidido_por: "manual" });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const sinComprobar = candidato != null && candidato.filtro_sector_pass == null;
  const listoParaGate = candidato != null && !sinComprobar
    && !!candidato.filtro_sector_pass && !!candidato.estadistica_pass && candidato.gate_pass == null;

  // Retoma el sondeo solo si YA había un gate en curso para este candidato -- buscar otro
  // ticker y volver (o recargar) no debe hacer parecer que el clic no sirvió de nada cuando en
  // realidad sigue corriendo por detrás (14-sep-2026).
  useEffect(() => {
    if (!candidato || !listoParaGate) return;
    const id = candidato.id;
    let cancelado = false;
    getGateProgresoCandidato(id).then((p) => {
      if (cancelado || p.status !== "running") return;
      setBusy(true);
      gatePollRef.current = setInterval(sondearGate, 3000);
    }).catch(() => {});
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidato?.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-6"
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
                    className="shrink-0 rounded-full px-3.5 py-2 text-[11.5px] font-bold disabled:opacity-40"
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
                        className="mt-3 w-full rounded-full py-2 text-[11.5px] font-bold disabled:opacity-40"
                        style={{ background: T.base, color: T.ink2 }}>
                  {busy ? "Comprobando…" : "Comprobar filtros (gratis)"}
                </button>
              ) : listoParaGate ? (
                <button onClick={lanzarGate} disabled={busy}
                        className="mt-3 w-full rounded-full py-2 text-[11.5px] font-bold disabled:opacity-40"
                        style={{ background: T.entry, color: "#fff" }}>
                  {busy ? "Evaluando…" : "Lanzar gate (1 llamada real)"}
                </button>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => decidir("incorporado")} disabled={busy || candidato.decision === "incorporado"}
                          className="flex-1 rounded-full py-2 text-[11.5px] font-bold disabled:opacity-40"
                          style={{ background: "rgba(12,163,12,0.14)", color: T.good, border: "1px solid rgba(12,163,12,0.35)" }}>
                    Incorporar
                  </button>
                  <button onClick={() => decidir("descartado")} disabled={busy || candidato.decision === "descartado"}
                          className="flex-1 rounded-full py-2 text-[11.5px] font-bold disabled:opacity-40"
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
export function CandidatosTabs({ porRevisar, evaluados, onCambio }: {
  porRevisar: Candidato[]; evaluados: Candidato[]; onCambio: (c: Candidato) => void;
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
            porRevisar.map((c, i) => <CandidatoPorRevisarRow key={c.id} c={c} first={i === 0} onCambio={onCambio} />)
          )
        ) : (
          evaluados.length === 0 ? (
            <div className="px-3.5 pb-3.5 pt-2.5 text-[12px]" style={{ color: T.muted }}>Ningún candidato evaluado todavía.</div>
          ) : (
            evaluados.map((c, i) => <CandidatoRow key={c.id} c={c} first={i === 0} onCambio={onCambio} />)
          )
        )}
      </div>
    </div>
  );
}

/** Detectado por ApeWisdom (ruptura de menciones) o añadido a mano, sin decisión todavía.
 *  Sector + estadística son automáticos a un clic; el gate LLM es la única llamada que gasta
 *  dinero, y siempre candidato a candidato -- nunca un "evaluar todos" (8-sep-2026). */
export function CandidatoPorRevisarRow({ c, first, onCambio }: { c: Candidato; first: boolean; onCambio: (c: Candidato) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const sinComprobar = c.filtro_sector_pass == null;
  const listoParaGate = !sinComprobar && !!c.filtro_sector_pass && !!c.estadistica_pass;

  const accionar = async (fn: () => Promise<Candidato>) => {
    setBusy(true);
    setErr("");
    try {
      onCambio(await fn());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  // Gate: solo LANZA en segundo plano y sondea -- esperar la respuesta aquí es lo que daba
  // timeout en el navegador con el gate ya en curso por detrás (14-sep-2026).
  const gatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (gatePollRef.current) clearInterval(gatePollRef.current); }, []);

  const sondearGate = useCallback(async () => {
    try {
      const p = await getGateProgresoCandidato(c.id);
      if (p.status !== "running") {
        if (gatePollRef.current) { clearInterval(gatePollRef.current); gatePollRef.current = null; }
        setBusy(false);
        if (p.status === "error") setErr(p.error ?? "No se pudo completar el gate.");
        if (p.candidato) onCambio(p.candidato);
      }
    } catch { /* fallo puntual de red no corta el sondeo */ }
  }, [c.id, onCambio]);

  // Retoma el sondeo solo si YA había un gate en curso para este candidato -- cambiar de
  // pestaña (por revisar/evaluados) o recargar la página no debe hacer parecer que el clic no
  // sirvió de nada cuando en realidad sigue corriendo por detrás (14-sep-2026).
  useEffect(() => {
    if (!listoParaGate) return;
    let cancelado = false;
    getGateProgresoCandidato(c.id).then((p) => {
      if (cancelado || p.status !== "running") return;
      setBusy(true);
      gatePollRef.current = setInterval(sondearGate, 3000);
    }).catch(() => {});
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  const lanzarGate = async () => {
    setBusy(true);
    setErr("");
    try {
      await lanzarGateCandidato(c.id);
      gatePollRef.current = setInterval(sondearGate, 3000);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo lanzar el gate.");
      setBusy(false);
    }
  };

  const descartar = async () => {
    setBusy(true);
    setErr("");
    try {
      await decidirCandidato(c.id, "descartado");
      onCambio({ ...c, decision: "descartado", decidido_por: "manual" });
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
                  className="flex-1 rounded-full py-2 text-[11.5px] font-bold disabled:opacity-40"
                  style={{ background: T.base, color: T.ink2 }}>
            {busy ? "Comprobando…" : "Comprobar filtros (gratis)"}
          </button>
        ) : listoParaGate ? (
          <button onClick={lanzarGate} disabled={busy}
                  className="flex-1 rounded-full py-2 text-[11.5px] font-bold disabled:opacity-40"
                  style={{ background: T.entry, color: "#fff" }}>
            {busy ? "Evaluando…" : "Lanzar gate (1 llamada real)"}
          </button>
        ) : null}
        {/* Descartar sin necesidad de comprobar nada antes -- cada ticker es una decisión
            independiente, nunca hace falta procesar uno para poder quitarlo de la lista. */}
        <button onClick={descartar} disabled={busy}
                className="rounded-full px-3 py-2 text-[11.5px] font-bold disabled:opacity-40"
                style={{ background: "transparent", color: T.bad, border: "1px solid rgba(208,59,59,0.5)" }}>
          Descartar
        </button>
      </div>
    </div>
  );
}

export function CandidatoRow({ c, first, onCambio }: { c: Candidato; first: boolean; onCambio: (c: Candidato) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"incorporado" | "descartado" | "reintentar" | null>(null);

  const decidir = async (decision: "incorporado" | "descartado") => {
    setBusy(decision);
    try {
      await decidirCandidato(c.id, decision);
      onCambio({ ...c, decision, decidido_por: "manual" });
    } finally {
      setBusy(null);
    }
  };

  // Solo tiene sentido antes del gate: un fallo de sector/estadística puede ser un yfinance
  // caído en su momento, no un veredicto final -- reintentar nunca decide nada, solo repite
  // el chequeo gratis y deja la decisión igual de pendiente que estaba.
  const puedeReintentar = c.gate_pass == null && (!c.filtro_sector_pass || !c.estadistica_pass);
  const reintentar = async () => {
    setBusy("reintentar");
    try {
      onCambio(await comprobarFiltrosCandidato(c.id));
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
        {/* Esta lista solo contiene candidatos sin decidir todavía (los decididos salen de
            aquí en cuanto Incorporas o Mantienes fuera) -- el badge es siempre neutro. */}
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
              style={{ background: T.base, color: T.ink2 }}>
          sin decidir
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
                    className="mt-2.5 w-full rounded-full py-2 text-[11.5px] font-bold disabled:opacity-40"
                    style={{ background: T.base, color: T.ink2 }}>
              {busy === "reintentar" ? "Reintentando…" : "Reintentar filtros (gratis)"}
            </button>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={() => decidir("incorporado")} disabled={busy != null}
                    className="flex-1 rounded-full py-2 text-[11.5px] font-bold disabled:opacity-40"
                    style={{ background: "rgba(12,163,12,0.14)", color: T.good, border: "1px solid rgba(12,163,12,0.35)" }}>
              {busy === "incorporado" ? "…" : "Incorporar"}
            </button>
            <button onClick={() => decidir("descartado")} disabled={busy != null}
                    className="flex-1 rounded-full py-2 text-[11.5px] font-bold disabled:opacity-40"
                    style={{ background: "transparent", color: T.bad, border: "1px solid rgba(208,59,59,0.5)" }}>
              {busy === "descartado" ? "…" : "Mantener fuera"}
            </button>
          </div>
          <p className="mt-2 text-[10px]" style={{ color: T.muted }}>
            Sin decidir todavía: incorporar o mantener fuera es cosa tuya.
          </p>
        </div>
      )}
    </div>
  );
}
