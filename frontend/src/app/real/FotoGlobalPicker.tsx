"use client";

/** Selector país/mercado para capturar fundamentales del universo GLOBAL (HuggingFace) —
 *  autocontenido a propósito: `page.tsx` ya tiene bastante estado propio, y este picker no
 *  necesita compartir nada con el resto de la página salvo el resultado final.
 *
 *  El dataset global no trae precio/cap/volumen (a diferencia del screener de NASDAQ, que sí),
 *  así que país y mercado son el único filtro barato disponible ANTES de gastar peticiones
 *  reales a Yahoo — nunca "elige a ciegas": cada opción muestra su recuento real, y la cuenta
 *  final se recalcula en el backend antes de poder confirmar. */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  contarUniversoGlobal, getUniversoGlobal, getUniversoGlobalSyncEstado, startFoto,
  subirUniversoGlobalCsv, syncUniversoGlobal, type UniversoGlobalOpciones,
} from "@/lib/api";
import { fmtNum } from "@/lib/scan";
import { InfoTip } from "./InfoTip";
import { T } from "./tokens";

// Link directo del CSV: para bajarlo a mano, revisarlo y subirlo si la red del propio servidor
// falla a mitad de descarga (visto en vivo el 25-ago-2026).
const URL_CSV_HUGGINGFACE =
  "https://huggingface.co/datasets/adanosorg/free-global-stock-ticker-database/resolve/main/tickers.csv";

// Medido en real (foto_service.py): 2 hilos + 0,4s de pausa → ~3.000 nombres en ~20 min.
const RITMO_POR_MIN = 150;
const LIMITE_DEFECTO = 200;

function Chip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
            className="rounded-full border px-2.5 py-1 text-[11px] transition-colors"
            style={{
              borderColor: active ? T.buy : T.ring,
              background: active ? "rgba(57,135,229,0.15)" : "transparent",
              color: active ? T.buy : T.ink2,
            }}>
      {label} <span style={{ color: T.muted }}>· {fmtNum(count)}</span>
    </button>
  );
}

export function FotoGlobalPicker() {
  const [opciones, setOpciones] = useState<UniversoGlobalOpciones | null>(null);
  const [loadingOpciones, setLoadingOpciones] = useState(true);
  const [countries, setCountries] = useState<string[]>([]);
  const [exchanges, setExchanges] = useState<string[]>([]);
  const [limite, setLimite] = useState(LIMITE_DEFECTO);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [armed, setArmed] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [syncArmed, setSyncArmed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => { if (syncPollRef.current) clearInterval(syncPollRef.current); }, []);

  async function cargarOpciones() {
    setLoadingOpciones(true);
    try {
      setOpciones(await getUniversoGlobal());
    } catch {
      setOpciones(null);
    } finally {
      setLoadingOpciones(false);
    }
  }

  useEffect(() => { cargarOpciones(); }, []);

  // Recuenta en el backend (fuente real) cada vez que cambia la selección — un cliente nunca
  // debe fiarse de sumar los recuentos por país + por mercado a la vez (no son independientes).
  useEffect(() => {
    let vivo = true;
    setCounting(true);
    contarUniversoGlobal(countries, exchanges)
      .then((r) => { if (vivo) setCount(r.count); })
      .catch(() => { if (vivo) setCount(null); })
      .finally(() => { if (vivo) setCounting(false); });
    return () => { vivo = false; };
  }, [countries, exchanges]);

  const efectivo = count != null ? Math.min(count, limite) : null;
  const minutosEstimados = efectivo != null ? Math.max(1, Math.round(efectivo / RITMO_POR_MIN)) : null;

  function toggle(list: string[], set: (v: string[]) => void, v: string) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function pollSync() {
    if (syncPollRef.current) clearInterval(syncPollRef.current);
    syncPollRef.current = setInterval(async () => {
      try {
        const st = await getUniversoGlobalSyncEstado();
        if (st.status === "running") return;
        if (syncPollRef.current) clearInterval(syncPollRef.current);
        syncPollRef.current = null;
        setSyncing(false);
        if (st.status === "done" && st.result) {
          setMsg({ text: `Universo global sincronizado: ${fmtNum(st.result.tickers)} tickers.` });
          await cargarOpciones();
        } else {
          setMsg({ text: st.error ?? "No se pudo sincronizar.", bad: true });
        }
      } catch {
        // sondeo silencioso: un fallo puntual de red no debe tapar el mensaje de lanzamiento
      }
    }, 3000);
  }

  async function doSyncGlobal() {
    setSyncArmed(false);
    setSyncing(true);
    setMsg({ text: "Sincronizando en segundo plano (~63.000 filas, unos minutos)…" });
    try {
      await syncUniversoGlobal();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "No se pudo lanzar la sincronización.", bad: true });
      setSyncing(false);
      return;
    }
    pollSync();
  }

  function abrirSelectorArchivo() {
    fileInputRef.current?.click();
  }

  async function doSubirCsv(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo fichero si hace falta reintentar
    if (!archivo) return;
    setSyncArmed(false);
    setSyncing(true);
    setMsg({ text: `Subiendo ${archivo.name} y sincronizando en segundo plano…` });
    try {
      await subirUniversoGlobalCsv(archivo);
    } catch (e2) {
      setMsg({ text: e2 instanceof Error ? e2.message : "No se pudo subir el CSV.", bad: true });
      setSyncing(false);
      return;
    }
    pollSync();
  }

  async function doLaunch() {
    setArmed(false);
    setLaunching(true);
    try {
      await startFoto("global", limite, countries, exchanges);
      setMsg({ text: `Captura global lanzada (${fmtNum(efectivo ?? limite)} nombres, ~${minutosEstimados} min en segundo plano).` });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "No se pudo lanzar la captura.", bad: true });
    } finally {
      setLaunching(false);
    }
  }

  if (loadingOpciones) {
    return <p className="text-[11px]" style={{ color: T.muted }}>Cargando universo global…</p>;
  }

  const csvUploadInput = (
    <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={doSubirCsv} />
  );

  const csvUploadLink = (
    <span className="text-[10.5px]" style={{ color: T.muted }}>
      o{" "}
      <a href={URL_CSV_HUGGINGFACE} target="_blank" rel="noreferrer" className="underline">descarga el CSV</a>
      {" "}y{" "}
      <button type="button" onClick={abrirSelectorArchivo} disabled={syncing} className="underline disabled:opacity-50">
        súbelo a mano
      </button>
      {" "}si la red falla a mitad.
    </span>
  );

  if (!opciones || opciones.total === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {csvUploadInput}
        <span style={{ color: T.warn }}>
          El universo global (HuggingFace) no está sincronizado todavía — sin esto, &quot;global&quot; no tiene de dónde elegir.
        </span>
        {!syncArmed ? (
          <button onClick={() => setSyncArmed(true)} disabled={syncing}
                  className="rounded border px-2.5 py-1 text-[11px] font-bold transition-colors hover:bg-white/5 disabled:opacity-50"
                  style={{ borderColor: T.ring, color: T.ink2 }}>
            {syncing ? "Sincronizando…" : "Sincronizar universo global"}
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[10.5px]" style={{ color: T.warn }}>~63.000 tickers, descarga de HuggingFace.</span>
            <button onClick={doSyncGlobal} disabled={syncing}
                    className="rounded px-2.5 py-1 text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: T.bad }}>
              {syncing ? "Sincronizando…" : "Confirmar"}
            </button>
            <button onClick={() => setSyncArmed(false)} disabled={syncing}
                    className="rounded border px-2.5 py-1 text-[11px] transition-colors hover:bg-white/5"
                    style={{ borderColor: T.ring, color: T.ink2 }}>
              Cancelar
            </button>
          </span>
        )}
        {csvUploadLink}
        {msg && (
          <span className="text-[10.5px]" style={{ color: msg.bad ? T.warn : T.muted }}>{msg.text}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2.5">
      {csvUploadInput}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[10.5px]" style={{ color: T.muted }}>
          {fmtNum(opciones.total)} tickers sincronizados ({opciones.synced_at ? new Date(opciones.synced_at).toLocaleDateString("es-ES") : "—"}).
          <InfoTip text="Sin filtro de país/mercado no baja el precio, el cap ni el volumen (el dataset global no los trae) — límite siempre obligatorio." />
        </span>
        {!syncArmed ? (
          <button onClick={() => setSyncArmed(true)} disabled={syncing}
                  className="shrink-0 text-[10.5px] font-semibold transition-colors hover:underline disabled:opacity-50"
                  style={{ color: T.ink2 }}>
            {syncing ? "sincronizando…" : "↻ resincronizar universo global"}
          </button>
        ) : (
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            <button onClick={doSyncGlobal} disabled={syncing}
                    className="rounded px-2 py-0.5 text-[10.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: T.bad }}>
              {syncing ? "…" : "Confirmar"}
            </button>
            <button onClick={() => setSyncArmed(false)} disabled={syncing}
                    className="rounded border px-2 py-0.5 text-[10.5px] transition-colors hover:bg-white/5"
                    style={{ borderColor: T.ring, color: T.ink2 }}>
              Cancelar
            </button>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {csvUploadLink}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>País</span>
        <div className="flex flex-wrap gap-1.5">
          {opciones.countries.slice(0, 20).map((c) => (
            <Chip key={c.country} label={c.country} count={c.count}
                  active={countries.includes(c.country)}
                  onClick={() => toggle(countries, setCountries, c.country)} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>Mercado</span>
        <div className="flex flex-wrap gap-1.5">
          {opciones.exchanges.slice(0, 20).map((e) => (
            <Chip key={e.exchange} label={e.exchange} count={e.count}
                  active={exchanges.includes(e.exchange)}
                  onClick={() => toggle(exchanges, setExchanges, e.exchange)} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-2.5" style={{ borderColor: T.grid }}>
        <label className="flex items-center gap-1.5 text-[11px]" style={{ color: T.ink2 }}>
          Límite (obligatorio)
          <input type="number" min={1} max={opciones.total} value={limite}
                 onChange={(e) => setLimite(Math.max(1, Number(e.target.value) || 1))}
                 className="w-20 rounded border bg-transparent px-1.5 py-0.5 text-[11px]"
                 style={{ borderColor: T.ring, color: T.ink }} />
        </label>
        <span className="text-[11px]" style={{ color: T.ink2 }}>
          {counting ? "contando…" : count != null ? (
            <>
              coincidencias: <b>{fmtNum(count)}</b> · va a capturar <b>{fmtNum(efectivo ?? 0)}</b> ·
              ~<b>{minutosEstimados}</b> min
            </>
          ) : "—"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!armed ? (
          <button onClick={() => setArmed(true)} disabled={launching || !count}
                  className="rounded border px-2.5 py-1 text-[11px] font-bold transition-colors hover:bg-white/5 disabled:opacity-50"
                  style={{ borderColor: T.ring, color: T.ink2 }}>
            {launching ? "Lanzando…" : "Capturar fundamentales (global)"}
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-[10.5px]" style={{ color: T.warn }}>
              ~{minutosEstimados} min en segundo plano
              <InfoTip text="No filtra por precio/cap/volumen, solo por país/mercado." />
            </span>
            <button onClick={doLaunch} disabled={launching}
                    className="rounded px-2.5 py-1 text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: T.bad }}>
              {launching ? "Lanzando…" : "Confirmar captura"}
            </button>
            <button onClick={() => setArmed(false)} disabled={launching}
                    className="rounded border px-2.5 py-1 text-[11px] transition-colors hover:bg-white/5"
                    style={{ borderColor: T.ring, color: T.ink2 }}>
              Cancelar
            </button>
          </span>
        )}
        {msg && (
          <span className="text-[10.5px]" style={{ color: msg.bad ? T.warn : T.muted }}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
