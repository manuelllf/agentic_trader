"use client";

// Aportar / retirar capital del agente. El libro habla DÓLARES (tope de gasto exacto).
// Modo €: el broker CONVIERTE al aportar (límite ±buffer; simulado en dry-run) y se apunta la
// imagen final que devuelva — nunca una estimación. Modo $: apunte directo (dólares que ya
// existen en la cuenta, p. ej. residuales de ventas propias). Retiradas: solo en $.

import { useEffect, useState } from "react";
import { allocateReal } from "@/lib/api";
import { money } from "@/lib/format";
import type { RealSummary } from "@/lib/types";
import { NUMS, T } from "./tokens";

export function CapitalForm({ fx, onDone, onError }: {
  fx: number | null;
  onDone: (s: RealSummary, msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [cur, setCur] = useState<"EUR" | "USD">("EUR");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);       // modo €: armar → confirmar (conversión real)
  const v = parseFloat(amount);
  const valid = Number.isFinite(v) && v !== 0;
  const est = cur === "EUR" && valid && v > 0 && fx ? v * fx : null;   // SOLO informativo

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 6000);   // 6 s para arrepentirse
    return () => clearTimeout(t);
  }, [armed]);

  const submit = async () => {
    if (!valid || busy) return;
    if (cur === "EUR") {
      if (v <= 0) return onError("En € solo aportaciones positivas — para retirar usa $.");
      if (!armed) return setArmed(true);           // 1er click: pedir confirmación
    }
    setBusy(true);
    try {
      const res = cur === "EUR"
        ? await allocateReal(v, "", "EUR")
        : await allocateReal(v, "aportación sala real", "USD");
      const msg = res.allocated
        ? `Convertidos ${money(v)} € → $${money(res.allocated.usd)} @ ${res.allocated.rate}`
          + (res.allocated.simulated ? " (simulado)." : ".")
        : `Capital del agente actualizado: ${v > 0 ? "+" : ""}$${money(v)}.`;
      onDone(res, msg);
      setAmount("");
      setArmed(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Error asignando capital.");
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <input value={amount}
               onChange={(e) => { setAmount(e.target.value); setArmed(false); }}
               onKeyDown={(e) => e.key === "Enter" && submit()}
               placeholder="0.00" inputMode="decimal" aria-label="Importe"
               className={`w-full rounded border bg-transparent px-3 py-1.5 text-[13px] outline-none ${NUMS}`}
               style={{ borderColor: T.grid, color: T.ink }}
               onFocus={(e) => (e.currentTarget.style.borderColor = T.buy)}
               onBlur={(e) => (e.currentTarget.style.borderColor = T.grid)} />
        <div className="flex shrink-0 overflow-hidden rounded border" style={{ borderColor: T.grid }}>
          {(["EUR", "USD"] as const).map((c) => (
            <button key={c} onClick={() => { setCur(c); setArmed(false); }}
                    className="px-2.5 text-[12px] font-bold transition-colors"
                    style={cur === c ? { background: T.base, color: T.ink } : { color: T.muted }}>
              {c === "EUR" ? "€" : "$"}
            </button>
          ))}
        </div>
        <button onClick={submit} disabled={busy || !valid}
                className="shrink-0 rounded px-4 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: armed ? "#66a5f2" : T.buy }}>
          {busy ? "…" : cur === "EUR" ? (armed ? "Confirmar" : "Convertir y aportar") : "Aportar"}
        </button>
      </div>
      <p className={`mt-1.5 text-[10.5px] leading-snug ${NUMS}`} style={{ color: T.muted }}>
        {armed && est != null
          ? `se venderán ${money(v)} € ≈ $${money(est)} (límite al cambio actual) — se apuntará la
             imagen final que devuelva el broker, comisión incluida`
          : cur === "EUR" && valid && v > 0
            ? `se convertirá en el broker al aportar${est != null ? ` · ahora ≈ $${money(est)} (EURUSD ${fx?.toFixed(4)})` : ""}
               — el libro apunta los $ exactos del fill, no esta estimación`
            : cur === "EUR"
              ? "aportaciones en € (positivas) · para retirar usa $"
              : "negativo = retirar · ninguna orden puede gastar más de lo asignado"}
      </p>
    </div>
  );
}
