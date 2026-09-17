import { useState } from 'react';

export function CardHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-[#303030] px-4 py-3.5 text-[16px] font-bold text-white">
      {children}
    </div>
  );
}

// Card-acordeón del mockup (`details.card`): para módulos de consulta, no de lo que se lee
// siempre (eso sigue en `CardHead`, sección siempre abierta — "La cartera" en el mockup tampoco
// es acordeón). `head` es el mismo children mixto (texto + <span> de meta) que ya usaba CardHead.
export function Details({ head, defaultOpen, children }: {
  head: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const toggle = () => setOpen((o) => !o);
  return (
    <section className="border-t border-[#303030]">
      <div className="flex w-full items-center gap-2.5 py-3.5 pl-4 pr-2.5">
        <button onClick={toggle} aria-expanded={open} className="flex-1 text-left text-[16px] font-bold text-white">
          {head}
        </button>
        <button onClick={toggle} aria-expanded={open} aria-label={open ? "Colapsar" : "Desplegar"}
                className="flex shrink-0 items-center rounded p-1.5 text-[#6E6E6B] transition-colors hover:bg-white/5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               className="shrink-0 transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }}>
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>
      {open && <div className="border-t border-[#303030]">{children}</div>}
    </section>
  );
}

export function SectorChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition ${
        active ? "bg-[#4FA39D] text-white ring-[#4FA39D]" : "bg-[#1C1C1C] text-[#6E6E6B] ring-white/10 hover:ring-white/15"
      }`}
    >
      {children}
    </button>
  );
}

export function Empty({ running }: { running: boolean }) {
  return (
    <div className="flex min-h-[22vh] flex-col items-center justify-center border-t border-[#303030] text-center">
      <p className="text-3xl">{running ? "🛰️" : "📡"}</p>
      <p className="mt-3 max-w-sm text-sm text-[#6E6E6B]">
        {running
          ? "El agente puntúa el universo y construye la cartera…"
          : "El agente escanea cada semana para aprender y decide cartera el primer martes del mes (o al lanzarlo desde Alpha). Cuando decida, aquí aparece la cartera, ya ejecutada en el libro sombra."}
      </p>
    </div>
  );
}

export function Kpi({ label, value, sub, accent, tone }: {
  label: string; value: string; sub?: string; accent?: boolean; tone?: "pos" | "neg";
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6E6B]">{label}</p>
      <p className={`mt-1.5 text-[22px] font-bold tabular-nums tracking-tight ${
        accent ? "text-white" : tone === "pos" ? "text-[#6BBE8A]" : tone === "neg" ? "text-[#E0776C]" : "text-white"
      }`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-[#6E6E6B]">{sub}</p>}
    </div>
  );
}
