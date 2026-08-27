"use client";

// Aportar / retirar capital del agente. Se apunta EN SU DIVISA, sin convertir — así funciona
// IBKR de verdad: el saldo se queda en euros o dólares tal cual entra, y es IBKR quien convierte
// solo en el momento de comprar si la caja $ no alcanza (dólares primero, euros solo para
// completar). Retiradas: solo en $ (el consolidado vive en dólares).

import { useState } from "react";
import { allocateReal } from "@/lib/api";
import { money } from "@/lib/format";
import type { RealSummary } from "@/lib/types";
import { NUMS, T } from "./tokens";

export function CapitalForm({ onDone, onError }: {
  onDone: (s: RealSummary, msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [cur, setCur] = useState<"EUR" | "USD">("EUR");
  const [busy, setBusy] = useState(false);
  const v = parseFloat(amount);
  const valid = Number.isFinite(v) && v !== 0;

  const submit = async () => {
    if (!valid || busy) return;
    if (cur === "EUR" && v < 0) return onError("En € solo aportaciones — para retirar usa $.");
    setBusy(true);
    try {
      const res = await allocateReal(v, cur === "USD" ? "aportación sala real" : "", cur);
      const symbol = cur === "EUR" ? "€" : "$";
      onDone(res, `Caja ${cur} actualizada: ${v > 0 ? "+" : ""}${symbol}${money(v)}.`);
      setAmount("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error asignando capital.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <input value={amount}
               onChange={(e) => setAmount(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && submit()}
               placeholder="0.00" inputMode="decimal" aria-label="Importe"
               className={`w-full rounded border bg-transparent px-3 py-1.5 text-[13px] outline-none ${NUMS}`}
               style={{ borderColor: T.grid, color: T.ink }}
               onFocus={(e) => (e.currentTarget.style.borderColor = T.buy)}
               onBlur={(e) => (e.currentTarget.style.borderColor = T.grid)} />
        <div className="flex shrink-0 overflow-hidden rounded border" style={{ borderColor: T.grid }}>
          {(["EUR", "USD"] as const).map((c) => (
            <button key={c} onClick={() => setCur(c)}
                    className="px-2.5 text-[12px] font-bold transition-colors"
                    style={cur === c ? { background: T.base, color: T.ink } : { color: T.muted }}>
              {c === "EUR" ? "€" : "$"}
            </button>
          ))}
        </div>
        <button onClick={submit} disabled={busy || !valid}
                className="shrink-0 rounded px-4 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: T.buy }}>
          {busy ? "…" : "Aportar"}
        </button>
      </div>
      <p className={`mt-1.5 text-[10.5px] leading-snug ${NUMS}`} style={{ color: T.muted }}>
        {cur === "EUR"
          ? "se queda en € — IBKR convierte solo en el momento de comprar, si la caja $ no llega"
          : "negativo = retirar · ninguna orden puede gastar más de lo asignado"}
      </p>
    </div>
  );
}
