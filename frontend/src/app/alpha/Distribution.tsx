import { money } from '@/lib/format';
import type { RealSummary } from '@/lib/types';
import { NUMS, SERIES, T } from './tokens';

/* Distribución de la cartera: barra apilada (huecos de 2px) + leyenda con etiquetas directas. */
export function Distribution({ summary, equity, fx }: { summary: RealSummary; equity: number; fx: number | null }) {
  // Mismo consolidado que "Patrimonio": $ + € al cambio indicativo, para que la barra cuadre.
  const cash = Number(summary.cash.usd) + Number(summary.cash.eur) * (fx ?? 0);
  const rows = summary.positions.map((p, i) => ({
    label: p.ticker, value: Number(p.value), color: SERIES[i % SERIES.length],
  }));
  if (cash > 0.005) rows.push({ label: "Caja", value: cash, color: T.base });
  const total = equity > 0 ? equity : rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <div className="px-4 pb-1 pt-2.5">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded">
        {rows.map((r) => (
          <div key={r.label} title={`${r.label} ${(r.value / total * 100).toFixed(1)}%`}
               className="h-full rounded-[3px]"
               style={{ width: `${Math.max(0.75, (r.value / total) * 100)}%`, background: r.color }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pb-1 text-[11.5px]">
        {rows.map((r) => (
          <span key={r.label} className="inline-flex items-center gap-1.5" style={{ color: T.ink2 }}>
            <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />
            {r.label}
            <span className={`font-semibold ${NUMS}`} style={{ color: T.ink }}>
              {((r.value / total) * 100).toFixed(1)}%
            </span>
            <span className={NUMS} style={{ color: T.muted }}>${money(r.value, 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
