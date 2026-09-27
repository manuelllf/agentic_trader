import type { ScanReport } from '@/lib/api';
import { InfoTip } from '@/components/InfoTip';
import { cascada, fmtNum, fmtScanCost, sectoresTop, universoLinea, type FunnelScan } from '@/lib/scan';

/** El embudo del escaneo: de todo el mercado mirado a los cinco que acaban en cartera.
 *  Es PÚBLICO a propósito — cuenta cómo se comporta el sistema sin nombrar a nadie, que es
 *  justo la línea que separa "así funciona" de un feed de señales. */
export function FunnelCascade({ report, scan }: { report: ScanReport | null; scan: FunnelScan | null }) {
  const pasos = cascada(report, scan);
  const universo = universoLinea(report);
  const sectores = sectoresTop(scan, 4);
  const coste = fmtScanCost(report?.cost ?? null);

  if (!pasos.length) {
    return (
      <p className="text-[#6E6E6B]">
        Cada martes el agente estudia el mercado entero para aprender. Aún no hay traza del
        último escaneo.
      </p>
    );
  }
  return (
    <>
      {universo && (
        <p className={universo.tone === "ok" ? "text-[#6E6E6B]" : "font-medium text-[#fab219]"}>
          universo <b className="tabular-nums font-semibold text-white">{universo.texto}</b>
          <span className="text-[#6E6E6B]"> · {universo.detalle}</span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {pasos.map((p, i) => (
          <div key={p.label} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[#565654]" aria-hidden>→</span>}
            <div className="rounded-lg bg-[#232323] px-2.5 py-1.5 ring-1 ring-inset ring-white/10">
              <p className="text-[15px] font-semibold leading-none tabular-nums text-white">
                {fmtNum(p.value)}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[10.5px] leading-none text-[#6E6E6B]">
                {p.label}
                {p.pctOfPrev != null && (
                  <span className="tabular-nums">
                    {" · "}{p.pctOfPrev < 1 ? p.pctOfPrev.toFixed(1) : Math.round(p.pctOfPrev)}%
                  </span>
                )}
                {p.hint && <InfoTip text={p.hint} />}
              </p>
            </div>
          </div>
        ))}
      </div>
      {sectores.length > 0 && (
        <p className="mt-2 text-[11px] text-[#6E6E6B]">
          a fondo por sector:{" "}
          {sectores.map((s, i) => (
            <span key={s.sector} className="tabular-nums">
              {i > 0 && " · "}{s.sector} <b className="font-semibold text-[#A3A3A0]">{s.deep}</b>
              <span className="text-[#6E6E6B]">/{fmtNum(s.pre)}</span>
            </span>
          ))}
        </p>
      )}
      {coste && <p className="mt-1 text-[11px] tabular-nums text-[#6E6E6B]">coste del escaneo {coste}</p>}
      {(report?.issues ?? []).length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-[#fab219]">
          {(report?.issues ?? []).map((it) => (
            <li key={it}><span className="mr-1" aria-hidden>▲</span>{it}</li>
          ))}
        </ul>
      )}
    </>
  );
}
