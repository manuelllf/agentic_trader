"use client";

/** Dos acciones separadas del universo GLOBAL (HuggingFace), igual que NASDAQ separa "rehacer
 *  foto" de "capturar fundamentales": `UniversoGlobalSync` trae tickers/yahoo_symbol/país/mercado
 *  desde HuggingFace; `FotoGlobalPicker` captura fundamentales reales sobre lo ya sincronizado.
 *
 *  El dataset global no trae precio/cap/volumen (a diferencia del screener de NASDAQ, que sí),
 *  así que país y mercado son el único filtro barato disponible ANTES de gastar peticiones
 *  reales a Yahoo — nunca "elige a ciegas": cada opción muestra su recuento real, y la cuenta
 *  final se recalcula en el backend antes de poder confirmar. */

import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { localeTag } from "@/i18n/locale";
import { useLocale, useTranslations } from "next-intl";
import {
  contarUniversoGlobal, getFotoStatus, getUniversoGlobal, getUniversoGlobalSyncEstado, startFoto,
  subirUniversoGlobalCsv, syncUniversoGlobal, type UniversoGlobalOpciones,
} from "@/lib/api";
import { fmtNum } from "@/lib/scan";
import { InfoTip } from "@/components/InfoTip";
import { NUM_INPUT, T } from "./tokens";

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
  const locale: "es" | "en" = useLocale() === "en" ? "en" : "es";
  return (
    <button onClick={onClick}
            className="rounded-full border px-2.5 py-1 text-[11px] transition-colors"
            style={{
              borderColor: active ? T.buy : T.ring,
              background: active ? "rgba(57,135,229,0.15)" : "transparent",
              color: active ? T.buy : T.ink2,
            }}>
      {label} <span style={{ color: T.muted }}>· {fmtNum(count, locale)}</span>
    </button>
  );
}

/** Resincroniza tickers/yahoo_symbol/país/mercado desde el CSV de HuggingFace — el "rehacer
 *  foto" del universo global. No toca fundamentales, solo la lista de nombres disponibles. */
export function UniversoGlobalSync() {
  const t = useTranslations();
  const locale: "es" | "en" = useLocale() === "en" ? "en" : "es";
  const [opciones, setOpciones] = useState<UniversoGlobalOpciones | null>(null);
  const [loadingOpciones, setLoadingOpciones] = useState(true);
  const [armed, setArmed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    cargarOpciones();
    return () => { if (syncPollRef.current) clearInterval(syncPollRef.current); };
  }, []);

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
          setMsg({ text: st.result.sin_cambios
            ? t("alpha_global_sync_unchanged", { count: fmtNum(st.result.tickers, locale) })
            : t("alpha_global_sync_done", { count: fmtNum(st.result.tickers, locale) }) });
          await cargarOpciones();
        } else {
          setMsg({ text: st.error ?? t("alpha_global_sync_error"), bad: true });
        }
      } catch {
        // sondeo silencioso: un fallo puntual de red no debe tapar el mensaje de lanzamiento
      }
    }, 3000);
  }

  async function doSync() {
    setArmed(false);
    setSyncing(true);
    setMsg({ text: t("alpha_global_sync_running") });
    try {
      await syncUniversoGlobal();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : t("alpha_global_sync_launch_error"), bad: true });
      setSyncing(false);
      return;
    }
    pollSync();
  }

  function abrirSelectorArchivo() {
    fileInputRef.current?.click();
  }

  // `resolve/main` no lleva Content-Disposition: attachment para CSVs no-LFS, así que el
  // navegador lo abre renderizado en vez de descargarlo. Forzamos el guardado vía blob.
  async function descargarCsv(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    try {
      const blob = await (await fetch(URL_CSV_HUGGINGFACE)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tickers.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(URL_CSV_HUGGINGFACE, "_blank");
    }
  }

  async function doSubirCsv(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo fichero si hace falta reintentar
    if (!archivo) return;
    setArmed(false);
    setSyncing(true);
    setMsg({ text: t("alpha_global_csv_uploading", { filename: archivo.name }) });
    try {
      await subirUniversoGlobalCsv(archivo);
    } catch (e2) {
      setMsg({ text: e2 instanceof Error ? e2.message : t("alpha_global_csv_upload_error"), bad: true });
      setSyncing(false);
      return;
    }
    pollSync();
  }

  if (loadingOpciones) {
    return <p className="text-[11px]" style={{ color: T.muted }}>{t("alpha_global_loading")}</p>;
  }

  const csvUploadInput = (
    <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={doSubirCsv} />
  );

  const csvUploadLink = (
    <span className="text-[10.5px]" style={{ color: T.muted }}>
      {t("alpha_or")}{" "}
      <a href={URL_CSV_HUGGINGFACE} target="_blank" rel="noreferrer" className="underline"
         onClick={descargarCsv}>{t("alpha_download_csv")}</a>
      {" "}{t("alpha_and")}{" "}
      <button type="button" onClick={abrirSelectorArchivo} disabled={syncing} className="underline disabled:opacity-50">
        {t("alpha_upload_manually")}
      </button>
      {" "}{t("alpha_if_network_fails")}
    </span>
  );

  const sinSincronizar = !opciones || opciones.total === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {csvUploadInput}
      <span className="text-[10.5px]" style={{ color: sinSincronizar ? T.warn : T.muted }}>
        {sinSincronizar
          ? t("alpha_global_not_synced")
          : t("alpha_global_synced_count", { count: fmtNum(opciones.total, locale), date: opciones.synced_at ? new Date(opciones.synced_at).toLocaleDateString(localeTag(locale), { timeZone: "UTC" }) : "—" })}
      </span>
      {!armed ? (
        <button onClick={() => setArmed(true)} disabled={syncing}
                className="rounded border px-2.5 py-1 text-[11px] font-bold transition-colors hover:bg-white/5 disabled:opacity-50"
                style={{ borderColor: T.ring, color: T.ink2 }}>
          {syncing ? t("alpha_syncing") : sinSincronizar ? t("alpha_sync_global") : `↻ ${t("alpha_resync")}`}
        </button>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          {sinSincronizar && (
            <span className="text-[10.5px]" style={{ color: T.warn }}>{t("alpha_global_download_warning")}</span>
          )}
          <button onClick={doSync} disabled={syncing}
                  className="rounded px-2.5 py-1 text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: T.bad }}>
            {syncing ? t("alpha_syncing") : t("alpha_confirm")}
          </button>
          <button onClick={() => setArmed(false)} disabled={syncing}
                  className="rounded border px-2.5 py-1 text-[11px] transition-colors hover:bg-white/5"
                  style={{ borderColor: T.ring, color: T.ink2 }}>
            {t("alpha_cancel")}
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

/** Selector país/mercado + captura de fundamentales sobre el universo global YA sincronizado —
 *  no resincroniza nada, eso vive en `UniversoGlobalSync`. */
export function FotoGlobalPicker() {
  const t = useTranslations();
  const locale: "es" | "en" = useLocale() === "en" ? "en" : "es";
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
  const fotoPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getUniversoGlobal().then(setOpciones).catch(() => setOpciones(null)).finally(() => setLoadingOpciones(false));
    return () => { if (fotoPollRef.current) clearInterval(fotoPollRef.current); };
  }, []);

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

  // Sondea `getFotoStatus()` directamente (no `/scan/progress`): ese progreso lo comparte
  // CUALQUIER captura/escaneo en curso a la vez, así que fiarse de él aquí mezclaría el
  // mensaje de esta tanda con el de otra corriendo en paralelo.
  function pollFoto() {
    if (fotoPollRef.current) clearInterval(fotoPollRef.current);
    fotoPollRef.current = setInterval(async () => {
      try {
        const st = await getFotoStatus();
        if (st.status === "running") return;
        if (fotoPollRef.current) clearInterval(fotoPollRef.current);
        fotoPollRef.current = null;
        if (st.status === "done" && st.result) {
          const r = st.result;
          if (r.cortado) {
            setMsg({ text: t("alpha_global_capture_cut", { reason: r.motivo_corte ?? t("alpha_provider_block"), captured: fmtNum(r.capturados, locale), requested: fmtNum(r.pedidos, locale) }), bad: true });
          } else {
            setMsg({ text: t("alpha_global_capture_done", { captured: fmtNum(r.capturados, locale), requested: fmtNum(r.pedidos, locale), missing: fmtNum(r.sin_datos, locale) }) });
          }
        } else {
          setMsg({ text: st.error ?? t("alpha_global_capture_error"), bad: true });
        }
      } catch {
        // sondeo silencioso: un fallo puntual de red no debe tapar el mensaje de lanzamiento
      }
    }, 3000);
  }

  async function doLaunch() {
    setArmed(false);
    setLaunching(true);
    try {
      await startFoto("global", limite, countries, exchanges);
      setMsg({ text: t("alpha_global_capture_started", { count: fmtNum(efectivo ?? limite, locale), minutes: minutosEstimados ?? 0 }) });
      pollFoto();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : t("alpha_global_capture_launch_error"), bad: true });
    } finally {
      setLaunching(false);
    }
  }

  if (loadingOpciones) {
    return <p className="text-[11px]" style={{ color: T.muted }}>{t("alpha_global_loading")}</p>;
  }

  if (!opciones || opciones.total === 0) {
    return (
      <p className="text-[11px]" style={{ color: T.warn }}>
        {t("alpha_global_resync_first")}
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2.5">
      <span className="flex items-center gap-1 text-[10.5px]" style={{ color: T.muted }}>
        {t("alpha_global_synced_count", { count: fmtNum(opciones.total, locale), date: opciones.synced_at ? new Date(opciones.synced_at).toLocaleDateString(localeTag(locale), { timeZone: "UTC" }) : "—" })}
        <InfoTip text={t("alpha_global_filter_help")} />
      </span>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>{t("alpha_country")}</span>
        <div className="flex flex-wrap gap-1.5">
          {opciones.countries.slice(0, 20).map((c) => (
            <Chip key={c.country} label={c.country} count={c.count}
                  active={countries.includes(c.country)}
                  onClick={() => toggle(countries, setCountries, c.country)} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>{t("alpha_market")}</span>
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
          {t("alpha_required_limit")}
          <input type="number" inputMode="numeric" min={1} max={opciones.total} value={limite}
                 onChange={(e) => setLimite(Math.max(1, Number(e.target.value) || 1))}
                 className={`w-20 rounded border bg-transparent px-1.5 py-0.5 text-[11px] ${NUM_INPUT}`}
                 style={{ borderColor: T.ring, color: T.ink }} />
        </label>
        <span className="text-[11px]" style={{ color: T.ink2 }}>
          {counting ? t("alpha_counting") : count != null ? (
            <>
              {t("alpha_global_count_summary", { matches: fmtNum(count, locale), selected: fmtNum(efectivo ?? 0, locale), minutes: minutosEstimados ?? 0 })}
            </>
          ) : "—"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!armed ? (
          <button onClick={() => setArmed(true)} disabled={launching || !count}
                  className="rounded border px-2.5 py-1 text-[11px] font-bold transition-colors hover:bg-white/5 disabled:opacity-50"
                  style={{ borderColor: T.ring, color: T.ink2 }}>
            {launching ? t("alpha_launching") : t("alpha_capture_fundamentals_global")}
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-[10.5px]" style={{ color: T.warn }}>
              {t("alpha_global_minutes_background", { minutes: minutosEstimados ?? 0 })}
              <InfoTip text={t("alpha_global_capture_help")} />
            </span>
            <button onClick={doLaunch} disabled={launching}
                    className="rounded px-2.5 py-1 text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: T.bad }}>
              {launching ? t("alpha_launching") : t("alpha_confirm_capture")}
            </button>
            <button onClick={() => setArmed(false)} disabled={launching}
                    className="rounded border px-2.5 py-1 text-[11px] transition-colors hover:bg-white/5"
                    style={{ borderColor: T.ring, color: T.ink2 }}>
              {t("alpha_cancel")}
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
