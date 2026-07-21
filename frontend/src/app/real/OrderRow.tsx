"use client";

// Fila de propuesta pendiente: el Sí exige armar → confirmar (5 s para arrepentirse); el No
// descarta al momento. La fila entera expande el detalle (tesis/ventaja/riesgo/macro) con
// ratón o teclado. El agente jamás ejecuta solo: este componente ES el contrato.

import { useEffect, useState } from "react";
import { fmtTime, money } from "@/lib/format";
import type { Approval } from "@/lib/types";
import { NUMS, T } from "./tokens";
import { DetailLine, SideTag, Td } from "./ui";

export function OrderRow({ a, dry, onDecide, expiryDays }: {
  a: Approval; dry: boolean; onDecide: (id: number, yes: boolean) => Promise<void>;
  expiryDays: number;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // el Sí exige doble clic: armar → confirmar (5 s para arrepentirse)
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const yes = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!armed) return setArmed(true);
    setBusy(true);
    await onDecide(a.id, true);
    setBusy(false);
  };
  const no = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    await onDecide(a.id, false);
    setBusy(false);
  };

  return (
    <>
      <tr onClick={() => setOpen(!open)}
          role="button" tabIndex={0} aria-expanded={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); }
          }}
          className="cursor-pointer border-t transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05] focus-visible:outline-none"
          style={{ borderColor: T.grid }}>
        <Td><SideTag action={a.action} /></Td>
        <Td>
          <b className="text-[14px]" style={{ color: T.ink }}>{a.ticker}</b>
          <span className="ml-2 text-[11px]" style={{ color: T.muted }}>
            {a.action}{a.sector ? ` · ${a.sector}` : ""}
          </span>
        </Td>
        <Td right><span className={NUMS}>{a.target_weight_pct}%</span></Td>
        <Td right><span className={NUMS}>{a.est_price ? `$${money(a.est_price)}` : "—"}</span></Td>
        <Td right><span className={NUMS}>{a.target_price ? `$${money(a.target_price)}` : "—"}</span></Td>
        <Td right>
          <span className={`font-semibold ${NUMS}`}
                style={{ color: a.upside_pct == null ? T.muted : a.upside_pct >= 0 ? T.good : T.bad }}>
            {a.upside_pct != null ? `${a.upside_pct > 0 ? "+" : ""}${a.upside_pct}%` : "—"}
          </span>
        </Td>
        <Td right>
          <span className={`inline-block min-w-[30px] rounded px-1.5 py-0.5 text-center text-[11.5px] font-bold ${NUMS}`}
                style={{ background: T.base, color: T.ink }}>
            {a.score ?? "—"}
          </span>
        </Td>
        <Td right>
          <span className="inline-flex gap-1.5">
            <button onClick={no} disabled={busy}
                    className="rounded border px-3 py-1.5 text-[11.5px] font-bold transition-colors hover:bg-white/5 disabled:opacity-40"
                    style={{ borderColor: "rgba(208,59,59,0.5)", color: T.bad }}>
              No
            </button>
            <button onClick={yes} disabled={busy}
                    className="rounded px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity disabled:opacity-40"
                    style={{ background: armed ? "#66a5f2" : T.buy, minWidth: armed ? undefined : 38 }}>
              {busy ? "…" : armed ? `Confirmar${dry ? " (sim)" : ""}` : "Sí"}
            </button>
          </span>
        </Td>
      </tr>
      {open && (
        <tr style={{ background: "rgba(255,255,255,0.02)" }}>
          <Td colSpan={8}>
            <div className="max-w-[900px] space-y-1.5 whitespace-normal py-1 text-[12.5px] leading-relaxed">
              {a.thesis && <DetailLine k="Tesis" v={a.thesis} />}
              {a.edge && <DetailLine k="Ventaja" v={a.edge} />}
              {a.risk && <DetailLine k="Riesgo" v={a.risk} color={T.warn} />}
              {a.macro_summary && <DetailLine k="Macro" v={a.macro_summary} dim />}
              <p className="text-[11px]" style={{ color: T.muted }}>
                Propuesta {fmtTime(a.created_at)} · caduca{" "}
                {a.created_at
                  ? fmtTime(new Date(new Date(a.created_at).getTime() + expiryDays * 86_400_000).toISOString())
                  : `a los ${expiryDays} días`}
              </p>
            </div>
          </Td>
        </tr>
      )}
    </>
  );
}
