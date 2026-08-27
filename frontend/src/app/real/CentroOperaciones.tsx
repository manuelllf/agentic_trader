"use client";

/** Centro de operaciones: la ÚNICA card que lanza cosas en Sala Real.
 *
 *  Antes había nueve acciones repartidas en cuatro sitios (cabecera, "ajustar sin re-escanear",
 *  "fotos", el enlace de sincronizar de analítica) y ninguna decía si costaba dinero. Aquí el
 *  único eje de agrupación es ese: cuesta o no cuesta. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError, getEstadoDatos, recheck, redeep, runDemo, snapshotUniverse, startFoto, syncAnalytics,
  syncFx, fetchScanProgress, type EstadoDatos, type ScanProgress, type ScanReport,
} from "@/lib/api";
import { fmtNum } from "@/lib/scan";
import type { DemoRunOverrides } from "@/lib/types";
import { FotoGlobalPicker } from "./FotoGlobalPicker";
import { InfoTip } from "./InfoTip";
import { ScanConfigModal } from "./ScanConfigModal";
import { NUMS, T } from "./tokens";

type Key = "obs" | "redeep" | "recomp" | "real" | "universo" | "fnas" | "fglo" | "fx" | "anal";
type ModoUniverso = "nasdaq" | "global_topcap";
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
  global?: boolean;      // embebe el picker de país/mercado
  aviso?: string;
}

const PAGO: Key[] = ["obs", "redeep", "recomp", "real"];
const GRATIS: Key[] = ["universo", "fnas", "fglo", "fx", "anal"];

const ACCIONES: Record<Key, Accion> = {
  obs: {
    t: "Escaneo observatorio",
    d: "El circuito exacto del mensual con modelo y coste reales, sin proponer ni tocar ninguna "
      + "cartera. Refresca ranking, watchlist, memoria y traza.",
    cta: "Lanzar observatorio", badges: [["≈ $1,60", "coste"], ["no toca cartera", "neutro"]],
    uni: true, foto: true, cfg: true,
  },
  redeep: {
    t: "Reanalizar con macro de hoy",
    d: "Vuelve a juzgar a fondo solo los nombres ya analizados, con el macro de hoy. No "
      + "re-escanea el universo.",
    cta: "Reanalizar", badges: [["≈ $0,04", "coste"]], peligro: true,
  },
  recomp: {
    t: "Recomponer cartera",
    d: "Reconstruye la cartera sobre los informes ya analizados aplicando el suelo de score y los "
      + "límites de posición ACTUALES. No re-puntúa nada: solo reasigna pesos.",
    cta: "Recomponer", badges: [["1 llamada al constructor", "coste"]], peligro: true,
    aviso: "Escribe una propuesta nueva que pisa la vigente.",
  },
  real: {
    t: "Escaneo con decisión",
    d: "Puntúa el universo, forma la cartera del mes y te la propone para tu sí o no.",
    cta: "Lanzar con decisión", badges: [["≈ $1,60", "coste"], ["escribe cartera", "malo"]],
    peligro: true, uni: true, foto: true,
    aviso: "El único de la lista que escribe propuesta y ejecuta el libro sombra.",
  },
  universo: {
    t: "Foto del universo",
    d: "Rehace el screener del cierre de NASDAQ (precio y volumen) que define qué nombres son "
      + "elegibles para el próximo escaneo.",
    cta: "Rehacer foto", badges: [["~10 s", "neutro"]],
  },
  fnas: {
    t: "Fundamentales NASDAQ",
    d: "Captura los fundamentales de los nombres elegibles sin puntuar nada. Un escaneo posterior "
      + "reutiliza esta foto si tiene menos de 12 h.",
    cta: "Capturar", badges: [["~20 min", "neutro"]],
  },
  fglo: {
    t: "Fundamentales global",
    d: "Captura el universo global entero. Filtrable por país y mercado antes de gastar peticiones "
      + "reales — son horas, no minutos.",
    cta: "Capturar", badges: [["~4 h", "neutro"]], global: true,
  },
  fx: {
    t: "Tasas de cambio",
    d: "Pide el cambio a USD de las divisas del universo y recalcula el market cap en dólares de "
      + "las fotos recientes. Corre sola a las 5:00.",
    cta: "Sincronizar tasas", badges: [["~2 s", "neutro"]],
  },
  anal: {
    t: "Analítica del método",
    d: "Reconstruye el fichero DuckDB que alimenta las tablas de PER por sector, coste por etapa y "
      + "confianza del prescore. Corre sola a diario.",
    cta: "Sincronizar", badges: [["~5 s", "neutro"]],
  },
};

// Etapas REALES de `scan_progress.set_stage()` en el backend. `gather_retry` se pinta como parte
// de gather (es su reintento, no una fase aparte) y `mid` solo se ilumina si la capa media corre.
const ETAPAS: { k: string; t: string }[] = [
  { k: "gather", t: "datos" }, { k: "macro", t: "macro" }, { k: "prescore", t: "prescore" },
  { k: "mid", t: "capa media" }, { k: "deep", t: "profundo" }, { k: "constructor", t: "cartera" },
];

const TONOS: Record<Tono, { bg: string; fg: string }> = {
  coste: { bg: "rgba(250,178,25,0.14)", fg: T.warn },
  info: { bg: "rgba(57,135,229,0.16)", fg: "#85b7eb" },
  malo: { bg: "rgba(208,59,59,0.14)", fg: T.bad },
  neutro: { bg: "rgba(255,255,255,0.06)", fg: T.ink2 },
};

/** "hace 6 h" / "nunca" — la antigüedad importa más que la hora exacta para decidir si relanzar. */
function hace(at: string | null): string {
  if (!at) return "nunca";
  const min = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

export function CentroOperaciones({ report, escaneando, onScanStarted, onReload, onLoadAnalytics }: {
  report: ScanReport | null;
  escaneando: boolean;
  onScanStarted: () => void;
  onReload: () => void;
  onLoadAnalytics: () => void;
}) {
  const [sel, setSel] = useState<Key>("obs");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [uni, setUni] = useState<ModoUniverso>("nasdaq");
  const [reFoto, setReFoto] = useState(false);
  const [overrides, setOverrides] = useState<DemoRunOverrides | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  // `null` = cargando, `false` = no se pudo leer. Distinguirlos importa: un chip clavado en "…"
  // parece que sigue cargando cuando en realidad el endpoint está devolviendo error.
  const [estado, setEstado] = useState<EstadoDatos | null | false>(null);
  const [progreso, setProgreso] = useState<ScanProgress | null>(null);
  // Foto lanzada por nosotros: el escaneo lo sabe la página (`escaneando`), pero la captura no
  // pasa por `/demo/status`, así que su "en marcha" se sigue aquí.
  const [fotoPropia, setFotoPropia] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refrescarEstado = useCallback(() => {
    getEstadoDatos().then(setEstado).catch(() => setEstado(false));
  }, []);
  useEffect(() => { refrescarEstado(); }, [refrescarEstado]);

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
  const cargando = estado === false ? "sin leer" : "…";
  const elegir = (k: Key) => { setSel(k); setArmed(false); setMsg(null); };

  async function lanzar() {
    setArmed(false);
    setBusy(true);
    setMsg(null);
    try {
      switch (sel) {
        case "obs":
          await runDemo({ decide: false, forceMidLayer: true, modoUniverso: uni,
                          reutilizarUltimaFoto: reFoto, overrides: overrides ?? undefined });
          onScanStarted();
          break;
        case "real":
          await runDemo({ modoUniverso: uni, reutilizarUltimaFoto: reFoto });
          onScanStarted();
          break;
        case "redeep":
          await redeep();
          setMsg({ text: "Reanálisis a fondo completado con el macro de hoy." });
          onReload();
          break;
        case "recomp":
          await recheck();
          setMsg({ text: "Cartera recompuesta y propuesta nueva escrita." });
          onReload();
          break;
        case "universo": {
          // El backend responde 200 con `ok: false` cuando NASDAQ no coopera — no es un fallo
          // de red, así que el motivo se lee del cuerpo y no del catch.
          const r = await snapshotUniverse();
          setMsg(r.ok
            ? { text: `Foto rehecha: ${r.size != null ? fmtNum(r.size) : "—"} nombres elegibles.` }
            : { text: r.error ?? "No se pudo rehacer la foto del universo.", bad: true });
          break;
        }
        case "fnas":
          await startFoto("nasdaq");
          setFotoPropia(true);
          break;
        case "fx": {
          const r = await syncFx();
          setMsg(r.ok
            ? { text: `${r.divisas ?? 0} divisas sincronizadas · ${fmtNum(r.recalculadas ?? 0)} fotos recalculadas a USD.` }
            : { text: r.error ?? "No se pudieron sincronizar las tasas.", bad: true });
          break;
        }
        case "anal": {
          const r = await syncAnalytics();
          setMsg({ text: `Sincronizado (${Object.entries(r.counts).map(([t, n]) => `${t}: ${n}`).join(", ")}).` });
          onLoadAnalytics();
          break;
        }
      }
    } catch (e) {
      // "anal"/"fx" hacen trabajo real y síncrono en el backend (reconstruir DuckDB, o levantar
      // el scraper de Yahoo + recalcular) -- si el timeout del cliente corta antes de que
      // termine, el backend puede seguir trabajando. Decirlo tal cual, no "falló".
      const esLargo = sel === "anal" || sel === "fx";
      const esTimeout = e instanceof ApiError && e.kind === "network" && /timeout/i.test(e.message);
      setMsg({
        text: esLargo && esTimeout
          ? "El navegador dejó de esperar, pero el backend puede seguir trabajando — revisa la "
           + "tira de estado en un momento antes de repetirlo."
          : e instanceof Error ? e.message : "No se pudo lanzar.",
        bad: true,
      });
    } finally {
      setBusy(false);
      refrescarEstado();
    }
  }

  return (
    <div className="rounded-lg border" style={{ borderColor: T.ring, background: T.panel }}>
      {cfgOpen && (
        <ScanConfigModal onClose={() => setCfgOpen(false)}
                         onApply={(o) => { setOverrides(o); setCfgOpen(false); }} />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5"
           style={{ borderColor: T.grid }}>
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
          Centro de operaciones
        </span>
        <InfoTip text="Todo lo que se puede lanzar desde la sala, agrupado por si cuesta dinero o no. Los escaneos y las capturas no pueden correr a la vez: el backend los excluye." />
      </div>

      {/* Tira de frescura: responde "¿puedo lanzar ya?" antes de pinchar nada. */}
      <div className="grid gap-1.5 border-b px-4 py-2.5 sm:grid-cols-2 lg:grid-cols-4"
           style={{ borderColor: T.grid }}>
        <Chip label="Último escaneo"
              valor={report
                ? `${hace(report.at)}${report.cost ? ` · $${report.cost.cost_usd.toFixed(2)}` : ""}`
                : "nunca"}
              malo={!report} />
        <Chip label="Foto NASDAQ"
              valor={estado ? `${hace(estado.foto_nasdaq.at)} · ${fmtNum(estado.foto_nasdaq.n)}` : cargando}
              malo={!!estado && !estado.foto_nasdaq.at} />
        <Chip label="Foto global"
              valor={estado ? `${hace(estado.foto_global.at)} · ${fmtNum(estado.foto_global.n)}` : cargando}
              malo={!!estado && !estado.foto_global.at} />
        <Chip label="Tasas USD"
              valor={estado ? `${hace(estado.fx.at)}${estado.fx.at ? ` · ${estado.fx.n} divisas` : ""}` : cargando}
              malo={!!estado && !estado.fx.at} />
      </div>

      <div className="grid lg:grid-cols-[200px_minmax(0,1fr)]">
        <div className="border-b pb-2 lg:border-b-0 lg:border-r" style={{ borderColor: T.grid }}>
          <Grupo titulo="Escanear · cuesta dinero" />
          {PAGO.map((k) => <Item key={k} k={k} sel={sel} activo={activo} onSel={elegir} />)}
          <Grupo titulo="Datos · gratis" />
          {GRATIS.map((k) => <Item key={k} k={k} sel={sel} activo={activo} onSel={elegir} />)}
        </div>

        <div className="min-w-0 px-4 py-3">
          {activo ? (
            <EnMarcha p={progreso} />
          ) : (
            <>
              <div className="mb-1.5 flex flex-wrap items-start gap-2">
                <span className="text-[13.5px] font-bold" style={{ color: T.ink }}>{a.t}</span>
                {a.badges.map(([texto, tono]) => (
                  <span key={texto} className="rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: TONOS[tono].bg, color: TONOS[tono].fg }}>
                    {texto}
                  </span>
                ))}
              </div>
              <p className="mb-2.5 text-[11.5px] leading-relaxed" style={{ color: T.muted }}>{a.d}</p>

              {a.aviso && (
                <p className="mb-2.5 rounded border px-2.5 py-1.5 text-[10.5px]"
                   style={{ borderColor: "rgba(208,59,59,0.4)", background: "rgba(208,59,59,0.07)", color: "#e66767" }}>
                  {a.aviso}
                </p>
              )}

              <div className="border-t pt-2" style={{ borderColor: T.grid }}>
                {a.uni && <SelectorUniverso uni={uni} onUni={setUni} estado={estado || null} />}
                {a.foto && (
                  <label className="flex cursor-pointer items-start gap-2 py-1.5 text-[11px]" style={{ color: T.ink2 }}>
                    <input type="checkbox" checked={reFoto} onChange={(e) => setReFoto(e.target.checked)}
                           className="mt-0.5 h-3 w-3" />
                    <span>
                      Reutilizar última foto de fundamentales
                      <span className="block text-[9.5px]" style={{ color: T.muted }}>
                        Salta el gather (~20-40 min) y usa la última foto de cada ticker, sea de cuando sea.
                      </span>
                    </span>
                  </label>
                )}
                {a.cfg && (
                  <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="text-[11px]" style={{ color: T.ink2 }}>
                      Modelo por etapa
                      <span className="block text-[9.5px]" style={{ color: T.muted }}>
                        {overrides ? "configuración propia aplicada" : "los valores de producción"}
                      </span>
                    </span>
                    <button onClick={() => setCfgOpen(true)}
                            className="rounded border px-2.5 py-1 text-[10.5px] transition-colors hover:bg-white/5"
                            style={{ borderColor: T.ring, color: T.ink2 }}>
                      Configurar
                    </button>
                  </div>
                )}
                {a.global && <div className="py-1"><FotoGlobalPicker /></div>}
                {!a.uni && !a.foto && !a.cfg && !a.global && (
                  <p className="py-1 text-[10.5px]" style={{ color: T.muted }}>Sin opciones — se lanza tal cual.</p>
                )}
              </div>

              {/* El picker global lanza por su cuenta (lleva sus propios filtros y confirmación). */}
              {!a.global && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {armed ? (
                    <>
                      <span className="flex-1 text-[10.5px]" style={{ color: T.warn }}>
                        {PAGO.includes(sel) ? "Cuesta dinero real. " : ""}¿Confirmas?
                      </span>
                      <button onClick={lanzar} disabled={busy}
                              className="rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                              style={a.peligro ? { background: T.bad, color: "#fff" }
                                : PAGO.includes(sel) ? { background: T.warn, color: "#0d0d0d" }
                                : { background: T.buy, color: "#fff" }}>
                        {busy ? "Lanzando…" : "Confirmar"}
                      </button>
                      <button onClick={() => setArmed(false)} disabled={busy}
                              className="rounded-full border px-3 py-1.5 text-[11.5px] transition-colors hover:bg-white/5"
                              style={{ borderColor: T.ring, color: T.ink2 }}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setArmed(true)} disabled={busy}
                            className="rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                            style={a.peligro ? { background: T.bad, color: "#fff" }
                              : PAGO.includes(sel) ? { background: T.warn, color: "#0d0d0d" }
                              : { background: T.buy, color: "#fff" }}>
                      {busy ? "Lanzando…" : a.cta}
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

function Chip({ label, valor, malo }: { label: string; valor: string; malo?: boolean }) {
  return (
    <div className="rounded px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)" }}>
      <div className="text-[9.5px]" style={{ color: T.muted }}>{label}</div>
      <div className={`text-[11.5px] ${NUMS}`} style={{ color: malo ? T.bad : T.ink2 }}>{valor}</div>
    </div>
  );
}

function Grupo({ titulo }: { titulo: string }) {
  return (
    <div className="px-3 pb-1 pt-2.5 text-[9.5px] font-semibold uppercase tracking-wider"
         style={{ color: T.muted }}>
      {titulo}
    </div>
  );
}

function Item({ k, sel, activo, onSel }: {
  k: Key; sel: Key; activo: boolean; onSel: (k: Key) => void;
}) {
  const a = ACCIONES[k];
  const on = k === sel && !activo;
  return (
    <button onClick={() => onSel(k)} aria-selected={on} role="tab"
            className="block w-full border-l-2 px-3 py-1.5 text-left text-[11.5px] leading-tight transition-colors hover:bg-white/5"
            style={{
              borderLeftColor: on ? (a.peligro ? T.bad : T.buy) : "transparent",
              background: on ? "rgba(255,255,255,0.06)" : "transparent",
              color: on ? T.ink : T.ink2,
            }}>
      {a.t}
    </button>
  );
}

function SelectorUniverso({ uni, onUni, estado }: {
  uni: ModoUniverso; onUni: (u: ModoUniverso) => void; estado: EstadoDatos | null;
}) {
  const opciones: { v: ModoUniverso; t: string; sub: string }[] = [
    { v: "nasdaq", t: "NASDAQ",
      sub: estado?.universo.at ? `${fmtNum(estado.universo.n)} nombres` : "el de siempre" },
    { v: "global_topcap", t: "Top 3.000 market cap",
      sub: "global en USD · solo IBKR" },
  ];
  // El top global se ordena por `market_cap_usd`, que solo existe si las tasas ya corrieron:
  // sin ellas el escaneo abortaría con "sin candidatos", mejor avisarlo antes de gastar. Avisa
  // salvo que el estado HAYA confirmado que sí hay tasas -- si el chip no cargó ("sin leer"),
  // más vale un aviso de más que dejar pasar un escaneo que va a abortar seguro.
  const tasasConfirmadas = estado && estado.fx.at;
  const sinTasas = uni === "global_topcap" && !tasasConfirmadas;
  return (
    <div className="py-1.5">
      <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
        Universo
      </div>
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
        <p className="mt-1.5 text-[10px]" style={{ color: T.warn }}>
          Las tasas de cambio no se han sincronizado nunca — sin ellas este universo sale vacío.
          Lánzalas primero desde «Tasas de cambio».
        </p>
      )}
    </div>
  );
}

/** Estado en marcha: etapa, barra y contadores del trabajo vivo. Todo sale de `/scan/progress`,
 *  incluida la unidad — en `deep` cuenta finalistas, no tickers, y decirlo mal confunde. */
function EnMarcha({ p }: { p: ScanProgress | null }) {
  const esFoto = p?.stage === "foto";
  const etapaActual = p?.stage === "gather_retry" ? "gather" : p?.stage;
  const idx = ETAPAS.findIndex((e) => e.k === etapaActual);
  const pct = p?.total ? Math.min(100, (p.done / p.total) * 100) : null;
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-bold" style={{ color: T.ink }}>
          {esFoto ? "Capturando fundamentales" : "Escaneo en marcha"}
        </span>
        <span className="rounded px-1.5 py-0.5 text-[10px]"
              style={{ background: TONOS.info.bg, color: TONOS.info.fg }}>
          {p?.stage === "gather_retry" ? "reintentando datos" : ETAPAS[idx]?.t ?? p?.stage ?? "arrancando"}
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
              {p.fail ? <> · <span style={{ color: T.bad }}>{fmtNum(p.fail)} sin datos</span></> : null}</>
          : <span style={{ color: T.muted }}>sin contador en esta etapa</span>}
      </div>

      {!esFoto && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ETAPAS.map((e, i) => (
            <span key={e.k} className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: "rgba(255,255,255,0.05)",
                           color: i < idx ? T.good : i === idx ? T.buy : T.muted }}>
              {e.t}
            </span>
          ))}
        </div>
      )}

      <p className="border-t pt-2 text-[10.5px] leading-relaxed"
         style={{ borderColor: T.grid, color: T.muted }}>
        {esFoto
          ? "La captura no bloquea nada: puedes cerrar la sala y seguirá corriendo."
          : "Al terminar, el resultado aparece justo debajo en «Último escaneo»."}
      </p>
    </>
  );
}
