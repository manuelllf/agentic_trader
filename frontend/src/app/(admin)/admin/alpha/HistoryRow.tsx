"use client";

import { useTranslations } from "next-intl";
import { fmtTime, money, qty4 } from '@/lib/format';
import type { Approval } from '@/lib/types';
import { T } from './tokens';
import { SideTag, Td } from './ui';

const HIST_STATUS: Record<string, { key: "alpha_status_executed" | "alpha_status_working" | "alpha_status_rejected" | "alpha_status_failed" | "alpha_status_expired"; color: string }> = {
  executed: { key: "alpha_status_executed", color: T.good },
  working: { key: "alpha_status_working", color: T.warn },
  rejected: { key: "alpha_status_rejected", color: T.muted },
  failed: { key: "alpha_status_failed", color: T.bad },
  expired: { key: "alpha_status_expired", color: T.muted },
};

export function HistoryRow({ h }: { h: Approval }) {
  const t = useTranslations();
  const st = HIST_STATUS[h.status];
  return (
    <tr className="border-t" style={{ borderColor: T.grid }}>
      <Td><SideTag action={h.action} /></Td>
      <Td><b style={{ color: T.ink }}>{h.ticker}</b></Td>
      <Td>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: st.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
          {st ? t(st.key) : h.status}
        </span>
      </Td>
      <Td>
        <span className="block max-w-[420px] whitespace-normal text-[12px] sm:truncate" style={{ color: T.muted }}>
          {h.quantity && h.fill_price ? `${qty4(h.quantity)} @ $${money(h.fill_price)} · ` : ""}
          {h.result_msg}
        </span>
      </Td>
      <Td right><span className="text-[11px]" style={{ color: T.muted }}>{fmtTime(h.decided_at)}</span></Td>
    </tr>
  );
}
