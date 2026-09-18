import type { ScanReport } from '@/lib/api';
import { fmtTime } from '@/lib/format';
import {
  cascada, fmtNum, fmtScanCost, sectoresTop, universoLinea, type FunnelScan,
} from '@/lib/scan';
import { ScanFullButton } from './ScanFullModal';
import { NUMS, T } from './tokens';
import { Details } from './ui';

/* Informe del último escaneo: una línea si fue sano; lista ámbar de incidencias; rojo si
   reventó entero. Fuente: /scan/report (persistido), no el estado en memoria del runner. */
export function ScanReportPanel({ r, scan }: { r: ScanReport; scan: FunnelScan | null }) {
  const failed = !!r.error;
  const issues = r.issues ?? [];
  const clean = !failed && issues.length === 0;
  const pasos = cascada(r, scan);
  const universo = universoLinea(r);
  const sectores = sectoresTop(scan, 6);
  // Peso real: cuota de CADA sector sobre el total de "a fondo" del escaneo entero, no solo los
  // 6 de la tabla -- antes la barra usaba "vistos" (tamaño del universo), que no dice nada de
  // dónde se concentró el análisis caro. Sobre el total nunca se pasa de 100%, así que no hace
  // falta ningún techo artificial como antes.
  const totalDeep = Math.max(1, (scan?.sectores ?? []).reduce((acc, s) => acc + s.deep, 0));

  return (
    <Details title="Último escaneo"
           meta={fmtTime(r.at)}
           defaultOpen
           accent={failed ? T.bad : issues.length ? T.warn : undefined}
           right={<ScanFullButton />}>
      <div className="px-4 py-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span style={{ color: T.ink2 }}>modo <b style={{ color: T.ink }}>{r.mode ?? "—"}</b></span>
          {universo && (
            <span className={NUMS} style={{ color: universo.tone === "ok" ? T.ink2 : T.warn }}>
              universo <b>{universo.texto}</b>
              <span style={{ color: T.muted }}> · {universo.detalle}</span>
            </span>
          )}
          {fmtScanCost(r.cost) && (
            <span className={NUMS} style={{ color: T.muted }}>{fmtScanCost(r.cost)}</span>
          )}
          {clean && <span className="font-bold" style={{ color: T.good }}>✓ sin incidencias</span>}
        </div>

        {/* El embudo como cascada: es LA cifra que cuenta qué hace el sistema. */}
        {pasos.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-stretch gap-1.5">
            {pasos.map((p, i) => (
              <div key={p.label} className="flex items-center gap-1.5">
                {i > 0 && <span style={{ color: T.muted }} aria-hidden>→</span>}
                <div className="rounded-md px-2.5 py-1.5" style={{ background: T.panel2 }} title={p.hint}>
                  <p className={`text-[15px] font-bold leading-none ${NUMS}`} style={{ color: T.ink }}>
                    {fmtNum(p.value)}
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-none" style={{ color: T.muted }}>
                    {p.label}
                    {p.pctOfPrev != null && (
                      <span className={NUMS}> · {p.pctOfPrev < 1 ? p.pctOfPrev.toFixed(1) : Math.round(p.pctOfPrev)}%</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
            {(scan?.sin_datos || scan?.prescore_error || scan?.deep_error) ? (
              <span className={`self-center text-[10.5px] ${NUMS}`} style={{ color: T.muted }}>
                ({scan.sin_datos} sin datos{scan.prescore_error ? ` · ${scan.prescore_error} fallos de pre-score` : ""}{scan.deep_error ? ` · ${scan.deep_error} profundos ilegibles` : ""})
              </span>
            ) : null}
          </div>
        )}

        {/* Por sector: dónde miró y dónde profundizó -- responde al "colapso sectorial".
            table-fixed + colgroup: el ancho de cada columna es fijo de verdad, así que la
            tabla entera nunca pide más ancho del que tiene (nada de scroll interno) -- el
            sector largo trunca con "…" en vez de estirar su columna. */}
        {sectores.length > 0 && (
          <table className={`mt-3 w-full table-fixed text-[11px] ${NUMS}`}>
            <colgroup>
              <col />
              <col style={{ width: "3.5rem" }} />
              <col style={{ width: "3.5rem" }} />
              <col style={{ width: "5.5rem" }} />
            </colgroup>
            <thead>
              <tr style={{ color: T.muted }}>
                <th className="pb-1 text-left font-semibold">sector</th>
                <th className="pb-1 text-right font-semibold">vistos</th>
                <th className="pb-1 text-right font-semibold">a fondo</th>
                <th className="pb-1 pl-3 text-left font-semibold">peso</th>
              </tr>
            </thead>
            <tbody>
              {sectores.map((s) => (
                <tr key={s.sector} style={{ color: T.ink2 }}>
                  <td className="max-w-0 truncate py-0.5 pr-2">{s.sector}</td>
                  <td className="py-0.5 text-right">{fmtNum(s.pre)}</td>
                  <td className="py-0.5 text-right" style={{ color: s.deep ? T.ink : T.muted }}>{s.deep}</td>
                  <td className="overflow-hidden py-0.5 pl-3">
                    <span className="block h-[6px] rounded-sm"
                          style={{ width: `${Math.max(2, (s.deep / totalDeep) * 100)}%`, background: T.buy }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {(r.changes ?? []).length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {(r.changes ?? []).map((c) => (
              <li key={c} style={{ color: T.ink2 }}>
                <span className="mr-1.5" style={{ color: T.buy }} aria-hidden>›</span>{c}
              </li>
            ))}
          </ul>
        )}
        {failed && (
          <p className="mt-2 font-semibold" style={{ color: "#e66767" }}>
            El escaneo FALLÓ: {r.error}
          </p>
        )}
        {issues.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {issues.map((it) => (
              <li key={it} style={{ color: T.ink2 }}>
                <span className="mr-1.5" style={{ color: T.warn }} aria-hidden>▲</span>{it}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Details>
  );
}
