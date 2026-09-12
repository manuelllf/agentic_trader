"use client";

// Kit presentacional pequeño de Alpha: piezas sin estado (o casi) que comparten la
// página y sus componentes extraídos. Nada de lógica de negocio aquí.

import { useState } from "react";
import { NUMS, T, isBuy } from "./tokens";
import type { TradeAction } from "@/lib/types";

export function Panel({ title, right, accent, children }: {
  title: string; right?: React.ReactNode; accent?: string; children: React.ReactNode;
}) {
  // h-full + flex-col: en una fila de la rejilla, los dos paneles miden lo mismo
  // (el vacío se centra en vez de dejar un hueco negro debajo).
  return (
    <section className="flex h-full flex-col border-t" style={{ borderColor: accent ?? T.grid }}>
      <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
        <h2 className="text-[16px] font-bold" style={{ color: accent ?? T.ink }}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

// Card-acordeón del mockup (`details.card`): a diferencia de `Panel` (siempre abierta), el
// contenido solo se pinta si se despliega — para módulos de consulta ocasional (Universo,
// Cartera IBKR, Ajustes...), no para lo que exige decisión ahora mismo (eso sigue en `Panel`).
export function Details({ title, meta, right, accent, defaultOpen, children }: {
  title: string; meta?: string; right?: React.ReactNode; accent?: string; defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const toggle = () => setOpen((o) => !o);
  // `right` a veces trae sus propios botones (p. ej. ScanFullButton) — un <button> dentro de
  // otro <button> es HTML inválido y rompe la hidratación, así que el toggle vive en DOS
  // botones hermanos (título y chevron), con `right` libre entre medias, en vez de uno solo
  // envolviendo toda la fila.
  return (
    <section className="border-t" style={{ borderColor: accent ?? T.grid }}>
      <div className="flex w-full items-center gap-2.5 py-3.5 pl-4 pr-2.5">
        <button onClick={toggle} aria-expanded={open}
                className="flex-1 text-left text-[16px] font-bold transition-colors" style={{ color: accent ?? T.ink }}>
          {title}{" "}
          {meta && <span className="text-[13px] font-normal" style={{ color: T.muted }}>{meta}</span>}
        </button>
        {right}
        <button onClick={toggle} aria-expanded={open} aria-label={open ? "Colapsar" : "Desplegar"}
                className="flex shrink-0 items-center rounded p-1.5 transition-colors hover:bg-white/5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2"
               className="shrink-0 transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }}>
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>
      {open && <div className="border-t" style={{ borderColor: T.grid }}>{children}</div>}
    </section>
  );
}

// El checkbox nativo (recuadro blanco del SO) desentona sobre el fondo casi negro de la sala.
export function Checkbox({ checked, onChange, className }: {
  checked: boolean; onChange: (v: boolean) => void; className?: string;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={checked}
            onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${className ?? ""}`}
            style={{ borderColor: checked ? T.buy : T.ring, background: checked ? T.buy : "transparent" }}>
      {checked && (
        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="#fff" strokeWidth="2.4"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      )}
    </button>
  );
}

export function Kpi({ label, value, sub, tone, big }: {
  label: string; value: string; sub?: string; tone?: "good" | "bad"; big?: boolean;
}) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>{label}</p>
      <p className={`mt-1.5 font-bold leading-none tracking-tight ${NUMS} ${big ? "text-[27px]" : "text-[22px]"}`}
         style={{ color: tone === "good" ? T.good : tone === "bad" ? T.bad : T.ink }}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[10.5px]" style={{ color: T.muted }}>{sub}</p>}
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

export function DetailLine({ k, v, color, dim }: { k: string; v: React.ReactNode; color?: string; dim?: boolean }) {
  return (
    <div style={{ color: dim ? T.muted : T.ink2 }}>
      <span className="mr-1.5 font-bold" style={{ color: color ?? T.ink }}>{k}:</span>
      {v}
    </div>
  );
}
