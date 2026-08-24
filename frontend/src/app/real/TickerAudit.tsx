"use client";

// Historia de UN ticker a través de los escaneos: ¿es estable el criterio del método con él,
// o el score le salta de escaneo en escaneo? Autocontenido a propósito (no se engancha a
// page.tsx desde aquí — lo hace otro paso posterior para no pisar una edición en paralelo).
// Mismo patrón de emergente que ScanFullModal.tsx (velo + tarjeta + cerrar por X/Escape/click fuera).

import { useEffect, useRef, useState } from "react";
import { fetchScanAudit, getScanOutcomes, type ScanAuditEntry } from "@/lib/api";
import { fmtScore, fmtTime, money } from "@/lib/format";
import { NUMS, T } from "./tokens";

export function TickerAudit({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [scans, setScans] = useState<ScanAuditEntry[] | null>(null);
  const [outcome, setOutcome] = useState<{ score: number; ret: number; funded: boolean } | null>(null);
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
    let cancelled = false;
    setBusy(true);
    setErr("");
    fetchScanAudit(ticker)
      .then((r) => { if (!cancelled) setScans(r.scans); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "No se pudo recuperar el historial."); })
      .finally(() => { if (!cancelled) setBusy(false); });

    // Best-effort: si el ticker aparece entre los `pairs` de los escaneos recientes de
    // /scan/outcomes, se muestra qué habría pasado si se hubiera comprado. Si no aparece
    // (o la llamada falla) simplemente no se pinta esa sección — no es el dato principal.
    getScanOutcomes()
      .then((r) => {
        if (cancelled) return;
        for (const s of r.scans) {
          const hit = s.pairs.find((p) => p.ticker?.toUpperCase() === ticker.toUpperCase());
          if (hit) { setOutcome({ score: hit.score, ret: hit.ret, funded: hit.funded }); return; }
        }
      })
      .catch(() => { /* opcional: sin outcome no pasa nada */ });

    return () => { cancelled = true; };
  }, [ticker]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Historial de ${ticker}`}
           className="w-full max-w-xl rounded-lg border shadow-xl"
           style={{ borderColor: T.ring, background: T.panel }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: T.grid }}>
          <div className="flex items-center gap-2">
            <b style={{ color: T.ink }}>{ticker.toUpperCase()}</b>
            <span className="text-[11px]" style={{ color: T.muted }}>a través de los escaneos</span>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Cerrar" className="hover:opacity-70" style={{ color: T.muted }}>✕</button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-4 py-3 text-[12px]">
          {busy && <p style={{ color: T.muted }}>Cargando…</p>}
          {err && <p style={{ color: T.warn }}>{err}</p>}

          {!busy && !err && scans && scans.length === 0 && (
            <p style={{ color: T.muted }}>Sin historial: {ticker.toUpperCase()} no aparece en ningún escaneo guardado.</p>
          )}

          {!busy && !err && scans && scans.length > 0 && (
            <>
              {outcome && (
                <div className="mb-3 rounded border px-2.5 py-1.5" style={{ borderColor: T.grid }}>
                  <SectionTitle>Si se hubiera comprado</SectionTitle>
                  <p className={`mt-1 ${NUMS}`} style={{ color: T.ink2 }}>
                    score <b style={{ color: T.ink }}>{fmtScore(outcome.score)}</b>
                    {" · "}retorno{" "}
                    <b style={{ color: outcome.ret >= 0 ? T.good : T.bad }}>
                      {outcome.ret >= 0 ? "+" : ""}{outcome.ret.toFixed(1)}%
                    </b>
                    {outcome.funded && <span className="ml-1.5" style={{ color: T.buy }}>(en cartera)</span>}
                  </p>
                </div>
              )}

              <SectionTitle>Notas por escaneo ({scans.length})</SectionTitle>
              <table className={`mt-1.5 w-full text-[11px] ${NUMS}`}>
                <thead>
                  <tr style={{ color: T.muted }}>
                    <th className="pb-1 text-left font-semibold">fecha</th>
                    <th className="pb-1 text-left font-semibold">etapa</th>
                    <th className="pb-1 text-right font-semibold">prescore</th>
                    <th className="pb-1 text-right font-semibold">deep</th>
                    <th className="pb-1 text-right font-semibold">precio</th>
                    <th className="pb-1 text-right font-semibold">peso</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s, i) => (
                    <tr key={`${s.at}-${i}`} className="border-t align-top" style={{ borderColor: T.grid }}>
                      <td className="py-1" style={{ color: T.ink2 }}>{fmtTime(s.at)}</td>
                      <td className="py-1" style={{ color: T.ink2 }}>{s.stage}</td>
                      <td className="py-1 text-right" style={{ color: T.ink }}>{fmtScore(s.prescore)}</td>
                      <td className="py-1 text-right" style={{ color: T.ink }}>{fmtScore(s.deep_score)}</td>
                      <td className="py-1 text-right" style={{ color: T.ink2 }}>{s.price != null ? `$${money(s.price)}` : "—"}</td>
                      <td className="py-1 text-right" style={{ color: T.ink2 }}>{s.weight_pct != null ? `${s.weight_pct}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
