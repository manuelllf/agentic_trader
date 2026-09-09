"use client";

// Buscador sobre la memoria semántica, dentro de Mantenimiento. La tabla de scores se borra y
// reescribe en cada decisión mensual — esto es el ÚNICO archivo de lo que el sistema pensó en
// escaneos pasados. Un ticker exacto trae su historia; texto libre trae tesis parecidas.

import { useEffect, useRef, useState } from "react";
import { searchMemory, type MemoryItem } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { InfoTip } from "./InfoTip";
import { NUMS, T } from "./tokens";

const TITLES: Record<string, string> = {
  ticker: "Historia guardada de",
  semantic: "Tesis parecidas a",
  vacio: "",
};

// Cada búsqueda semántica calcula un embedding en la CPU del servidor: una por pulsación de
// tecla sería absurdo. Se espera este silencio desde la última tecla y un mínimo de caracteres
// antes de lanzarla sola; Enter y el botón "Buscar" siguen forzándola al instante.
const DEBOUNCE_MS = 400;
const MIN_CHARS = 3;

export function MemorySearch() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"ticker" | "semantic" | "vacio" | null>(null);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<MemoryItem | null>(null);   // recuerdo abierto en la emergente
  // Id incremental de la búsqueda en vuelo: si llega una respuesta que ya no es la última
  // lanzada (red lenta + tecleo rápido) se ignora, para que no pinte un resultado viejo encima.
  const reqId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = async (query: string) => {
    const myId = ++reqId.current;
    setBusy(true);
    setErr("");
    try {
      const r = await searchMemory(query);
      if (reqId.current !== myId) return;
      setMode(r.mode);
      setItems(r.items);
    } catch (e) {
      if (reqId.current !== myId) return;
      setMode(null);
      setItems([]);
      setErr(e instanceof Error ? e.message : "No se pudo buscar en la memoria.");
    } finally {
      if (reqId.current === myId) setBusy(false);
    }
  };

  const submit = () => {
    const query = q.trim();
    if (!query) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    runSearch(query);
  };

  useEffect(() => {
    const query = q.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < MIN_CHARS) return;
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  // Atajo "N tesis · ver historia": no es otra pantalla, es re-buscar ESE ticker (modo ficha).
  const openHistory = (ticker: string) => {
    setQ(ticker);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    runSearch(ticker);
  };

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: T.grid }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
          Memoria
        </span>
        <InfoTip text="Busca un ticker (su historia) o describe algo con texto libre (tesis parecidas)." />
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
                      onClick={() => setSelected(m)}
                      className="cursor-pointer rounded border px-2.5 py-1.5 transition-colors hover:bg-white/5"
                      style={{ borderColor: T.grid }}>
                    <div className="flex items-center gap-2">
                      <b className={NUMS} style={{ color: T.ink }}>{m.ticker}</b>
                      {mode === "semantic" && !!m.n_tesis && m.n_tesis > 1 && (
                        <button onClick={(e) => { e.stopPropagation(); openHistory(m.ticker); }}
                                className="text-[10px] font-semibold underline decoration-dotted underline-offset-2"
                                style={{ color: T.buy }}>
                          {m.n_tesis} tesis · ver historia
                        </button>
                      )}
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
      {selected && <MemoryModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Emergente con el recuerdo completo: la lista de arriba se queda en su preview de dos líneas,
 *  esto es lo único que muestra el texto entero. Mismo patrón que el overlay de ranking de
 *  sombra/page.tsx (velo + tarjeta + cerrar por X/Escape/click fuera), en el lenguaje dark T. */
function MemoryModal({ item, onClose }: { item: MemoryItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Recuerdo de ${item.ticker}`}
           className="w-full max-w-lg rounded-lg border shadow-xl"
           style={{ borderColor: T.ring, background: T.panel }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: T.grid }}>
          <div className="flex items-center gap-2">
            <b className={NUMS} style={{ color: T.ink }}>{item.ticker}</b>
            <span className="text-[11px]" style={{ color: T.muted }}>{fmtTime(item.created_at)}</span>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Cerrar"
                  className="hover:opacity-70" style={{ color: T.muted }}>
            ✕
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: T.ink2 }}>
            {item.text}
          </p>
          <p className="mt-3 border-t pt-2 text-[10px]" style={{ borderColor: T.grid, color: T.muted }}>
            Fragmento guardado (~550 caracteres: titular + principio del informe) — no el informe entero.
          </p>
        </div>
      </div>
    </div>
  );
}
