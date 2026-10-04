"use client";

/** Centro de operaciones: la ÚNICA card que lanza cosas en Alpha.
 *
 *  Antes había nueve acciones repartidas en cuatro sitios (cabecera, "ajustar sin re-escanear",
 *  "fotos", el enlace de sincronizar de analítica) y ninguna decía si costaba dinero. Aquí el
 *  único eje de agrupación es ese: cuesta o no cuesta. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ApiError, cancelDecision, cancelObservatorio, getConfig, getEstadoDatos, getPodaEstado,
  getPodaPrevia, getScanDecideConfig, getScanJevMacro, getScanMidLayer, putScanJevMacro,
  putScanMidLayer, recheck, redeep, runDemo, snapshotUniverse, startFoto, startPoda,
  syncAnalytics, syncFx, fetchScanProgress,
  type EstadoDatos, type PodaEstado, type PodaPrevia, type ScanProgress, type ScanReport,
} from "@/lib/api";
import { fmtNum } from "@/lib/scan";
import type { AppConfig, DemoRunOverrides } from "@/lib/types";
import { FotoGlobalPicker, UniversoGlobalSync } from "./FotoGlobalPicker";
import { InfoTip } from "@/components/InfoTip";
import { ScanConfigModal } from "./ScanConfigModal";
import { NUMS, T } from "./tokens";
import { Checkbox, Toggle } from "./ui";

// Mismas 4 etapas y orden que ScanConfigModal.STAGES -- solo para pintar el resumen "qué se va a
// mandar", nunca para decidir nada (el override real vive en `overrides`, el default en `/config`).
// Nombre distinto de `ETAPAS` (más abajo, las del progreso en vivo): representan cosas distintas.
const ETAPAS_LLM: { key: keyof NonNullable<AppConfig["llm_defaults"]>; label: string }[] = [
  { key: "prescore", label: "alpha_stage_prescore" },
  { key: "mid", label: "alpha_stage_mid" },
  { key: "deep", label: "alpha_stage_deep" },
  { key: "constructor", label: "alpha_stage_constructor" },
];

type Key = "obs" | "redeep" | "recomp" | "real" | "foto" | "fundam" | "fx" | "anal" | "poda";
type ModoUniverso = "nasdaq" | "global_topcap";
type Fuente = "nasdaq" | "global";
type Tono = "coste" | "info" | "malo" | "neutro";

interface Accion {
  t: string;
  d: string;
  cta: string;
  badges: [string, Tono][];
  peligro?: boolean;     // pinta en rojo: escribe cartera o propuesta
  uni?: boolean;         // selector de universo
  foto?: boolean;        // casilla de reutilizar foto
  cfg?: boolean;         // modelo por etapa
  fuente?: boolean;      // selector NASDAQ/Global (ver FOTO_INFO/FUND_INFO)
  poda?: boolean;        // vista previa de lo que se borra
  aviso?: string;
}

const PAGO: Key[] = ["obs", "redeep", "recomp", "real"];
const GRATIS: Key[] = ["foto", "fundam", "fx", "anal", "poda"];

// "foto"/"fundam" son NASDAQ o Global según `fotoFuente`/`fundFuente` -- el contenido real
// (descripción, botón, badge) sale de aquí en vez de `ACCIONES`, que es estático.
const FOTO_INFO: Record<Fuente, { d: string; cta: string; badges: [string, Tono][] }> = {
  nasdaq: {
    d: "alpha_ops_nasdaq_snapshot_help",
    cta: "alpha_ops_rebuild_snapshot", badges: [["~10 s", "neutro"]],
  },
  global: {
    d: "alpha_ops_global_sync_help",
    cta: "alpha_sync", badges: [["alpha_ops_minutes_estimate", "neutro"]],
  },
};
const FUND_INFO: Record<Fuente, { d: string; cta: string; badges: [string, Tono][] }> = {
  nasdaq: {
    d: "alpha_ops_nasdaq_fundamentals_help",
    cta: "alpha_capture", badges: [["~40 min", "neutro"]],
  },
  global: {
    d: "alpha_ops_global_fundamentals_help",
    cta: "alpha_capture", badges: [["~4 h", "neutro"]],
  },
};

const ACCIONES: Record<Key, Accion> = {
  obs: {
    t: "alpha_ops_observatory_title",
    d: "alpha_ops_observatory_help",
    cta: "alpha_ops_launch_observatory", badges: [["≈ $0.60", "coste"], ["alpha_ops_no_portfolio_change", "neutro"]],
    uni: true, foto: true, cfg: true,
  },
  redeep: {
    t: "alpha_ops_reanalyze_title",
    d: "alpha_ops_reanalyze_help",
    cta: "alpha_ops_reanalyze", badges: [["≈ $0.04", "coste"]], peligro: true,
  },
  recomp: {
    t: "alpha_ops_rebuild_portfolio_title",
    d: "alpha_ops_rebuild_portfolio_help",
    cta: "alpha_ops_rebuild_portfolio", badges: [["alpha_ops_one_builder_call", "coste"]], peligro: true,
    aviso: "alpha_ops_rebuild_warning",
  },
  real: {
    t: "alpha_ops_decision_scan_title",
    d: "alpha_ops_decision_scan_help",
    cta: "alpha_ops_launch_decision", badges: [["≈ $0.60", "coste"], ["alpha_ops_writes_portfolio", "malo"]],
    peligro: true, uni: true, foto: true, cfg: true,
    aviso: "alpha_ops_decision_warning",
  },
  foto: {
    t: "alpha_ops_snapshot_title", d: FOTO_INFO.nasdaq.d, cta: FOTO_INFO.nasdaq.cta,
    badges: FOTO_INFO.nasdaq.badges, fuente: true,
  },
  fundam: {
    t: "alpha_ops_fundamentals_title", d: FUND_INFO.nasdaq.d, cta: FUND_INFO.nasdaq.cta,
    badges: FUND_INFO.nasdaq.badges, fuente: true,
  },
  fx: {
    t: "alpha_ops_fx_title",
    d: "alpha_ops_fx_help",
    cta: "alpha_ops_sync_fx", badges: [["~2 s", "neutro"]],
  },
  anal: {
    t: "alpha_ops_analytics_title",
    d: "alpha_ops_analytics_help",
    cta: "alpha_sync", badges: [["~5 s", "neutro"]],
  },
  poda: {
    t: "alpha_ops_prune_title",
    d: "alpha_ops_prune_help",
    cta: "alpha_ops_prune", badges: [["alpha_ops_frees_space", "neutro"]], poda: true,
    aviso: "alpha_ops_prune_warning",
  },
};

// Etapas REALES de `scan_progress.set_stage()` en el backend. `gather_retry` se pinta como parte
// de gather (es su reintento, no una fase aparte) y `mid` solo se ilumina si la capa media corre.
const ETAPAS: { k: string; t: string }[] = [
  { k: "gather", t: "alpha_stage_data" }, { k: "macro", t: "alpha_macro" }, { k: "prescore", t: "alpha_stage_prescore" },
  { k: "mid", t: "alpha_stage_mid" }, { k: "deep", t: "alpha_stage_deep" }, { k: "constructor", t: "alpha_portfolio" },
];

const TONOS: Record<Tono, { bg: string; fg: string }> = {
  coste: { bg: "rgba(250,178,25,0.14)", fg: T.warn },
  info: { bg: "rgba(57,135,229,0.16)", fg: "#85b7eb" },
  malo: { bg: "rgba(208,59,59,0.14)", fg: T.bad },
  neutro: { bg: "rgba(255,255,255,0.06)", fg: T.ink2 },
};

/** Interruptor persistido en el backend (vale para cron, decisión y observatorio). `valor` null =
 *  aún sin leer. Lo pintado sale siempre de la respuesta del servidor, nunca de un cambio optimista. */
function useInterruptor(leer: () => Promise<{ enabled: boolean }>,
                        guardar: (v: boolean) => Promise<{ enabled: boolean }>) {
  const t = useTranslations();
  const [valor, setValor] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refrescar = useCallback(() => {
    leer().then((r) => setValor(r.enabled))
      .catch(() => setErr(t("alpha_ops_read_state_error")));
  }, [leer, t]);
  useEffect(() => { refrescar(); }, [refrescar]);
  async function cambiar() {
    if (valor === null) return;
    setBusy(true);
    setErr(null);
    try {
      setValor((await guardar(!valor)).enabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("alpha_ops_save_error"));
      refrescar();
    } finally {
      setBusy(false);
    }
  }
  return { valor, busy, err, cambiar };
}

/** "hace 6 h" / "nunca" — la antigüedad importa más que la hora exacta para decidir si relanzar. */
type Text = (key: string, values?: Record<string, string | number>) => string;
function hace(at: string | null, t: Text, locale: "es" | "en"): string {
  if (!at) return t("alpha_ops_never");
  const min = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (min < 1) return t("alpha_ops_now");
  const relative = new Intl.RelativeTimeFormat(locale, { style: "short" });
  if (min < 60) return relative.format(-min, "minute");
  const hours = Math.round(min / 60);
  return hours < 48 ? relative.format(-hours, "hour") : relative.format(-Math.round(hours / 24), "day");
}

export function CentroOperaciones({ report, escaneando, escaneandoDecide, onScanStarted, onReload,
                                   onLoadAnalytics }: {
  report: ScanReport | null;
  escaneando: boolean;
  // Qué escaneo es el que corre (null si no hay ninguno) -- decide cuál de los dos botones de
  // cancelar (cada uno el suyo, nunca se cruzan) tiene sentido mostrar.
  escaneandoDecide: boolean | null;
  onScanStarted: () => void;
  onReload: () => void;
  onLoadAnalytics: () => void;
}) {
  const t = useTranslations();
  const locale: "es" | "en" = useLocale() === "en" ? "en" : "es";
  const [sel, setSel] = useState<Key>("obs");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [uni, setUni] = useState<ModoUniverso>("nasdaq");
  const [reFoto, setReFoto] = useState(false);
  const [fotoFuente, setFotoFuente] = useState<Fuente>("nasdaq");
  const [fundFuente, setFundFuente] = useState<Fuente>("nasdaq");
  const [overrides, setOverrides] = useState<DemoRunOverrides | null>(null);
  // Config PERSISTIDA del escaneo con decisión (cron + botón "con decisión"). Independiente de
  // `overrides` (que es solo del observatorio y no se guarda). `{}` = usa los defaults de /config.
  const [decideCfg, setDecideCfg] = useState<DemoRunOverrides | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const capaMedia = useInterruptor(getScanMidLayer, putScanMidLayer);
  const jevMacro = useInterruptor(getScanJevMacro, putScanJevMacro);
  // Defaults reales de producción (mismo endpoint que el modal) -- el resumen de "qué se manda"
  // sale de aquí + `overrides`, nunca de un valor fijo en el frontend.
  const [llmDefaults, setLlmDefaults] = useState<AppConfig["llm_defaults"] | null>(null);
  // `null` = cargando, `false` = no se pudo leer. Distinguirlos importa: un chip clavado en "…"
  // parece que sigue cargando cuando en realidad el endpoint está devolviendo error.
  const [estado, setEstado] = useState<EstadoDatos | null | false>(null);
  const [progreso, setProgreso] = useState<ScanProgress | null>(null);
  // Foto lanzada por nosotros: el escaneo lo sabe la página (`escaneando`), pero la captura no
  // pasa por `/demo/status`, así que su "en marcha" se sigue aquí.
  const [fotoPropia, setFotoPropia] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Poda: `null` = sin leer, `false` = no se pudo leer (con motivo aparte).
  const [podaPrevia, setPodaPrevia] = useState<PodaPrevia | null | false>(null);
  const [podaMotivo, setPodaMotivo] = useState<string | null>(null);
  const [podaEnMarcha, setPodaEnMarcha] = useState(false);

  const leerPoda = useCallback(() => {
    setPodaPrevia(null);
    setPodaMotivo(null);
    getPodaPrevia()
      .then((r) => {
        setPodaPrevia(r.previa);
        if (r.estado.status === "running") setPodaEnMarcha(true);
      })
      .catch((e) => {
        setPodaPrevia(false);
        setPodaMotivo(e instanceof Error ? e.message : t("alpha_ops_preview_error"));
      });
  }, []);
  useEffect(() => { if (sel === "poda") leerPoda(); }, [sel, leerPoda]);

  const refrescarEstado = useCallback(() => {
    getEstadoDatos().then(setEstado).catch(() => setEstado(false));
  }, []);
  useEffect(() => { refrescarEstado(); }, [refrescarEstado]);

  // Avance de la poda en marcha (corre en el backend; la vista solo lo sigue).
  useEffect(() => {
    if (!podaEnMarcha) return;
    const timer = setInterval(async () => {
      try {
        const e = await getPodaEstado();
        if (e.status === "running") {
          setMsg({ text: textoAvancePoda(e, t) });
          return;
        }
        setPodaEnMarcha(false);
        setMsg(e.status === "done"
          ? { text: textoResultadoPoda(e, t) }
          : { text: e.error ?? t("alpha_ops_prune_error"), bad: true });
        refrescarEstado();
        leerPoda();
      } catch { /* un fallo puntual de red no corta el seguimiento */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [podaEnMarcha, leerPoda, refrescarEstado, t]);
  useEffect(() => {
    getConfig().then((c) => c.llm_defaults && setLlmDefaults(c.llm_defaults)).catch(() => {});
  }, []);
  const refrescarDecideCfg = useCallback(() => {
    getScanDecideConfig().then((r) => setDecideCfg(r.overrides ?? {})).catch(() => {});
  }, []);
  useEffect(() => { refrescarDecideCfg(); }, [refrescarDecideCfg]);

  const activo = escaneando || fotoPropia;

  // Sondeo del progreso REAL (`/scan/progress`). Solo puede haber un trabajo vivo a la vez
  // (`pipeline.start` y `foto_service.start` se excluyen), así que la etapa nunca se mezcla.
  useEffect(() => {
    if (!activo) { setProgreso(null); return; }
    const tick = async () => {
      try {
        const p = await fetchScanProgress();
        setProgreso(p);
        if (p.stage === "done" || p.stage === "error" || p.stage === "idle") {
          setFotoPropia(false);
          refrescarEstado();
          onReload();
        }
      } catch { /* un fallo puntual de red no debe cortar el sondeo */ }
    };
    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activo, onReload, refrescarEstado]);

  const a = ACCIONES[sel];
  // "foto"/"fundam" resuelven su contenido real por NASDAQ/Global en vez de por `a` estático.
  const info = sel === "foto" ? FOTO_INFO[fotoFuente]
    : sel === "fundam" ? FUND_INFO[fundFuente] : a;
  const mostrarPickerGlobal = (sel === "foto" && fotoFuente === "global")
    || (sel === "fundam" && fundFuente === "global");
  const cargando = estado === false ? t("alpha_ops_unread") : "…";
  const elegir = (k: Key) => { setSel(k); setArmed(false); setMsg(null); };
  // Sin vista previa, o sin nada que podar, no se lanza a ciegas.
  const podaBloqueada = sel === "poda" && (podaEnMarcha || !podaPrevia
    || podaPrevia.texto_llm.llamadas === 0);

  async function lanzar() {
    setArmed(false);
    setBusy(true);
    setMsg(null);
    try {
      switch (sel) {
        case "obs":
          await runDemo({ decide: false, modoUniverso: uni,
                          reutilizarUltimaFoto: reFoto, overrides: overrides ?? undefined });
          onScanStarted();
          break;
        case "real":
          await runDemo({ modoUniverso: uni, reutilizarUltimaFoto: reFoto });
          onScanStarted();
          break;
        case "redeep":
          await redeep();
          setMsg({ text: t("alpha_ops_reanalyze_done") });
          onReload();
          break;
        case "recomp":
          await recheck();
          setMsg({ text: t("alpha_ops_rebuild_done") });
          onReload();
          break;
        case "foto": {
          // Solo llega aquí en modo NASDAQ -- en modo Global lanza `UniversoGlobalSync` solo.
          // El backend responde 200 con `ok: false` cuando NASDAQ no coopera — no es un fallo
          // de red, así que el motivo se lee del cuerpo y no del catch.
          const r = await snapshotUniverse();
          setMsg(r.ok
            ? { text: t("alpha_ops_snapshot_done", { count: r.size != null ? fmtNum(r.size, locale) : "—" }) }
            : { text: r.error ?? t("alpha_ops_snapshot_error"), bad: true });
          break;
        }
        case "fundam":
          // Solo llega aquí en modo NASDAQ -- en modo Global lanza `FotoGlobalPicker` solo.
          await startFoto("nasdaq");
          setFotoPropia(true);
          break;
        case "fx": {
          const r = await syncFx();
          // "0 de 0" sin explicación se lee como un fallo silencioso -- si el backend da
          // motivo (nada que convertir todavía), se muestra ese en vez del recuento vacío.
          setMsg(!r.ok
            ? { text: r.error ?? t("alpha_ops_fx_error"), bad: true }
            : r.motivo
              ? { text: r.motivo }
              : { text: t("alpha_ops_fx_done", { currencies: r.divisas ?? 0, count: fmtNum(r.recalculadas ?? 0, locale) }) });
          break;
        }
        case "anal": {
          const r = await syncAnalytics();
          setMsg({ text: t("alpha_ops_analytics_done", { counts: Object.entries(r.counts).map(([name, n]) => `${name}: ${n}`).join(", ") }) });
          onLoadAnalytics();
          break;
        }
        case "poda":
          await startPoda();
          setPodaEnMarcha(true);
          setMsg({ text: t("alpha_ops_prune_running") });
          break;
      }
    } catch (e) {
      // "anal"/"fx" hacen trabajo real y síncrono en el backend (reconstruir DuckDB, o levantar
      // el scraper de Yahoo + recalcular) -- si el timeout del cliente corta antes de que
      // termine, el backend puede seguir trabajando. Decirlo tal cual, no "falló".
      const esLargo = sel === "anal" || sel === "fx";
      const esTimeout = e instanceof ApiError && e.kind === "network" && /timeout/i.test(e.message);
      setMsg({
        text: esLargo && esTimeout
          ? t("alpha_ops_background_timeout")
          : e instanceof Error ? e.message : t("alpha_ops_launch_error"),
        bad: true,
      });
    } finally {
      setBusy(false);
      refrescarEstado();
    }
  }

  async function detener() {
    if (escaneandoDecide === null) return;
    setCancelando(true);
    try {
      const r = escaneandoDecide ? await cancelDecision() : await cancelObservatorio();
      setMsg(r.cancelled
        ? { text: t("alpha_ops_cancel_requested") }
        : { text: t("alpha_ops_nothing_running"), bad: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : t("alpha_ops_cancel_error"), bad: true });
    } finally {
      setCancelando(false);
    }
  }

  return (
    <div className="border-t" style={{ borderColor: T.grid }}>
      {cfgOpen && (sel === "real" ? (
        <ScanConfigModal
          target="decide"
          onClose={() => setCfgOpen(false)}
          applied={decideCfg}
          onApply={(o) => { setDecideCfg(o); refrescarDecideCfg(); setCfgOpen(false); }} />
      ) : (
        <ScanConfigModal onClose={() => setCfgOpen(false)} applied={overrides}
                         onApply={(o) => { setOverrides(o); setCfgOpen(false); }} />
      ))}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b px-4 py-3.5"
           style={{ borderColor: T.grid }}>
        <span className="text-[16px] font-bold" style={{ color: T.ink }}>{t("alpha_ui_centro_de_operaciones")}</span>
        <InfoTip text={t("alpha_attr_todo_lo_que_se_puede_lanzar_desde_la_sala_agrupado_por_si_cuesta_dinero_o_no_los_escaneos_y_las_capt")} />
      </div>

      {/* Visible SIEMPRE que corre un escaneo, sea cual sea la pestaña abierta -- cortar rápido
          no puede depender de estar en la pestaña correcta. */}
      {escaneando && escaneandoDecide !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2"
             style={{ borderColor: T.grid, background: "rgba(233,163,44,0.08)" }}>
          <span className="text-[11px]" style={{ color: T.warn }}>{t("alpha_ui_corriendo")}{escaneandoDecide ? t("alpha_ops_decision_running") : t("alpha_ops_observatory_running")}
          </span>
          <button onClick={detener} disabled={cancelando}
                  className="rounded-full border px-3 py-1 text-[10.5px] font-semibold transition-colors hover:bg-white/5 disabled:opacity-50"
                  style={{ borderColor: T.bad, color: T.bad }}>
            {cancelando ? t("alpha_ops_cancelling") : t("alpha_ops_stop_scan")}
          </button>
        </div>
      )}

      {/* Tira de frescura: responde "¿puedo lanzar ya?" antes de pinchar nada. Texto plano
          apilado, sin caja por debajo -- como el resto de info-grids del mockup. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b px-4 py-4 sm:grid-cols-4"
           style={{ borderColor: T.grid }}>
        <Chip label={t("alpha_attr_ultimo_escaneo")}
              valor={report
                ? `${hace(report.at, t, locale)}${report.cost ? ` · $${report.cost.cost_usd.toFixed(2)}` : ""}`
                : "nunca"}
              malo={!report} />
        <Chip label={t("alpha_attr_foto_nasdaq")}
              valor={estado ? `${hace(estado.foto_nasdaq.at, t, locale)} · ${fmtNum(estado.foto_nasdaq.n)}` : cargando}
              malo={!!estado && !estado.foto_nasdaq.at} />
        <Chip label={t("alpha_attr_foto_global")}
              valor={estado ? `${hace(estado.foto_global.at, t, locale)} · ${fmtNum(estado.foto_global.n)}` : cargando}
              malo={!!estado && !estado.foto_global.at} />
        <Chip label={t("alpha_attr_tasas_usd")}
              valor={estado ? `${hace(estado.fx.at, t, locale)}${estado.fx.at ? ` · ${estado.fx.n} divisas` : ""}` : cargando}
              malo={!!estado && !estado.fx.at} />
      </div>

      {/* Antes menú lateral + panel de detalle a dos columnas; ahora dos filas de pills (como
          el mockup) y el detalle de la acción elegida se abre debajo, a todo lo ancho. Mismo
          estado, mismos handlers -- solo cambia el envoltorio visual. */}
      <div className="px-4 py-4">
        <Grupo titulo={t("alpha_attr_escanear_cuesta_dinero")} />
        <div className="mb-4 flex flex-wrap gap-2">
          {PAGO.map((k) => <Item key={k} k={k} sel={sel} activo={activo} onSel={elegir} />)}
        </div>
        <Grupo titulo={t("alpha_attr_datos_gratis")} />
        <div className="mb-1 flex flex-wrap gap-2">
          {GRATIS.map((k) => <Item key={k} k={k} sel={sel} activo={activo} onSel={elegir} />)}
        </div>

        <div className="mt-4 border-t pt-4" style={{ borderColor: T.grid }}>
          {activo ? (
            <EnMarcha p={progreso} />
          ) : (
            <>
              <div className="mb-1.5 flex flex-wrap items-start gap-2">
                <span className="text-[13.5px] font-bold" style={{ color: T.ink }}>{t(a.t)}</span>
                {info.badges.map(([texto, tono]) => (
                  <span key={texto} className="rounded-full px-2 py-0.5 text-[10px]"
                        style={{ background: TONOS[tono].bg, color: TONOS[tono].fg }}>
                    {texto.startsWith("alpha_") ? t(texto) : texto}
                  </span>
                ))}
              </div>
              <p className="mb-2.5 text-[11.5px] leading-relaxed" style={{ color: T.muted }}>{t(info.d)}</p>

              {a.aviso && (
                <p className="mb-2.5 border-l-2 pl-2.5 text-[10.5px]"
                   style={{ borderColor: T.bad, color: T.bad }}>
                  {t(a.aviso)}
                </p>
              )}

              <div>
                {a.uni && <SelectorUniverso uni={uni} onUni={setUni} estado={estado || null} />}
                {a.foto && (
                  // <div>, no <label>: un <label> solo reenvía el clic a un <input> real, y
                  // aquí el checkbox es un <button> propio -- clicar el texto no lo tocaría.
                  <div onClick={() => setReFoto((v) => !v)}
                       className="flex cursor-pointer items-start gap-2 py-1.5 text-[11px]" style={{ color: T.ink2 }}>
                    <Checkbox checked={reFoto} onChange={setReFoto} className="mt-0.5" />
                    <span>{t("alpha_ui_reutilizar_ultima_foto_de_fundamentales")}<span className="block text-[9.5px]" style={{ color: T.muted }}>{t("alpha_ui_salta_el_gather_20_40_min_y_usa_la_ultima_foto_de_cada_ticker_sea_de_cuando_sea")}</span>
                    </span>
                  </div>
                )}
                {a.cfg && (
                  <div className="flex flex-wrap items-start justify-between gap-2 py-1.5">
                    <span className="text-[11px]" style={{ color: T.ink2 }}>{t("alpha_ui_modelo_por_etapa")}{sel === "real" && (
                        <span className="ml-1 text-[9.5px]" style={{ color: T.muted }}>{t("alpha_ui_guardado_tambien_lo_usa_el_cron")}</span>
                      )}
                      {/* Lo que se va a mandar de verdad: override aplicado (del observatorio, o
                          la config guardada del escaneo con decisión), si no el default real de
                          `/config` -- nunca un valor fijo aquí, para ver antes de lanzar. */}
                      <span className="mt-0.5 grid gap-x-3 gap-y-0.5 text-[9.5px]"
                            style={{ color: T.muted, gridTemplateColumns: "auto auto auto" }}>
                        {ETAPAS_LLM.map(({ key, label }) => {
                          const o = (sel === "real" ? decideCfg : overrides)?.[key];
                          const d = llmDefaults?.[key];
                          const apagada = key === "mid" && capaMedia.valor === false;
                          const modelo = apagada ? "apagada" : o?.model ?? d?.model ?? "…";
                          const reasoning = apagada ? "" : o?.reasoning_effort ?? d?.reasoning_effort ?? "…";
                          return (
                            <span key={key} className="contents">
                              <span>{t(label)}:</span>
                              <span className={NUMS} style={{ color: T.ink2 }}>{modelo}</span>
                              <span>{reasoning}</span>
                            </span>
                          );
                        })}
                      </span>
                    </span>
                    <button onClick={() => setCfgOpen(true)}
                            className="rounded-full border px-2.5 py-1 text-[10.5px] transition-colors hover:bg-white/5"
                            style={{ borderColor: T.ring, color: T.ink2 }}>{t("alpha_ui_configurar")}</button>
                  </div>
                )}
                {a.cfg && (
                  <FilaInterruptor titulo={t("alpha_attr_capa_media")} s={capaMedia} label={t("alpha_attr_usar_capa_media")}
                                   on="(activa · vale para todos los escaneos)"
                                   off="(apagada · el profundo sale directo del prescore)" />
                )}
                {a.cfg && (
                  <FilaInterruptor titulo={t("alpha_attr_macro_en_jev")} s={jevMacro}
                                   label={t("alpha_attr_pasar_eventos_y_titulares_al_prescore_de_jev")}
                                   on="(datos + eventos + titulares · ≈ +$0,50 por escaneo)"
                                   off="(solo datos de mercado · DeepSeek ve siempre el macro completo)" />
                )}
                {sel === "foto" && (
                  <FuenteToggle fuente={fotoFuente} onFuente={setFotoFuente} />
                )}
                {sel === "fundam" && (
                  <FuenteToggle fuente={fundFuente} onFuente={setFundFuente} />
                )}
                {sel === "foto" && fotoFuente === "global" && <div className="py-1"><UniversoGlobalSync /></div>}
                {sel === "fundam" && fundFuente === "global" && <div className="py-1"><FotoGlobalPicker /></div>}
                {a.poda && <PodaResumen previa={podaPrevia} motivo={podaMotivo} />}
                {!a.uni && !a.foto && !a.cfg && !a.fuente && !a.poda && (
                  <p className="py-1 text-[10.5px]" style={{ color: T.muted }}>{t("alpha_ui_sin_opciones_se_lanza_tal_cual")}</p>
                )}
              </div>

              {/* Los pickers globales lanzan por su cuenta (llevan sus propios filtros y confirmación). */}
              {!mostrarPickerGlobal && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {armed ? (
                    <>
                      <span className="flex-1 text-[10.5px]" style={{ color: T.warn }}>
                        {PAGO.includes(sel) ? t("alpha_ops_real_cost") : ""}{t("alpha_ui_confirmas")}</span>
                      <button onClick={lanzar} disabled={busy || podaBloqueada}
                              className="rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                              style={a.peligro ? { background: T.bad, color: "#fff" }
                                : PAGO.includes(sel) ? { background: T.warn, color: "#0d0d0d" }
                                : { background: T.buy, color: "#fff" }}>
                        {busy ? t("alpha_ops_launching") : t("alpha_ops_confirm")}
                      </button>
                      <button onClick={() => setArmed(false)} disabled={busy}
                              className="rounded-full border px-3 py-1.5 text-[11.5px] transition-colors hover:bg-white/5"
                              style={{ borderColor: T.ring, color: T.ink2 }}>{t("alpha_ui_cancelar")}</button>
                    </>
                  ) : (
                    <button onClick={() => setArmed(true)} disabled={busy || podaBloqueada}
                            className="rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                            style={a.peligro ? { background: T.bad, color: "#fff" }
                              : PAGO.includes(sel) ? { background: T.warn, color: "#0d0d0d" }
                              : { background: T.buy, color: "#fff" }}>
                      {busy ? t("alpha_ops_launching") : t(info.cta)}
                    </button>
                  )}
                </div>
              )}

              {msg && (
                <p className="mt-2 text-[10.5px]" style={{ color: msg.bad ? T.warn : T.muted }}>{msg.text}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const FASES_PODA: Record<string, string> = {
  preparando: "alpha_ops_prune_preparing",
  llm_call: "alpha_ops_prune_emptying",
  vacuum: "alpha_ops_prune_reclaiming",
};

function textoAvancePoda(e: PodaEstado, t: Text): string {
  const fase = t(FASES_PODA[e.fase ?? ""] ?? "alpha_ops_pruning");
  return e.total ? t("alpha_ops_prune_progress", { phase: fase, done: e.hechas, total: e.total }) : `${fase}…`;
}

type ResultadoTabla = { vaciadas?: number; sin_archivar?: number };

function textoResultadoPoda(e: PodaEstado, t: Text): string {
  const r = (e.result ?? {}) as Record<string, ResultadoTabla>;
  const l = r.llm_call ?? {};
  const sin = l.sin_archivar ?? 0;
  return t("alpha_ops_prune_result", { count: l.vaciadas ?? 0 })
    + (sin ? " " + t("alpha_ops_prune_retained", { count: sin }) : "");
}

/** Lo que borraría la poda ahora: sale de `GET /admin/poda`, recalculado al elegirla. */
function PodaResumen({ previa, motivo }: { previa: PodaPrevia | null | false; motivo: string | null }) {
  const t = useTranslations();
  if (previa === null) {
    return <p className="py-1 text-[10.5px]" style={{ color: T.muted }}>{t("alpha_ui_calculando_que_se_puede_podar")}</p>;
  }
  if (previa === false) {
    return <p className="py-1 text-[10.5px]" style={{ color: T.warn }}>{motivo}</p>;
  }
  const nada = previa.texto_llm.llamadas === 0;
  const sinArchivar = previa.texto_llm.sin_archivar;
  return (
    <div className="py-1.5 text-[11px] leading-relaxed" style={{ color: T.ink2 }}>
      {nada ? (
        <p style={{ color: T.muted }}>{t("alpha_ui_nada_que_podar_ahora_todo_lo_que_hay_se_queda_por_las_reglas")}</p>
      ) : (
        <>
          <p>{t("alpha_ui_deja_libres_unos")}<span className={NUMS} style={{ color: T.ink }}>
              {previa.mb_total.toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB
            </span>{t("alpha_ui_para_lo_que_entre_despues")}</p>
          <p className={`mt-1 ${NUMS}`}>{t("alpha_ui_se_vacia_el_texto_de")}{fmtNum(previa.texto_llm.llamadas)}{t("alpha_ui_llamadas")}</p>
        </>
      )}
      {sinArchivar > 0 && (
        <p className="mt-1" style={{ color: T.warn }}>
          {fmtNum(sinArchivar)}{t("alpha_ui_filas_no_estan_en_el_archivo_y_no_se_tocan")}</p>
      )}
      <p className="mt-1 text-[9.5px]" style={{ color: T.muted }}>{t("alpha_ui_solo_se_vacia_el_texto_de_las_llamadas_de_mas_de")}{previa.reglas.dias_texto_llm}{t("alpha_ui_dias")}</p>
    </div>
  );
}

function FilaInterruptor({ titulo, s, label, on, off }: {
  titulo: string; s: ReturnType<typeof useInterruptor>; label: string; on: string; off: string;
}) {
  const t = useTranslations();
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-[11px]" style={{ color: T.ink2 }}>
        {titulo}
        <span className="ml-1 text-[9.5px]" style={{ color: T.muted }}>
          {s.valor === null ? (s.err ? "" : t("alpha_ops_reading")) : s.valor ? on : off}
        </span>
        {s.err && <span className="block text-[9.5px]" style={{ color: T.bad }}>{s.err}</span>}
      </span>
      <Toggle checked={s.valor === true} onChange={s.cambiar}
              disabled={s.valor === null || s.busy} label={label} />
    </div>
  );
}

function Chip({ label, valor, malo }: { label: string; valor: string; malo?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide" style={{ color: T.muted }}>{label}</div>
      <div className={`mt-1 text-[12.5px] ${NUMS}`} style={{ color: malo ? T.bad : T.ink2 }}>{valor}</div>
    </div>
  );
}

function Grupo({ titulo }: { titulo: string }) {
  return (
    <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
      {titulo}
    </p>
  );
}

// Pill, no fila de menú: elegir una acción es solo ver su detalle debajo, nunca lanzarla --
// por eso el resaltado es siempre el mismo teal (el rojo/ámbar se reserva para el botón de
// confirmar, el momento real de "esto cuesta o escribe cartera").
function Item({ k, sel, activo, onSel }: {
  k: Key; sel: Key; activo: boolean; onSel: (k: Key) => void;
}) {
  const t = useTranslations();
  const a = ACCIONES[k];
  const on = k === sel && !activo;
  return (
    <button onClick={() => onSel(k)} aria-selected={on} role="tab"
            className="rounded-full px-3.5 py-1.5 text-left text-[12px] font-semibold transition-colors"
            style={on
              ? { background: T.buy, color: "#fff" }
              : { background: T.panel2, color: T.ink2, border: `1px solid ${T.ring}` }}>
      {t(a.t)}
    </button>
  );
}

function SelectorUniverso({ uni, onUni, estado }: {
  uni: ModoUniverso; onUni: (u: ModoUniverso) => void; estado: EstadoDatos | null;
}) {
  const t = useTranslations();
  // "elegibles" = pasa precio/cap/tipo de instrumento; "a escanear" = tras liquidez y tope.
  const opciones: { v: ModoUniverso; t: string; sub: string }[] = [
    { v: "nasdaq", t: "NASDAQ",
      sub: estado?.universo.at
        ? `${fmtNum(estado.universo.elegibles)} disponibles · ${fmtNum(estado.universo.a_escanear)} a escanear`
        : t("alpha_ops_usual_universe") },
    { v: "global_topcap", t: t("alpha_ops_global_marketcap"),
      sub: t("alpha_ops_global_usd") },
  ];
  // El top global se ordena por `market_cap_usd`, que solo existe si las tasas ya corrieron:
  // sin ellas el escaneo abortaría con "sin candidatos", mejor avisarlo antes de gastar. Avisa
  // salvo que el estado HAYA confirmado que sí hay tasas -- si el chip no cargó (t("alpha_ops_unread")),
  // más vale un aviso de más que dejar pasar un escaneo que va a abortar seguro.
  const tasasConfirmadas = estado && estado.fx.at;
  const sinTasas = uni === "global_topcap" && !tasasConfirmadas;
  return (
    <div className="py-1.5">
      <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>{t("alpha_ui_universo")}</div>
      <div className="flex flex-wrap gap-1.5">
        {opciones.map((o) => (
          <button key={o.v} onClick={() => onUni(o.v)}
                  className="rounded border px-2 py-1.5 text-left text-[11px] transition-colors"
                  style={{
                    borderColor: uni === o.v ? T.buy : T.ring,
                    background: uni === o.v ? "rgba(57,135,229,0.12)" : "transparent",
                    color: uni === o.v ? T.ink : T.ink2,
                  }}>
            {o.t}
            <span className="block text-[9.5px]" style={{ color: T.muted }}>{o.sub}</span>
          </button>
        ))}
      </div>
      {sinTasas && (
        <p className="mt-1.5 text-[10px]" style={{ color: T.warn }}>{t("alpha_ui_las_tasas_de_cambio_no_se_han_sincronizado_nunca_sin_ellas_este_universo_sale_vacio_lanzalas_primero_desde_tas")}</p>
      )}
    </div>
  );
}

/** NASDAQ/Global para "Foto del universo" y "Fundamentales universo" -- cada fuente cambia
 *  qué se lanza y con qué UI, no solo un filtro sobre la misma acción. */
function FuenteToggle({ fuente, onFuente }: { fuente: Fuente; onFuente: (f: Fuente) => void }) {
  const opciones: { v: Fuente; t: string }[] = [{ v: "nasdaq", t: "NASDAQ" }, { v: "global", t: "Global" }];
  return (
    <div className="flex gap-1.5 py-1.5">
      {opciones.map((o) => (
        <button key={o.v} onClick={() => onFuente(o.v)}
                className="rounded border px-2.5 py-1 text-[11px] transition-colors"
                style={{
                  borderColor: fuente === o.v ? T.buy : T.ring,
                  background: fuente === o.v ? "rgba(57,135,229,0.12)" : "transparent",
                  color: fuente === o.v ? T.ink : T.ink2,
                }}>
          {o.t}
        </button>
      ))}
    </div>
  );
}

/** Estado en marcha: etapa, barra y contadores del trabajo vivo. Todo sale de `/scan/progress`,
 *  incluida la unidad — en `deep` cuenta finalistas, no tickers, y decirlo mal confunde. */
function EnMarcha({ p }: { p: ScanProgress | null }) {
  const t = useTranslations();
  const esFoto = p?.stage === "foto";
  const etapaActual = p?.stage === "gather_retry" ? "gather" : p?.stage;
  const idx = ETAPAS.findIndex((e) => e.k === etapaActual);
  const pct = p?.total ? Math.min(100, (p.done / p.total) * 100) : null;
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-bold" style={{ color: T.ink }}>
          {esFoto ? t("alpha_ops_gathering") : t("alpha_ops_scan_running")}
        </span>
        <span className="rounded px-1.5 py-0.5 text-[10px]"
              style={{ background: TONOS.info.bg, color: TONOS.info.fg }}>
          {p?.stage === "gather_retry" ? t("alpha_ops_retrying_data") : (ETAPAS[idx] ? t(ETAPAS[idx].t) : p?.stage) ?? t("alpha_ops_starting")}
        </span>
      </div>

      <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: T.grid }}>
        <div className="h-full rounded-full transition-[width]"
             style={{ width: pct != null ? `${pct}%` : "100%",
                      background: pct != null ? T.buy : T.base }} />
      </div>
      <div className={`mb-3 text-[11px] ${NUMS}`} style={{ color: T.ink2 }}>
        {p?.total
          ? <>{fmtNum(p.done)} / {fmtNum(p.total)} {p.unit ?? ""} · <span style={{ color: T.good }}>{fmtNum(p.ok)} ok</span>
              {p.fail ? <> · <span style={{ color: T.bad }}>{fmtNum(p.fail)}{t("alpha_ui_sin_datos")}</span></> : null}</>
          : <span style={{ color: T.muted }}>{t("alpha_ui_sin_contador_en_esta_etapa")}</span>}
      </div>

      {!esFoto && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ETAPAS.map((e, i) => (
            <span key={e.k} className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: "rgba(255,255,255,0.05)",
                           color: i < idx ? T.good : i === idx ? T.buy : T.muted }}>
              {t(e.t)}
            </span>
          ))}
        </div>
      )}

      <p className="border-t pt-2 text-[10.5px] leading-relaxed"
         style={{ borderColor: T.grid, color: T.muted }}>
        {esFoto
          ? t("alpha_ops_capture_background")
          : t("alpha_ops_scan_result_location")}
      </p>
    </>
  );
}
