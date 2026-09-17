import { signMoney } from '@/lib/format';
import { NUMS, T } from './tokens';

/* Barra ± de P&L por posición: baseline central, verde derecha / rojo izquierda, a escala común. */
export function PnlBar({ value, maxAbs, pct }: { value: number | null; maxAbs: number; pct: number | null }) {
  if (value == null) return <span style={{ color: T.muted }}>—</span>;
  const w = Math.min(100, (Math.abs(value) / maxAbs) * 100);
  const pos = value >= 0;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-block h-[6px] w-[72px] overflow-hidden rounded-full" style={{ background: T.grid }}>
        <span className="absolute inset-y-0 left-1/2 w-px" style={{ background: T.base }} />
        <span className="absolute inset-y-0 rounded-full"
              style={pos
                ? { left: "50%", width: `${w / 2}%`, background: T.good }
                : { right: "50%", width: `${w / 2}%`, background: T.bad }} />
      </span>
      <span className={`font-semibold ${NUMS}`} style={{ color: pos ? T.good : T.bad }}>
        {signMoney(value)}
      </span>
      {pct != null && (
        <span className={`text-[11px] ${NUMS}`} style={{ color: T.muted }}>
          {pct > 0 ? "+" : ""}{pct}%
        </span>
      )}
    </span>
  );
}
