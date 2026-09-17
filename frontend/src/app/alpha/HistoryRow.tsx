import { fmtTime, money, qty4 } from '@/lib/format';
import type { Approval } from '@/lib/types';
import { T } from './tokens';
import { SideTag, Td } from './ui';

const HIST_STATUS: Record<string, { label: string; color: string }> = {
  executed: { label: "Ejecutada", color: T.good },
  working: { label: "Trabajando", color: T.warn },
  rejected: { label: "Descartada", color: T.muted },
  failed: { label: "Fallida", color: T.bad },
  expired: { label: "Caducada", color: T.muted },
};

export function HistoryRow({ h }: { h: Approval }) {
  const st = HIST_STATUS[h.status] ?? { label: h.status, color: T.muted };
  return (
    <tr className="border-t" style={{ borderColor: T.grid }}>
      <Td><SideTag action={h.action} /></Td>
      <Td><b style={{ color: T.ink }}>{h.ticker}</b></Td>
      <Td>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: st.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
          {st.label}
        </span>
      </Td>
      <Td>
        <span className="block max-w-[420px] truncate text-[12px]" style={{ color: T.muted }} title={h.result_msg}>
          {h.quantity && h.fill_price ? `${qty4(h.quantity)} @ $${money(h.fill_price)} · ` : ""}
          {h.result_msg}
        </span>
      </Td>
      <Td right><span className="text-[11px]" style={{ color: T.muted }}>{fmtTime(h.decided_at)}</span></Td>
    </tr>
  );
}
