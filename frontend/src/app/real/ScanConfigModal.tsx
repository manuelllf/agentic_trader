"use client";

// Simulation button modal: configure model/reasoning/temperature/top_p per stage.
// Always opens with production defaults from /config. Temperature/top_p editable on all stages.

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
  prescore: { model: "deepseek-v4-flash", reasoning_effort: "none", temperature: 0.0, top_p: 0.95 },
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
  // Until /config resolves, controls are disabled to prevent race: user changes get overwritten by defaults.
  const [loaded, setLoaded] = useState(false);
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
            if (d) next[s] = { ...prev[s], model: d.model, reasoning_effort: d.reasoning_effort,
                               temperature: d.temperature };
          }
          return next;
        });
      })
      .catch(() => {}) // el modal sigue usable con los FALLBACK si /config no responde
      .finally(() => setLoaded(true));
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
      {/* Native select/input ignore theme (OS arrows/spinners are usually white); custom styled here. */}
      {/* jsx global: scopes to child components StageRow/NumberStepper via .cfg-* classes. */}
      <style jsx global>{`
        .cfg-select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23898781'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 6px center; background-size: 14px;
          padding-right: 22px; }
        .cfg-select option { background: ${T.panel2}; color: ${T.ink}; }
        .cfg-num { appearance: textfield; }
        .cfg-num::-webkit-inner-spin-button, .cfg-num::-webkit-outer-spin-button {
          appearance: none; margin: 0; }
      `}</style>
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

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3 text-[12px]" aria-busy={!loaded}>
          {!loaded && (
            <p className="mb-2 text-[11px]" style={{ color: T.muted }}>Cargando configuración real…</p>
          )}
          <div className={`space-y-2.5 ${loaded ? "" : "pointer-events-none opacity-50"}`}>
            {STAGES.map((s) => <StageRow key={s} stage={s} v={cfg[s]} onChange={(p) => patch(s, p)} />)}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5" style={{ borderColor: T.grid }}>
          <button onClick={onClose}
                  className="rounded px-3 py-1.5 text-[11.5px] font-semibold hover:opacity-80"
                  style={{ color: T.muted }}>
            Cancelar
          </button>
          <button onClick={launch} disabled={!loaded}
                  className="rounded-full px-4 py-1.5 text-[11.5px] font-bold hover:opacity-90 disabled:opacity-50"
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
                  className="cfg-select w-full rounded border px-1.5 py-1 text-[11px]"
                  style={{ borderColor: T.ring, color: T.ink, background: T.panel2 }}>
            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="reasoning">
          <select value={v.reasoning_effort}
                  onChange={(e) => onChange({ reasoning_effort: e.target.value as ReasoningEffort })}
                  className="cfg-select w-full rounded border px-1.5 py-1 text-[11px]"
                  style={{ borderColor: T.ring, color: T.ink, background: T.panel2 }}>
            {REASONINGS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="temperatura">
          <NumberStepper value={v.temperature} min={0} max={2} step={0.05}
                         onChange={(temperature) => onChange({ temperature })} />
        </Field>
        <Field label="top_p">
          <NumberStepper value={v.top_p} min={0.01} max={1} step={0.01}
                         onChange={(top_p) => onChange({ top_p })} />
        </Field>
      </div>
    </div>
  );
}

// Sustituye el spinner nativo (blanco, fuera de tema) por dos botones ▲/▼ a medida — mismo
// número de decimales que `step` para no acumular basura de coma flotante al pulsar.
function NumberStepper({ value, min, max, step, onChange }: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  const decimals = (step.toString().split(".")[1] || "").length;
  const clamp = (n: number) => Math.min(max, Math.max(min, Number(n.toFixed(decimals))));
  const bump = (dir: 1 | -1) => onChange(clamp(value + dir * step));
  return (
    <div className="flex items-stretch overflow-hidden rounded border" style={{ borderColor: T.ring }}>
      <input type="number" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(e.target.value === "" ? min : clamp(Number(e.target.value)))}
             className={`cfg-num w-full bg-transparent px-1.5 py-1 text-[11px] ${NUMS_CLASS}`}
             style={{ color: T.ink }} />
      <div className="flex flex-col border-l" style={{ borderColor: T.ring }}>
        <button type="button" tabIndex={-1} aria-label="Subir" onClick={() => bump(1)}
                className="flex h-[13px] w-5 items-center justify-center text-[8px] leading-none hover:opacity-70"
                style={{ color: T.muted, background: T.panel2 }}>▲</button>
        <button type="button" tabIndex={-1} aria-label="Bajar" onClick={() => bump(-1)}
                className="flex h-[13px] w-5 items-center justify-center border-t text-[8px] leading-none hover:opacity-70"
                style={{ color: T.muted, background: T.panel2, borderColor: T.ring }}>▼</button>
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
