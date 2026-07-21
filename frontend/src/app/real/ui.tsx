"use client";

// Kit presentacional pequeño de la Sala Real: piezas sin estado (o casi) que comparten la
// página y sus componentes extraídos. Nada de lógica de negocio aquí.

import { NUMS, T, isBuy } from "./tokens";
import type { TradeAction } from "@/lib/types";

export function Panel({ title, right, accent, children }: {
  title: string; right?: React.ReactNode; accent?: string; children: React.ReactNode;
}) {
  // h-full + flex-col: en una fila de la rejilla, los dos paneles miden lo mismo
  // (el vacío se centra en vez de dejar un hueco negro debajo).
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border"
             style={{ borderColor: accent ? `${accent}55` : T.ring, background: T.panel }}>
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2"
           style={{ borderColor: T.grid, background: T.panel2 }}>
        <h2 className="text-[12px] font-bold tracking-wide" style={{ color: accent ?? T.ink2 }}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone, big }: {
  label: string; value: string; sub?: string; tone?: "good" | "bad"; big?: boolean;
}) {
  return (
    <div className="px-4 py-3" style={{ background: T.panel }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>{label}</p>
      <p className={`mt-1 font-bold leading-none ${NUMS} ${big ? "text-[25px]" : "text-[20px]"}`}
         style={{ color: tone === "good" ? T.good : tone === "bad" ? T.bad : T.ink }}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[10.5px]" style={{ color: T.muted }}>{sub}</p>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="my-auto px-4 py-6 text-center text-[12.5px] leading-relaxed" style={{ color: T.muted }}>
      {children}
    </p>
  );
}

export function Field({ k, v }: { k: string; v: string }) {
  return (
    <span className="text-[12px]">
      <span style={{ color: T.muted }}>{k} </span>
      <span className={`font-semibold ${NUMS}`} style={{ color: T.ink2 }}>{v}</span>
    </span>
  );
}

export function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-1.5 font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

export function Td({ children, right, colSpan }: { children: React.ReactNode; right?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={`px-3 py-2 ${right ? "text-right" : ""}`}>{children}</td>;
}

export function SideTag({ action }: { action: TradeAction }) {
  const buy = isBuy(action);
  return (
    <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded px-1 text-[10.5px] font-bold text-white"
          style={{ background: buy ? T.buy : T.bad }}
          title={buy ? `compra (${action})` : `venta (${action})`}>
      {buy ? "C" : "V"}
    </span>
  );
}

export function DetailLine({ k, v, color, dim }: { k: string; v: string; color?: string; dim?: boolean }) {
  return (
    <p style={{ color: dim ? T.muted : T.ink2 }}>
      <span className="mr-1.5 font-bold" style={{ color: color ?? T.ink }}>{k}:</span>
      {v}
    </p>
  );
}
