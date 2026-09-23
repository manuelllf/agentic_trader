// Piezas de presentacion pura reutilizadas por varias tarjetas/modales de Omega: nada de
// estado de negocio ni llamadas a la API aqui, solo layout.
import { useEffect, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { NUMS, T } from '../tokens';
import type { Regimen } from '../types';

/** Botón de acción con icono + texto -- reemplaza los 4 iconos-solo + leyenda aparte de antes.
 *  Sin color propio: el texto ya dice lo que hace, ningún tono decorativo que aprender.
 *  `hint` (opcional) es la explicación larga, en un InfoTip aparte -- no el `title` nativo. */
export function ActionChip({ onClick, label, hint, busy, stroke, children }: {
  onClick: () => void; label: string; hint?: string; busy?: boolean; stroke?: boolean;
  children: React.ReactNode;
}) {
  return (
    // La píldora entera es el botón (zona táctil completa); el InfoTip va fuera, al lado.
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <button onClick={onClick} disabled={busy}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition active:opacity-60 disabled:opacity-50"
              style={{ borderColor: T.grid, background: T.panel2, color: T.ink2 }}>
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 shrink-0 ${busy ? (stroke ? "animate-spin" : "animate-pulse") : ""}`}
             fill={stroke ? "none" : "currentColor"}
             stroke={stroke ? "currentColor" : undefined}
             strokeWidth={stroke ? 2.2 : undefined} strokeLinecap={stroke ? "round" : undefined} strokeLinejoin={stroke ? "round" : undefined}>
          {children}
        </svg>
        {label}
      </button>
      {hint && <InfoTip text={hint} />}
    </span>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-3 flex items-baseline gap-2 text-[16px] font-bold tracking-tight" style={{ color: T.ink }}>
        {title}
        {count != null && <span className="text-[12.5px] font-normal" style={{ color: T.muted }}>{count}</span>}
      </p>
      {children}
    </div>
  );
}

/** Sección colapsada por defecto (Validación histórica / Candidatos / Universo en el mockup
 *  usan `<details>` sin `open`) — aquí con un botón para poder controlar el chevron a mano. */
export function Collapsible({ title, count, children }: { title: string; count?: number | string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6 border" style={{ borderColor: T.grid }}>
      <button onClick={() => setOpen((o) => !o)}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left">
        <span className="text-[16px] font-bold" style={{ color: T.ink }}>
          {title}{" "}
          {count != null && <span className="text-[13px] font-normal" style={{ color: T.muted }}>{count}</span>}
        </span>
        <span className="text-[13px] transition-transform" style={{ color: T.muted, transform: open ? "rotate(180deg)" : undefined }}>▾</span>
      </button>
      {open && <div className="border-t" style={{ borderColor: T.grid }}>{children}</div>}
    </div>
  );
}

/** Termómetro de régimen (10-sep-2026): cesta equiponderada del universo a 60 sesiones. Solo
 *  informativo -- nunca bloquea entradas, ver docs/momentum-sim/RESULTADOS.md para el porqué
 *  (un único episodio histórico real, sin base para automatizarlo todavía). */
export function RegimenChip({ regimen }: { regimen: Regimen }) {
  if (regimen.cesta_60d == null) return null;
  const feo = regimen.activo;
  return (
    <div className="mb-2.5 border-l-2 py-0.5 pl-3 text-[11px]"
         style={{ borderColor: feo ? T.bad : T.grid }}>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: feo ? T.bad : T.muted }} />
        <span style={{ color: T.ink2 }}>
          Salud del universo (60d):{" "}
          <b className={NUMS} style={{ color: feo ? T.bad : T.ink }}>{regimen.cesta_60d.toFixed(1)}%</b>
        </span>
      </div>
      {/* Leyenda SIEMPRE visible, no solo al pasar el ratón -- en móvil el title del tooltip
          nunca se ve. */}
      <p className="mt-1 pl-3.5 text-[9.5px] leading-snug" style={{ color: T.muted }}>
        Cómo le ha ido, de media, al conjunto de tickers del universo en los últimos 3 meses.{" "}
        {feo
          ? "Por debajo de este nivel el sector lleva tiempo cayendo por su cuenta aunque el mercado esté bien -- informativo, no bloquea nada."
          : "Solo referencia, no bloquea ninguna entrada."}
      </p>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t py-5 text-center text-[12px]"
         style={{ borderColor: T.grid, color: T.muted }}>
      {children}
    </div>
  );
}

export function CargarMasBtn({ onClick, restantes }: { onClick: () => void; restantes: number }) {
  return (
    <div className="mt-2 text-center">
      <button onClick={onClick}
              className="rounded-full border px-4 py-1.5 text-[11.5px] font-semibold transition-colors hover:bg-white/5"
              style={{ borderColor: T.ring, color: T.ink2 }}>
        Cargar 5 más ({restantes} ocultas)
      </button>
    </div>
  );
}

export function FormField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[9px] uppercase tracking-wide" style={{ color: T.muted }}>{label}</label>
      <input type="number" value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)}
             className="w-full rounded-lg px-2 py-1.5 text-[13px] font-bold outline-none"
             style={{ background: T.base, border: `1px solid ${T.ring}`, color: T.ink }} />
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button onClick={onChange} disabled={disabled} aria-pressed={checked}
            className="relative h-[21px] w-9 shrink-0 rounded-full transition-colors disabled:opacity-50"
            style={{ background: checked ? T.entry : T.grid }}>
      <span className="absolute left-[2px] top-[2px] h-[17px] w-[17px] rounded-full bg-white transition-transform"
            style={{ transform: checked ? "translateX(15px)" : "translateX(0)" }} />
    </button>
  );
}

/** Mensaje de resultado bajo la cabecera (escaneo/detección manual): se borra solo a los 6s,
 *  o al momento con la X -- antes se quedaba pegado hasta el siguiente clic en ese botón. */
export function AvisoTemporal({ texto, onCerrar }: { texto: string; onCerrar: () => void }) {
  useEffect(() => {
    const t = setTimeout(onCerrar, 6000);
    return () => clearTimeout(t);
  }, [texto, onCerrar]);

  return (
    <div className="mb-3 flex items-center justify-between gap-2 text-[11px]"
         style={{ color: T.muted }}>
      <span>{texto}</span>
      <button onClick={onCerrar} aria-label="Cerrar aviso" className="shrink-0 hover:opacity-70">✕</button>
    </div>
  );
}
