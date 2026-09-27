import { fmtScore, money } from '@/lib/format';
import { richText } from '@/lib/richText';

/* Par de filas de la tabla de cartera: la fila de datos + (si está abierta) su tesis. */
export function PositionRows({ anon, color, label, sector, pos, weightPct, up, pct, open, srow, onToggle }: {
  anon: boolean; color: string; label: string; sector?: string;
  pos: { avg_cost?: string | null; price?: string | null; value?: string | null };
  weightPct: number | null; up: number; pct: number; open: boolean;
  srow?: { headline: string | null; score: number };
  onToggle: () => void;
}) {
  const clickable = !anon;
  return (
    <>
      <tr
        onClick={clickable ? onToggle : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-expanded={clickable ? open : undefined}
        onKeyDown={clickable ? (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
        } : undefined}
        className={`border-t border-[#303030] ${clickable ? "cursor-pointer transition-colors hover:bg-[#232323] focus-visible:bg-[#232323] focus-visible:outline-none" : ""}`}
      >
        <td className="py-2 pr-3">
          <span className={`mr-2 inline-block h-2 w-2 rounded-sm align-middle ${color}`} />
          <b className="font-semibold text-white">{label}</b>
          {sector && <span className="ml-2 text-[10px] text-[#6E6E6B]">{sector}</span>}
        </td>
        {!anon && <td className="px-3 py-2 text-right">{weightPct != null ? `${weightPct.toFixed(1)}%` : "—"}</td>}
        {!anon && <td className="px-3 py-2 text-right text-[#6E6E6B]">{pos.avg_cost ? `$${money(pos.avg_cost)}` : "—"}</td>}
        {!anon && <td className="px-3 py-2 text-right">{pos.price ? `$${money(pos.price)}` : "—"}</td>}
        {!anon && <td className="px-3 py-2 text-right text-white">{pos.value ? `$${money(pos.value)}` : "—"}</td>}
        <td className="px-3 py-2 text-right">
          <span className={`text-[11px] ${up >= 0 ? "text-[#6BBE8A]/80" : "text-[#E0776C]/80"}`}>
            {up >= 0 ? "+" : "−"}${money(Math.abs(up))}
          </span>{" "}
          <span className={`font-semibold ${pct >= 0 ? "text-[#6BBE8A]" : "text-[#E0776C]"}`}>
            {pct > 0 ? "+" : ""}{pct}%
          </span>
        </td>
        <td className="py-2 text-right text-[#565654]">
          {clickable && (
            <svg viewBox="0 0 24 24" className={`inline h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-[#303030] bg-[#232323]/50">
          {/* whitespace-normal: la tabla es nowrap (columnas numéricas), pero la tesis debe
              ENVOLVER — si no, una línea larga estira la tabla y fuerza scroll horizontal. */}
          <td colSpan={7} className="whitespace-normal px-3 py-2 text-[11.5px] leading-relaxed text-[#6E6E6B]">
            {srow?.headline
              ? <><span className="font-semibold text-[#A3A3A0]">Tesis</span> · {richText(srow.headline)}
                  <span className="ml-1 text-[#6E6E6B]">
                    · score {fmtScore(srow.score)}
                  </span></>
              : "Sin tesis reciente para este nombre (saldrá en el próximo análisis a fondo)."}
          </td>
        </tr>
      )}
    </>
  );
}
