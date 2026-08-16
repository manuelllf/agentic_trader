"use client";

// Configuración por etapa del botón "simulación" (📡): modelo, reasoning, temperatura y top_p
// de macro/prescorer/capa media/scorer profundo/constructor, antes de lanzar. Mismo patrón de
// emergente que ScanFullModal.tsx (velo + tarjeta + cerrar por X/Escape/click fuera). Se abre
// SIEMPRE con los defaults REALES de producción (vía /config), nunca con lo último que se haya
// configurado en una simulación anterior — no hay persistencia entre aperturas.
//
// Temperatura/top_p quedan editables en TODAS las etapas, tengan o no razonamiento activo:
// api-docs.deepseek.com/guides/thinking_mode dice que el modo razonamiento las ignora, pero
// mandarlas de más no rompe la llamada — se dejan siempre configurables en vez de deshabilitarlas
// según el reasoning elegido (decisión explícita, ver `scan_service.DEFAULT_TEMPERATURE`).

import { useEffect, useRef, useState } from "react";
import { getConfig } from "@/lib/api";
import type { DemoRunOverrides, ReasoningEffort, StageLLMOverride } from "@/lib/types";
import { T } from "./tokens";

const MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"] as const;
const REASONINGS: ReasoningEffort[] = ["none", "low", "high", "max"];

type Stage = "macro" | "prescore" | "mid" | "deep" | "constructor";

const STAGE_LABEL: Record<Stage, string> = {
  macro: "Macro",
  prescore: "Prescorer",
  mid: "Capa media",
  deep: "Scorer (profundo)",
  constructor: "Constructor",
};

// Defaults de arranque (mientras carga /config o si falla): reflejan la producción actual
// (config.py) — /config trae los reales en cuanto responde, esto es solo para no mostrar el
// modal vacío un instante.
const FALLBACK: Record<Stage, Required<StageLLMOverride>> = {
  macro: { model: "deepseek-v4-pro", reasoning_effort: "max", temperature: 1.0, top_p: 0.95 },
  prescore: { model: "deepseek-v4-flash", reasoning_effort: "none", temperature: 1.0, top_p: 0.95 },
  mid: { model: "deepseek-v4-pro", reasoning_effort: "low", temperature: 1.0, top_p: 0.95 },
  deep: { model: "deepseek-v4-pro", reasoning_effort: "high", temperature: 1.0, top_p: 0.95 },
  constructor: { model: "deepseek-v4-pro", reasoning_effort: "max", temperature: 1.0, top_p: 0.95 },
};

const STAGES: Stage[] = ["macro", "prescore", "mid", "deep", "constructor"];

export function ScanConfigModal({ onClose, onLaunch }: {
  onClose: () => void;
  onLaunch: (overrides: DemoRunOverrides) => void;
}) {
  const [cfg, setCfg] = useState<Record<Stage, Required<StageLLMOverride>>>(FALLBACK);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    getConfig()
      .then((c) => {
        if (!c.llm_defaults) return;
        setCfg((prev) => {
          const next = { ...prev };
          for (const s of STAGES) {
            const d = c.llm_defaults[s];
            if (d) next[s] = { ...prev[s], model: d.model, reasoning_effort: d.reasoning_effort };
          }
          return next;
        });
      })
      .catch(() => {}); // el modal sigue usable con los FALLBACK si /config no responde
  }, []);

  const patch = (s: Stage, p: Partial<StageLLMOverride>) =>
    setCfg((prev) => ({ ...prev, [s]: { ...prev[s], ...p } }));

  // Objeto literal explícito, no un `{}` + asignación por bucle: "constructor" como nombre de
  // propiedad choca con `Object.prototype.constructor` y TS infiere mal el tipo del literal
  // vacío en ese caso.
  const launch = () => onLaunch({
    macro: cfg.macro, prescore: cfg.prescore, mid: cfg.mid, deep: cfg.deep,
    constructor: cfg.constructor,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Configuración de la simulación de escaneo"
           className="w-full max-w-2xl rounded-lg border shadow-xl"
           style={{ borderColor: T.ring, background: T.panel }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: T.grid }}>
          <div className="flex items-center gap-2">
            <b style={{ color: T.ink }}>Configurar simulación</b>
            <span className="text-[11px]" style={{ color: T.muted }}>
              modelo/reasoning reales, coste real — no toca ninguna cartera
            </span>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Cerrar" className="hover:opacity-70" style={{ color: T.muted }}>✕</button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3 text-[12px]">
          <div className="space-y-2.5">
            {STAGES.map((s) => <StageRow key={s} stage={s} v={cfg[s]} onChange={(p) => patch(s, p)} />)}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5" style={{ borderColor: T.grid }}>
          <button onClick={onClose}
                  className="rounded px-3 py-1.5 text-[11.5px] font-semibold hover:opacity-80"
                  style={{ color: T.muted }}>
            Cancelar
          </button>
          <button onClick={launch}
                  className="rounded-full px-4 py-1.5 text-[11.5px] font-bold hover:opacity-90"
                  style={{ background: T.warn, color: "#0d0d0d" }}>
            Lanzar simulación
          </button>
        </div>
      </div>
    </div>
  );
}

function StageRow({ stage, v, onChange }: {
  stage: Stage; v: Required<StageLLMOverride>; onChange: (p: Partial<StageLLMOverride>) => void;
}) {
  return (
    <div className="rounded border px-2.5 py-2" style={{ borderColor: T.grid }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
        {STAGE_LABEL[stage]}
      </p>
      <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="modelo">
          <select value={v.model} onChange={(e) => onChange({ model: e.target.value })}
                  className="w-full rounded border bg-transparent px-1.5 py-1 text-[11px]"
                  style={{ borderColor: T.ring, color: T.ink }}>
            {MODELS.map((m) => <option key={m} value={m} style={{ color: "#0d0d0d" }}>{m}</option>)}
          </select>
        </Field>
        <Field label="reasoning">
          <select value={v.reasoning_effort}
                  onChange={(e) => onChange({ reasoning_effort: e.target.value as ReasoningEffort })}
                  className="w-full rounded border bg-transparent px-1.5 py-1 text-[11px]"
                  style={{ borderColor: T.ring, color: T.ink }}>
            {REASONINGS.map((r) => <option key={r} value={r} style={{ color: "#0d0d0d" }}>{r}</option>)}
          </select>
        </Field>
        <Field label="temperatura">
          <input type="number" min={0} max={2} step={0.05} value={v.temperature}
                 onChange={(e) => onChange({ temperature: Number(e.target.value) })}
                 className={`w-full rounded border bg-transparent px-1.5 py-1 text-[11px] ${NUMS_CLASS}`}
                 style={{ borderColor: T.ring, color: T.ink }} />
        </Field>
        <Field label="top_p">
          <input type="number" min={0.01} max={1} step={0.01} value={v.top_p}
                 onChange={(e) => onChange({ top_p: Number(e.target.value) })}
                 className={`w-full rounded border bg-transparent px-1.5 py-1 text-[11px] ${NUMS_CLASS}`}
                 style={{ borderColor: T.ring, color: T.ink }} />
        </Field>
      </div>
    </div>
  );
}

const NUMS_CLASS = "tabular-nums";

function Field({ label, dim, children }: { label: string; dim?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[9.5px] uppercase tracking-wide" style={{ color: dim ? T.muted : T.ink2 }}>
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
