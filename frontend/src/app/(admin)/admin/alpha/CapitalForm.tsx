"use client";

// Aportar / retirar capital del agente. Se apunta EN SU DIVISA, sin convertir — IBKR convierte
// sola solo al comprar, si la caja $ no alcanza. Retiradas: solo en $.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { allocateReal } from "@/lib/api";
import type { RealSummary } from "@/lib/types";
import { NUMS, T } from "./tokens";

export function CapitalForm({ onDone, onError }: {
  onDone: (s: RealSummary, currency: "EUR" | "USD", amount: number) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations();
  const [amount, setAmount] = useState("");
  const [cur, setCur] = useState<"EUR" | "USD">("EUR");
  const [busy, setBusy] = useState(false);
  const v = parseFloat(amount);
  const valid = Number.isFinite(v) && v !== 0;

  const submit = async () => {
    if (!valid || busy) return;
    if (cur === "EUR" && v < 0) return onError(t("alpha_eur_deposit_only"));
    setBusy(true);
    try {
      const res = await allocateReal(v, cur === "USD" ? "aportación Alpha" : "", cur);
      onDone(res, cur, v);
      setAmount("");
    } catch (e) {
      onError(e instanceof Error ? e.message : t("alpha_allocate_error"));
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
               placeholder="0.00" inputMode="decimal" aria-label={t("alpha_amount")}
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
          {busy ? "…" : t("alpha_deposit")}
        </button>
      </div>
      <p className={`mt-1.5 text-[10.5px] leading-snug ${NUMS}`} style={{ color: T.muted }}>
        {cur === "EUR"
          ? t("alpha_eur_cash_help")
          : t("alpha_usd_cash_help")}
      </p>
    </div>
  );
}
