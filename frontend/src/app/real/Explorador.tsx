"use client";

/** Explorador de universo: filtro combinable (sector, país, mercado, market cap, PER, cerca de
 *  máximos...) sobre las fotos de fundamentales ya capturadas — para leer situaciones de mercado
 *  e histórico, SIN objetivo de escaneo (ese universo sigue siendo el de siempre, esto no lo
 *  toca ni lo alimenta). Nada se guarda: cada consulta es de usar y ver.
 *
 *  Mismo patrón de recuento en vivo que `FotoGlobalPicker` (recuenta en el backend cada vez que
 *  cambia el filtro, nunca suma cosas en el cliente), aplicado a explorar en vez de a dimensionar
 *  una captura. */

import { useEffect, useState } from "react";
import {
  fetchExplorerContar, fetchExplorerOpciones, fetchExplorerTickers,
} from "@/lib/api";
import type { ExplorerContar, ExplorerFiltros, ExplorerOpciones, ExplorerTickerRow } from "@/lib/types";
import { fmtNum } from "@/lib/scan";
import { InfoTip } from "./InfoTip";
import { NUM_INPUT, NUMS, T } from "./tokens";

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 400;

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
            className="rounded-full border px-2.5 py-1 text-[11px] transition-colors"
            style={{
              borderColor: active ? T.buy : T.ring,
              background: active ? "rgba(57,135,229,0.15)" : "transparent",
              color: active ? T.buy : T.ink2,
            }}>
      {label}
    </button>
  );
}

function ChipGroup({ title, options, selected, onToggle, max = 24 }: {
  title: string; options: string[]; selected: string[]; onToggle: (v: string) => void; max?: number;
}) {
  const [expandido, setExpandido] = useState(false);
  if (options.length === 0) return null;
  const visibles = expandido ? options : options.slice(0, max);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
        {title}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {visibles.map((o) => (
          <Chip key={o} label={o} active={selected.includes(o)} onClick={() => onToggle(o)} />
        ))}
        {!expandido && options.length > max && (
          <button onClick={() => setExpandido(true)}
                  className="text-[11px] underline" style={{ color: T.muted }}>
            +{options.length - max} más
          </button>
        )}
      </div>
    </div>
  );
}

/** Par de campos min/max compactos, para mobile y desktop igual — no hay versión "más simple"
 *  para móvil, un rango numérico ya es lo mínimo posible. */
function RangoNumerico({ label, min, max, onMin, onMax, prefijo = "" }: {
  label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void;
  prefijo?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
        {label}
      </span>
      <span className="flex items-center gap-1.5">
        {prefijo && <span className="text-[11px]" style={{ color: T.muted }}>{prefijo}</span>}
        <input type="number" inputMode="decimal" placeholder="mín" value={min}
               onChange={(e) => onMin(e.target.value)}
               className={`w-full min-w-0 rounded border bg-transparent px-2 py-1 text-[11.5px] ${NUMS} ${NUM_INPUT}`}
               style={{ borderColor: T.ring, color: T.ink }} />
        <span style={{ color: T.muted }}>–</span>
        <input type="number" inputMode="decimal" placeholder="máx" value={max}
               onChange={(e) => onMax(e.target.value)}
               className={`w-full min-w-0 rounded border bg-transparent px-2 py-1 text-[11.5px] ${NUMS} ${NUM_INPUT}`}
               style={{ borderColor: T.ring, color: T.ink }} />
      </span>
    </label>
  );
}

function DistCard({ label, dist, fmt }: {
  label: string; dist: { p25: number; p50: number; p75: number } | undefined;
  fmt: (n: number) => string;
}) {
  if (!dist) return null;
  return (
    <div className="rounded border px-3 py-2" style={{ borderColor: T.grid, background: T.panel2 }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>{label}</p>
      <p className={`mt-0.5 text-[15px] font-bold ${NUMS}`} style={{ color: T.ink }}>{fmt(dist.p50)}</p>
      <p className={`text-[10.5px] ${NUMS}`} style={{ color: T.muted }}>
        {fmt(dist.p25)} – {fmt(dist.p75)} <span style={{ color: T.ink2 }}>(p25–p75)</span>
      </p>
    </div>
  );
}

const fmtCapB = (n: number) => `$${(n / 1e9).toFixed(1)}B`;
const fmtMoney = (n: number) => `$${n.toFixed(2)}`;
const fmtRatio = (n: number) => n.toFixed(1);

export function Explorador() {
  const [opciones, setOpciones] = useState<ExplorerOpciones | null>(null);
  const [errorOpciones, setErrorOpciones] = useState("");

  const [alcance, setAlcance] = useState<"" | "global" | "escaneo">("");
  const [sector, setSector] = useState<string[]>([]);
  const [pais, setPais] = useState<string[]>([]);
  const [mercado, setMercado] = useState<string[]>([]);
  const [industria, setIndustria] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [capMin, setCapMin] = useState("");
  const [capMax, setCapMax] = useState("");
  const [peMin, setPeMin] = useState("");
  const [peMax, setPeMax] = useState("");
  const [cercaMax, setCercaMax] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  const [resultado, setResultado] = useState<ExplorerContar | null>(null);
  const [contando, setContando] = useState(false);
  const [errorContar, setErrorContar] = useState("");

  const [items, setItems] = useState<ExplorerTickerRow[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [cargandoTabla, setCargandoTabla] = useState(false);

  useEffect(() => {
    fetchExplorerOpciones()
      .then(setOpciones)
      .catch((e) => {
        setOpciones(null);
        setErrorOpciones(e instanceof Error ? e.message : "No se pudieron cargar los filtros.");
      });
  }, []);

  const filtros: ExplorerFiltros = {
    fecha_desde: fechaDesde || undefined,
    fecha_hasta: fechaHasta || undefined,
    alcance: alcance || undefined,
    sector, pais, mercado, industria,
    q: q.trim() || undefined,
    market_cap_min: capMin ? Number(capMin) * 1e9 : undefined,
    market_cap_max: capMax ? Number(capMax) * 1e9 : undefined,
    pe_trailing_min: peMin ? Number(peMin) : undefined,
    pe_trailing_max: peMax ? Number(peMax) : undefined,
    cerca_max_pct: cercaMax ? Number(cercaMax) : undefined,
  };
  // Clave estable para decidir cuándo re-consultar sin depender de la identidad del objeto.
  const filtrosKey = JSON.stringify(filtros);

  // Recuento + distribuciones: recalcula (con espera corta) cada vez que cambia el filtro.
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      setContando(true);
      setErrorContar("");
      fetchExplorerContar(filtros)
        .then((r) => { if (vivo) setResultado(r); })
        .catch((e) => { if (vivo) setErrorContar(e instanceof Error ? e.message : "No se pudo contar."); })
        .finally(() => { if (vivo) setContando(false); });
    }, DEBOUNCE_MS);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosKey]);

  // La tabla resetea a página 0 cuando el filtro cambia (evita quedarse en una página vacía).
  useEffect(() => { setPagina(0); }, [filtrosKey]);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      setCargandoTabla(true);
      fetchExplorerTickers(filtros, PAGE_SIZE, pagina * PAGE_SIZE)
        .then((r) => { if (vivo) { setItems(r.items); setTotalItems(r.total); } })
        .catch(() => { if (vivo) { setItems([]); setTotalItems(0); } })
        .finally(() => { if (vivo) setCargandoTabla(false); });
    }, DEBOUNCE_MS);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosKey, pagina]);

  function limpiar() {
    setAlcance(""); setSector([]); setPais([]); setMercado([]); setIndustria([]);
    setQ(""); setCapMin(""); setCapMax(""); setPeMin(""); setPeMax("");
    setCercaMax(""); setFechaDesde(""); setFechaHasta("");
  }

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const hayFiltros = sector.length || pais.length || mercado.length || industria.length
    || q || capMin || capMax || peMin || peMax || cercaMax || fechaDesde || fechaHasta || alcance;
  const totalPaginas = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  // Con rango de fechas cada ticker puede traer una foto de un día distinto (cada uno es su
  // "última DENTRO del rango") — sin la columna, dos filas con precios muy distintos parecerían
  // del mismo momento. Sin rango, todo es "la más reciente" y la columna solo sería ruido.
  const mostrarFecha = !!(fechaDesde || fechaHasta);
  const numCols = mostrarFecha ? 8 : 7;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11.5px]" style={{ color: T.muted }}>
          Filtra las fotos de fundamentales ya capturadas — sin objetivo de escaneo, solo para
          mirar el mercado. Nada se guarda.
        </p>
        {!!hayFiltros && (
          <button onClick={limpiar} className="shrink-0 text-[11px] underline" style={{ color: T.muted }}>
            limpiar
          </button>
        )}
      </div>

      {/* búsqueda + alcance: lo primero que se toca, arriba y compacto */}
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker o nombre…"
               className="min-w-0 flex-1 rounded border bg-transparent px-2.5 py-1.5 text-[12px]"
               style={{ borderColor: T.ring, color: T.ink }} />
        <div className="flex shrink-0 overflow-hidden rounded border" style={{ borderColor: T.ring }}>
          {([["", "Todos"], ["escaneo", "Escaneo"], ["global", "Global"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setAlcance(v)}
                    className="px-2.5 py-1.5 text-[11px] font-semibold transition-colors"
                    style={alcance === v ? { background: T.base, color: T.ink } : { color: T.muted }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {opciones && (
        <>
          <ChipGroup title="Sector" options={opciones.sectores} selected={sector}
                    onToggle={(v) => toggle(sector, setSector, v)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ChipGroup title="País" options={opciones.paises} selected={pais}
                      onToggle={(v) => toggle(pais, setPais, v)} />
            <ChipGroup title="Mercado" options={opciones.mercados} selected={mercado}
                      onToggle={(v) => toggle(mercado, setMercado, v)} />
          </div>
          <ChipGroup title="Industria" options={opciones.industrias} selected={industria}
                    onToggle={(v) => toggle(industria, setIndustria, v)} max={12} />
        </>
      )}
      {!opciones && errorOpciones && (
        <p className="text-[11px]" style={{ color: T.warn }}>
          {errorOpciones} (sector/país/mercado no disponibles — el resto del filtro sigue funcionando).
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RangoNumerico label="Market cap (B$)" min={capMin} max={capMax} onMin={setCapMin} onMax={setCapMax} />
        <RangoNumerico label="PER trailing" min={peMin} max={peMax} onMin={setPeMin} onMax={setPeMax} />
        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
            Cerca del máximo (%)
            <InfoTip text="Deja fuera lo que esté más de este % por debajo de su máximo de 52 semanas. Ej: 10 = dentro del 10% del máximo." />
          </span>
          <input type="number" inputMode="decimal" min={0} max={100} placeholder="ej. 10"
                 value={cercaMax} onChange={(e) => setCercaMax(e.target.value)}
                 className={`rounded border bg-transparent px-2 py-1 text-[11.5px] ${NUMS} ${NUM_INPUT}`}
                 style={{ borderColor: T.ring, color: T.ink }} />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t pt-2.5" style={{ borderColor: T.grid }}>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
            Foto entre
          </span>
          <span className="flex items-center gap-1.5">
            <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)}
                   className={`rounded border bg-transparent px-1.5 py-1 text-[11px] ${NUMS}`}
                   style={{ borderColor: T.ring, color: T.ink }} />
            <span style={{ color: T.muted }}>–</span>
            <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)}
                   className={`rounded border bg-transparent px-1.5 py-1 text-[11px] ${NUMS}`}
                   style={{ borderColor: T.ring, color: T.ink }} />
          </span>
        </label>
        <span className="flex items-center gap-1 text-[10.5px]" style={{ color: T.muted }}>
          <InfoTip text="Vacío = la última foto de cada ticker, sin importar cuándo. Con fechas: la última foto de cada ticker DENTRO de ese rango — así se puede mirar cómo estaba el mercado en un momento pasado." />
          sin fechas = última foto de cada ticker
        </span>
      </div>

      {/* recuento + distribuciones */}
      <div>
        {errorContar ? (
          <p className="text-[11.5px]" style={{ color: T.bad }}>{errorContar}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className={`text-[13px] font-bold ${NUMS}`} style={{ color: T.ink }}>
              {contando ? "contando…" : resultado ? `${fmtNum(resultado.total)} nombres` : "—"}
            </p>
            {resultado && resultado.total > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <DistCard label="Market cap" dist={resultado.distribuciones.market_cap_usd} fmt={fmtCapB} />
                <DistCard label="Precio" dist={resultado.distribuciones.price} fmt={fmtMoney} />
                <DistCard label="PER trailing" dist={resultado.distribuciones.pe_trailing} fmt={fmtRatio} />
                <DistCard label="PER forward" dist={resultado.distribuciones.pe_forward} fmt={fmtRatio} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* tabla de tickers */}
      {resultado && resultado.total > 0 && (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto rounded border" style={{ borderColor: T.grid }}>
            <table className={`w-full border-collapse whitespace-nowrap text-[11px] ${NUMS}`}>
              <thead>
                <tr style={{ color: T.muted, background: T.panel2 }}>
                  {(mostrarFecha
                    ? ["Ticker", "Nombre", "Sector", "País", "Cap", "Precio", "PER", "Foto"]
                    : ["Ticker", "Nombre", "Sector", "País", "Cap", "Precio", "PER"]
                  ).map((c) => (
                    <th key={c} className="px-2 py-1 text-left font-semibold">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cargandoTabla ? (
                  <tr><td colSpan={numCols} className="px-2 py-3 text-center" style={{ color: T.muted }}>Cargando…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={numCols} className="px-2 py-3 text-center" style={{ color: T.muted }}>Sin resultados.</td></tr>
                ) : items.map((r) => (
                  <tr key={r.ticker} className="border-t" style={{ borderColor: T.grid }}>
                    <td className="px-2 py-1 font-semibold" style={{ color: T.ink }}>{r.ticker}</td>
                    <td className="max-w-[160px] truncate px-2 py-1" style={{ color: T.ink2 }}>{r.name ?? "—"}</td>
                    <td className="px-2 py-1" style={{ color: T.ink2 }}>{r.sector ?? "—"}</td>
                    <td className="px-2 py-1" style={{ color: T.ink2 }}>{r.country ?? "—"}</td>
                    <td className="px-2 py-1" style={{ color: T.ink2 }}>
                      {r.market_cap_usd != null ? fmtCapB(r.market_cap_usd) : "—"}
                    </td>
                    <td className="px-2 py-1" style={{ color: T.ink2 }}>
                      {r.price != null ? fmtMoney(r.price) : "—"}
                    </td>
                    <td className="px-2 py-1" style={{ color: T.ink2 }}>
                      {r.pe_trailing != null ? fmtRatio(r.pe_trailing) : "—"}
                    </td>
                    {mostrarFecha && (
                      <td className="px-2 py-1" style={{ color: T.muted }}>
                        {new Date(r.captured_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-2 text-[11px]" style={{ color: T.muted }}>
              <button onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0}
                      className="rounded px-2 py-1 disabled:opacity-30" style={{ background: T.panel2 }}>
                ‹
              </button>
              <span>{pagina + 1} / {totalPaginas}</span>
              <button onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
                      disabled={pagina >= totalPaginas - 1}
                      className="rounded px-2 py-1 disabled:opacity-30" style={{ background: T.panel2 }}>
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
