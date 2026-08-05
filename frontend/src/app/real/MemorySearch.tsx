"use client";

// Buscador sobre la memoria semántica, dentro de Mantenimiento. La tabla de scores se borra y
// reescribe en cada decisión mensual — esto es el ÚNICO archivo de lo que el sistema pensó en
// escaneos pasados. Un ticker exacto trae su historia; texto libre trae tesis parecidas.

import { useState } from "react";
import { searchMemory, type MemoryItem } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { NUMS, T } from "./tokens";

const TITLES: Record<string, string> = {
  ticker: "Historia guardada de",
  semantic: "Tesis parecidas a",
  vacio: "",
};

export function MemorySearch() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"ticker" | "semantic" | "vacio" | null>(null);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [err, setErr] = useState("");

  const submit = async () => {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await searchMemory(query);
      setMode(r.mode);
      setItems(r.items);
    } catch (e) {
      setMode(null);
      setItems([]);
      setErr(e instanceof Error ? e.message : "No se pudo buscar en la memoria.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: T.grid }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
          Memoria
        </span>
        <span style={{ color: T.ink2 }}>
          Busca un ticker (su historia) o describe algo con texto libre (tesis parecidas).
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <input value={q}
               onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && submit()}
               placeholder="p. ej. NVDA o «empresas con una opa en curso»"
               className="w-full max-w-[420px] rounded border bg-transparent px-3 py-1.5 text-[12px] outline-none"
               style={{ borderColor: T.grid, color: T.ink }}
               onFocus={(e) => (e.currentTarget.style.borderColor = T.buy)}
               onBlur={(e) => (e.currentTarget.style.borderColor = T.grid)} />
        <button onClick={submit} disabled={busy || !q.trim()}
                className="shrink-0 rounded border px-3 py-1.5 text-[11px] font-bold transition-colors hover:bg-white/5 disabled:opacity-40"
                style={{ borderColor: T.ring, color: T.ink2 }}>
          {busy ? "Buscando…" : "Buscar"}
        </button>
      </div>
      {err && <p className="mt-2 text-[10.5px]" style={{ color: T.warn }}>{err}</p>}
      {mode && !err && (
        <div className="mt-2">
          {items.length === 0 ? (
            <p className="text-[10.5px]" style={{ color: T.muted }}>
              Sin resultados en la memoria.
            </p>
          ) : (
            <>
              <p className="text-[10.5px]" style={{ color: T.muted }}>
                {TITLES[mode]} {mode === "ticker" ? <b style={{ color: T.ink2 }}>{q.trim().toUpperCase()}</b> : "lo escrito"}
              </p>
              <ul className="mt-1.5 max-h-[220px] space-y-1.5 overflow-y-auto">
                {items.map((m, i) => (
                  <li key={`${m.ticker}-${m.created_at}-${i}`}
                      className="rounded border px-2.5 py-1.5" style={{ borderColor: T.grid }}>
                    <div className="flex items-center gap-2">
                      <b className={NUMS} style={{ color: T.ink }}>{m.ticker}</b>
                      <span className="text-[10px]" style={{ color: T.muted }}>{fmtTime(m.created_at)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug" style={{ color: T.ink2 }}>
                      {m.text}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
