import { fmtTime } from '@/lib/format';
import { useOrden } from '@/lib/useOrden';
import { NUMS, T } from './tokens';

/* Una tabla de "Analítica del método": columnas = claves del primer registro (no se tipa cada
   campo, son consultas DuckDB de forma libre). Carga, error (p.ej. 503 sin DuckDB) y vacío,
   cada uno con su mensaje — nada se traga en silencio. overflow-x-auto por si la tabla es ancha. */
/** Navegador compacto ‹ Total › compartido por coste-etapa/confianza-prescore: `pos` -1 = Total
 *  (agregado histórico, sin scan_run_id), 0 = escaneo más reciente, 1 = el siguiente más
 *  antiguo, etc., recorriendo `scans` (orden de `/analytics/scans`, ya descendente por fecha). */
export function ScanNav({ scans, pos, onMove, totalLabel = "Total", formatLabel }: {
  scans: { id: number | string; at: string; cadence: string }[];
  pos: number;
  onMove: (pos: number) => void;
  totalLabel?: string;
  formatLabel?: (at: string) => string;
}) {
  const atTotal = pos <= -1;
  const atOldest = scans.length === 0 || pos >= scans.length - 1;
  const label = atTotal ? totalLabel
    : (formatLabel ?? fmtTime)(scans[pos]?.at ?? "");
  return (
    <div className="flex shrink-0 items-center gap-1 text-[10.5px]" style={{ color: T.muted }}>
      <button onClick={() => onMove(pos - 1)} disabled={atTotal}
              className="rounded px-1.5 leading-5 disabled:opacity-30"
              style={{ background: T.panel2 }} aria-label="Escaneo más reciente / total">
        ‹
      </button>
      <span className="min-w-[64px] text-center font-semibold" style={{ color: T.ink2 }}>{label}</span>
      <button onClick={() => onMove(pos + 1)} disabled={atOldest}
              className="rounded px-1.5 leading-5 disabled:opacity-30"
              style={{ background: T.panel2 }} aria-label="Escaneo anterior">
        ›
      </button>
    </div>
  );
}

export function AnalyticsTable({ title, state, nav }: {
  title: string;
  state: { data: Record<string, unknown>[] | null; loading: boolean; error: string };
  nav?: React.ReactNode;
}) {
  const cols = state.data && state.data.length > 0 ? Object.keys(state.data[0]) : [];
  const rows = state.data ?? [];
  const { sorted, sortKey, sortDir, toggle, ariaSort } = useOrden<Record<string, unknown>, string>(
    rows, (row, key) => {
      const v = row[key];
      if (v == null) return null;
      if (typeof v === "number") return v;
      return String(v);
    });
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: T.muted }}>
          {title}
        </p>
        {nav}
      </div>
      {state.loading ? (
        <p className="text-[11.5px]" style={{ color: T.muted }}>Cargando…</p>
      ) : state.error ? (
        <p className="text-[11.5px]" style={{ color: T.bad }}>{state.error}</p>
      ) : !state.data || state.data.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: T.muted }}>Sin datos.</p>
      ) : (
        <div className="overflow-x-auto rounded border" style={{ borderColor: T.grid }}>
          <table className={`w-full border-collapse whitespace-nowrap text-[11px] ${NUMS}`}>
            <thead>
              <tr style={{ color: T.muted, background: T.panel2 }}>
                {cols.map((c) => (
                  <th key={c} className="px-2 py-1 text-left font-semibold" aria-sort={ariaSort(c)}>
                    <button onClick={() => toggle(c)} aria-label={`Ordenar por ${c}`}
                            className="inline-flex items-center gap-0.5 hover:opacity-80"
                            style={{ color: sortKey === c ? T.ink : T.muted }}>
                      {c}
                      {sortKey === c && <span className="text-[8px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={i} className="border-t" style={{ borderColor: T.grid }}>
                  {cols.map((c) => (
                    <td key={c} className="px-2 py-1" style={{ color: T.ink2 }}>
                      {row[c] == null ? "—" : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
