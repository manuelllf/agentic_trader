import { fmtScore, money } from '@/lib/format';
import { richText } from '@/lib/richText';
import type { ScoreRow } from '@/lib/types';
import { scoreColor } from './helpers';

export function ScoreRowItem({ row }: { row: ScoreRow }) {
  return (
    <details className="group py-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span className="w-16 shrink-0 font-semibold tracking-tight text-white">{row.ticker}</span>
        <span className="hidden w-36 shrink-0 truncate text-[11px] text-[#6E6E6B] sm:block">{row.sector}</span>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#1C1C1C]">
          <span className={`absolute inset-y-0 left-0 rounded-full ${scoreColor(row.score)}`} style={{ width: `${row.score}%` }} />
        </span>
        {/* w-14: la nota lleva dos decimales, "78.43" no cabe en 3rem. */}
        <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-[#A3A3A0]">{fmtScore(row.score)}</span>
        {row.held ? (
          <span className="shrink-0 rounded bg-[#6BBE8A]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#6BBE8A] ring-1 ring-inset ring-[#6BBE8A]/30">EN CARTERA</span>
        ) : row.on_watchlist ? (
          <span className="shrink-0 rounded bg-[#232323] px-1.5 py-0.5 text-[9px] font-bold text-[#6E6E6B] ring-1 ring-inset ring-white/15">SEGUIM.</span>
        ) : (
          <span className="hidden w-[62px] shrink-0 sm:block" />
        )}
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#565654] transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      {row.price != null && (
        <p className="mt-2 pl-16 text-xs tabular-nums text-[#6E6E6B]">${money(row.price)}</p>
      )}
      {row.headline && <p className="mt-2 pl-16 text-sm text-[#A3A3A0]">{richText(row.headline)}</p>}
      {row.report && <p className="mt-2 whitespace-pre-line pl-16 text-xs leading-relaxed text-[#6E6E6B]">{richText(row.report)}</p>}
    </details>
  );
}
