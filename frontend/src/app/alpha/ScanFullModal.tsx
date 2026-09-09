"use client";

// Detalle COMPLETO de un escaneo (mensual decidido o semanal observatorio): tesis macro,
// finalistas con su score/target y la cartera formada. Sin esto la única fuente era /scan/report
// (contadores) — una simulación se leía una vez y se perdía en cuanto terminaba el proceso.
// Mismo patrón de emergente que MemorySearch.tsx (velo + tarjeta + cerrar por X/Escape/click fuera).

import { useEffect, useRef, useState } from "react";
import { getScanFull, type ScanFull, type ScanFullFinalist } from "@/lib/api";
import { fmtScore, fmtTime, money } from "@/lib/format";
import { richText } from "@/lib/richText";
import { NUMS, T } from "./tokens";

export function ScanFullButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
              className="text-[11px] font-semibold underline decoration-dotted underline-offset-2 hover:opacity-80"
              style={{ color: T.buy }}>
        Ver detalle completo
      </button>
      {open && <ScanFullModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ScanFullModal({ onClose }: { onClose: () => void }) {
  const [scan, setScan] = useState<ScanFull | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    getScanFull()
      .then((r) => setScan(r.scan))
      .catch((e) => setErr(e instanceof Error ? e.message : "No se pudo recuperar el escaneo."))
      .finally(() => setBusy(false));
  }, []);

  // Retorno objetivo ponderado: suma de peso × upside de cada posición fondeada con target
  // conocido — el mismo cálculo que hace el peso en la cartera, no una media simple.
  const posiciones = (scan?.construction.items ?? []).filter((i) => i.action !== "vender");
  const retornoPonderado = posiciones.some((p) => p.upside_pct != null)
    ? posiciones.reduce((acc, p) => acc + (p.upside_pct ?? 0) * ((p.target_weight_pct ?? 0) / 100), 0)
    : null;

  // Distancia al máximo de 52 semanas, calculada aquí (nunca por el LLM): % por debajo del high.
  const distAth = posiciones
    .map((p) => {
      const precio = p.price ? parseFloat(p.price) : null;
      if (!precio || !p.high_52w) return null;
      return { d: ((p.high_52w - precio) / p.high_52w) * 100, w: p.target_weight_pct ?? 0 };
    })
    .filter((x): x is { d: number; w: number } => x !== null);
  const pesoTotal = distAth.reduce((acc, x) => acc + x.w, 0);
  const athMedia = distAth.length && pesoTotal
    ? distAth.reduce((acc, x) => acc + x.d * x.w, 0) / pesoTotal
    : null;
  const athOrdenada = distAth.map((x) => x.d).sort((a, b) => a - b);
  const athMediana = athOrdenada.length
    ? athOrdenada.length % 2
      ? athOrdenada[(athOrdenada.length - 1) / 2]
      : (athOrdenada[athOrdenada.length / 2 - 1] + athOrdenada[athOrdenada.length / 2]) / 2
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Detalle completo del escaneo"
           className="w-full max-w-2xl rounded-lg border shadow-xl"
           style={{ borderColor: T.ring, background: T.panel }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: T.grid }}>
          <div className="flex items-center gap-2">
            <b style={{ color: T.ink }}>Escaneo completo</b>
            {scan && <span className="text-[11px]" style={{ color: T.muted }}>{fmtTime(scan.at)} · {scan.cadence}</span>}
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Cerrar" className="hover:opacity-70" style={{ color: T.muted }}>✕</button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-4 py-3 text-[12px]">
          {busy && <p style={{ color: T.muted }}>Cargando…</p>}
          {err && <p style={{ color: T.warn }}>{err}</p>}
          {!busy && !err && !scan && (
            <p style={{ color: T.muted }}>No hay ningún escaneo guardado todavía.</p>
          )}
          {scan && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1" style={{ color: T.ink2 }}>
                <span>régimen <b style={{ color: T.ink }}>{scan.regime || "—"}</b></span>
                {scan.vix != null && <span className={NUMS}>VIX <b style={{ color: T.ink }}>{scan.vix}</b></span>}
                {scan.cost && (
                  <span className={NUMS} style={{ color: T.muted }}>
                    {scan.cost.calls} llamadas ·{" "}
                    {/* Solo el estimado por tokens: medido contra el saldo ya liquidado, acierta
                        al 3%. El saldo leído al terminar el escaneo no, DeepSeek liquida tarde. */}
                    ${money(scan.cost.cost_usd)} <span title="Estimado por tokens de cada respuesta">est.</span>
                  </span>
                )}
              </div>

              {scan.outlook && (
                <div className="mt-3">
                  <SectionTitle>Tesis macro</SectionTitle>
                  <div className="mt-1 leading-relaxed" style={{ color: T.ink2 }}>{richText(scan.outlook)}</div>
                </div>
              )}

              {scan.construction.summary && (
                <div className="mt-3">
                  <SectionTitle>Tesis del constructor</SectionTitle>
                  <div className="mt-1 leading-relaxed" style={{ color: T.ink2 }}>{richText(scan.construction.summary)}</div>
                </div>
              )}

              <div className="mt-3">
                <SectionTitle>
                  Cartera formada
                  {retornoPonderado != null && (
                    <span className="ml-2 font-normal normal-case" style={{ color: T.muted }}>
                      · objetivo ponderado a 1 mes{" "}
                      <b className={NUMS} style={{ color: retornoPonderado >= 0 ? T.good : T.bad }}>
                        {retornoPonderado >= 0 ? "+" : ""}{retornoPonderado.toFixed(1)}%
                      </b>
                    </span>
                  )}
                  {athMedia != null && (
                    <span className="ml-2 font-normal normal-case" style={{ color: T.muted }}>
                      · dist. a máximo <b className={NUMS} style={{ color: T.ink }}>{athMedia.toFixed(1)}%</b>
                      {" "}(mediana <b className={NUMS} style={{ color: T.ink }}>{athMediana?.toFixed(1)}%</b>)
                    </span>
                  )}
                </SectionTitle>
                <table className={`mt-1.5 w-full text-[11px] ${NUMS}`}>
                  <thead>
                    <tr style={{ color: T.muted }}>
                      <th className="pb-1 text-left font-semibold">ticker</th>
                      <th className="pb-1 text-left font-semibold">acción</th>
                      <th className="pb-1 text-right font-semibold">peso</th>
                      <th className="pb-1 text-right font-semibold">dist. ATH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scan.construction.items ?? []).map((p) => {
                      const precio = p.price ? parseFloat(p.price) : null;
                      const dist = precio && p.high_52w ? ((p.high_52w - precio) / p.high_52w) * 100 : null;
                      return (
                      <tr key={p.ticker} className="border-t align-top" style={{ borderColor: T.grid }}>
                        <td className="py-1"><b style={{ color: T.ink }}>{p.ticker}</b></td>
                        <td className="py-1" style={{ color: T.ink2 }}>{p.action}</td>
                        <td className="py-1 text-right" style={{ color: T.ink }}>
                          {p.target_weight_pct != null ? `${p.target_weight_pct}%` : "—"}
                        </td>
                        <td className="py-1 text-right" style={{ color: T.ink2 }}>
                          {dist != null ? `${dist.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {posiciones.map((p) => (p.thesis || p.edge || p.risk) && (
                  <div key={`${p.ticker}-tesis`} className="mt-1.5 rounded border px-2.5 py-1.5" style={{ borderColor: T.grid }}>
                    <b style={{ color: T.ink }}>{p.ticker}</b>
                    {p.thesis && <p className="mt-0.5" style={{ color: T.ink2 }}>{richText(p.thesis)}</p>}
                    {p.edge && <p className="mt-0.5" style={{ color: T.muted }}><i>edge:</i> {richText(p.edge)}</p>}
                    {p.risk && <p className="mt-0.5" style={{ color: T.muted }}><i>riesgo:</i> {richText(p.risk)}</p>}
                  </div>
                ))}
                <p className="mt-1 text-[10.5px]" style={{ color: T.muted }}>
                  Caja objetivo: {scan.construction.cash_pct}%
                </p>
              </div>

              {scan.construction.omitted.length > 0 && (
                <div className="mt-3">
                  <SectionTitle>Descartados por el constructor</SectionTitle>
                  <ul className="mt-1 space-y-0.5">
                    {scan.construction.omitted.map((o) => (
                      <li key={o.ticker} style={{ color: T.ink2 }}>
                        <b style={{ color: T.ink }}>{o.ticker}</b> — {o.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3">
                <SectionTitle>Finalistas ({scan.finalists.length})</SectionTitle>
                <table className={`mt-1.5 w-full text-[11px] ${NUMS}`}>
                  <thead>
                    <tr style={{ color: T.muted }}>
                      <th className="pb-1 text-left font-semibold">ticker</th>
                      <th className="pb-1 text-left font-semibold">sector</th>
                      <th className="pb-1 text-right font-semibold">pre</th>
                      <th className="pb-1 text-right font-semibold">mid</th>
                      <th className="pb-1 text-right font-semibold">deep</th>
                      <th className="pb-1 text-right font-semibold">precio</th>
                      <th className="pb-1 text-right font-semibold">dist. ATH</th>
                      <th className="pb-1 text-left font-semibold pl-2">estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...scan.finalists]
                      // Empate en deep_score (frecuente: el modelo colapsa en un puñado de notas,
                      // ver auditoría 1-sep) desempatado por market cap desc — mismo criterio que
                      // el backend en select_finalists/select_top, para que el orden no dependa
                      // de en qué posición llegó el finalista desde la API.
                      .sort((a, b) => (b.deep_score ?? -1) - (a.deep_score ?? -1)
                                    || (b.market_cap ?? 0) - (a.market_cap ?? 0))
                      .map((f) => <FinalistRow key={f.ticker} f={f} />)}
                  </tbody>
                </table>
              </div>

              {scan.issues.length > 0 && (
                <div className="mt-3">
                  <SectionTitle>Incidencias</SectionTitle>
                  <ul className="mt-1 space-y-0.5">
                    {scan.issues.map((it) => (
                      <li key={it} style={{ color: T.ink2 }}>
                        <span className="mr-1.5" style={{ color: T.warn }} aria-hidden>▲</span>{it}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
      {children}
    </p>
  );
}

function FinalistRow({ f }: { f: ScanFullFinalist }) {
  const estado = f.funded ? "en cartera" : f.selected ? "seleccionado" : f.error ? "informe ilegible" : "";
  const color = f.funded ? T.good : f.selected ? T.buy : f.error ? T.bad : T.muted;
  // Distancia al máximo de 52 semanas, calculada aquí (nunca por el LLM), igual que en la cartera.
  const dist = f.price != null && f.high_52w ? ((f.high_52w - f.price) / f.high_52w) * 100 : null;
  return (
    <tr className="border-t align-top" style={{ borderColor: T.grid }} title={f.headline || undefined}>
      <td className="py-1"><b style={{ color: T.ink }}>{f.ticker}</b></td>
      <td className="py-1" style={{ color: T.ink2 }}>{f.sector || "—"}</td>
      <td className="py-1 text-right" style={{ color: T.ink2 }}>{fmtScore(f.prescore)}</td>
      <td className="py-1 text-right" style={{ color: T.ink2 }}>{fmtScore(f.mid_score)}</td>
      <td className="py-1 text-right" style={{ color: T.ink }}>{fmtScore(f.deep_score)}</td>
      <td className="py-1 text-right" style={{ color: T.ink2 }}>{f.price != null ? `$${money(f.price)}` : "—"}</td>
      <td className="py-1 text-right" style={{ color: T.ink2 }}>{dist != null ? `${dist.toFixed(1)}%` : "—"}</td>
      <td className="py-1 pl-2 text-left font-semibold" style={{ color }}>{estado}</td>
    </tr>
  );
}
