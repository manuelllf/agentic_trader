// Tabla del Universo + el modal de historico completo por ticker (agregados, señales, el
// toggle de apagar el ticker).
import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/format';
import { setMantenerUniverso } from '../api';
import { caidaVsAth, costeBase, fmtFecha, fmtRet, TIPO_LABEL } from '../helpers';
import { MONO, NUMS, T } from '../tokens';
import type { Senal, Validacion } from '../types';
import { Toggle } from './ui';

/** Universo: fusiona lo que antes eran "Validación histórica" + "Universo vigilado" (mismos
 *  34 tickers repetidos en dos acordeones) en una sola tabla. Cada fila abre un modal (16-sep-2026,
 *  pedido explícito -- antes el histórico señal-por-señal solo se podía consultar por SQL) con
 *  la lista completa de señales de ese ticker + el toggle "mantener". */
export function UniversoTabla({ validacion, onAbrir }: {
  validacion: Validacion[]; onAbrir: (v: Validacion) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr style={{ color: T.muted }}>
            {["Ticker", "Sector", "n", "Media", "% pos"].map((h, i) => (
              <th key={h} className={`whitespace-nowrap px-2.5 pb-2 text-[9px] font-bold uppercase tracking-wide ${i >= 2 ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {validacion.map((v, i) => <UniversoRow key={v.ticker} v={v} first={i === 0} onAbrir={onAbrir} />)}
        </tbody>
      </table>
    </div>
  );
}

export function UniversoRow({ v, first, onAbrir }: {
  v: Validacion; first: boolean; onAbrir: (v: Validacion) => void;
}) {
  const apagado = v.mantener === false;
  const celda = "px-2.5 py-2";
  const borde = !first ? { borderTop: `1px solid ${T.grid}` } : undefined;

  return (
    <>
      <tr onClick={() => onAbrir(v)} className="cursor-pointer" style={{ ...borde, opacity: apagado ? 0.5 : 1 }}>
        <td className={`${celda} ${MONO} font-semibold`} style={{ color: apagado ? T.warn : T.ink }}>
          {v.ticker}{apagado && <span className="ml-1.5 text-[9px] font-normal">apagado</span>}
        </td>
        <td className={celda} style={{ color: T.muted }}>{v.sector}</td>
        <td className={`${celda} ${NUMS} text-right`} style={{ color: T.ink2 }}>{v.n}</td>
        <td className={`${celda} ${NUMS} text-right`} style={{ color: v.media == null ? T.muted : v.media >= 0 ? T.good : T.bad }}>
          {v.media != null ? fmtRet(v.media) : "-"}
        </td>
        <td className={`${celda} ${NUMS} text-right`} style={{ color: T.ink2 }}>{v.pct_positivas ?? "-"}{v.pct_positivas != null && "%"}</td>
        <td className={`${celda} text-right`} style={{ color: T.muted }}>›</td>
      </tr>
    </>
  );
}

/** Modal del histórico de un ticker del Universo (16-sep-2026): antes esto solo se podía mirar
 *  a mano por SQL -- Manuel lo pidió explícitamente para no depender de pedírmelo cada vez.
 *  Tamaño FIJO (mismo alto/ancho tenga el ticker 1 señal o 12) con scroll interno propio de la
 *  tabla, no de la página -- así el modal nunca "salta" de tamaño entre tickers. */
export function UniversoTickerModal({ v, alertas, historial, preciosVivos, onCambio, onClose }: {
  v: Validacion; alertas: Senal[]; historial: Senal[]; preciosVivos: Record<string, number | null>;
  onCambio: (ticker: string, patch: Partial<Validacion>) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const apagado = v.mantener === false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleMantener = async () => {
    setBusy(true);
    try {
      const nuevo = apagado;
      await setMantenerUniverso(v.ticker, nuevo);
      onCambio(v.ticker, { mantener: nuevo });
    } finally {
      setBusy(false);
    }
  };

  // Alertas (sin resolver) + Historial (resueltas, o descartadas/vendidas en seguimiento) de
  // ESTE ticker -- los dos endpoints son conjuntos disjuntos por construcción (ver routes.py),
  // así que concatenar no duplica nada.
  const señales = useMemo(() => {
    const propias = [...alertas, ...historial].filter((s) => s.ticker === v.ticker);
    return propias.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [alertas, historial, v.ticker]);

  const resueltas = señales.filter((s) => s.resuelta && s.dias != null);
  const diasMedios = resueltas.length
    ? resueltas.reduce((acc, s) => acc + Number(s.dias), 0) / resueltas.length
    : null;

  const cols = ["Entrada", "Tipo", "Precio", "Caída ref.", "Caída ATH", "Resultado", "Días trade", "Caída máx.", "Días a fondo"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Histórico de ${v.ticker}`}
           className="flex w-full max-w-lg flex-col rounded-2xl border shadow-xl"
           style={{ borderColor: T.ring, background: T.panel, height: "min(620px, 90vh)" }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: T.grid }}>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-[16px] font-bold ${MONO}`} style={{ color: T.ink }}>{v.ticker}</span>
            <span className="text-[10.5px]" style={{ color: T.muted }}>{v.sector}</span>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="hover:opacity-70" style={{ color: T.muted }}>✕</button>
        </div>

        {/* Cuerpo con scroll interno propio -- el modal nunca crece ni encoge con el contenido. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto px-4 py-3">
          {señales.length === 0 ? (
            <p className="py-6 text-center text-[12px]" style={{ color: T.muted }}>Sin señales todavía.</p>
          ) : (
            <table className="w-full text-[10.5px]" style={{ minWidth: 720 }}>
              <thead>
                <tr style={{ color: T.muted }}>
                  {cols.map((h, i) => (
                    <th key={h} className={`sticky top-0 whitespace-nowrap px-1.5 pb-1.5 text-[8.5px] font-bold uppercase tracking-wide ${i >= 2 ? "text-right" : "text-left"}`}
                        style={{ background: T.panel }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {señales.map((s, i) => (
                  <UniversoSenalRow key={s.id} s={s} first={i === 0} precioVivo={preciosVivos[s.ticker] ?? null} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Agregados + apagar ticker -- siempre visibles, fuera del área con scroll. */}
        <div className="shrink-0 border-t px-4 py-3" style={{ borderColor: T.grid }}>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>n</div>
              <b className={`${NUMS} text-[15px]`} style={{ color: T.ink }}>{v.n}</b>
            </div>
            <div>
              <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>Media</div>
              <b className={`${NUMS} text-[15px]`} style={{ color: v.media == null ? T.muted : v.media >= 0 ? T.good : T.bad }}>
                {v.media != null ? fmtRet(v.media) : "-"}
              </b>
            </div>
            <div>
              <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>Mediana</div>
              <b className={`${NUMS} text-[15px]`} style={{ color: v.mediana == null ? T.muted : v.mediana >= 0 ? T.good : T.bad }}>
                {v.mediana != null ? fmtRet(v.mediana) : "-"}
              </b>
            </div>
            <div>
              <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>Días medios</div>
              <b className={`${NUMS} text-[15px]`} style={{ color: T.ink }}>{diasMedios != null ? diasMedios.toFixed(0) : "-"}</b>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg px-3 py-2" style={{ background: T.base }}>
            <span className="text-[12px] font-semibold" style={{ color: T.ink2 }}>
              Mantener en universo
              {apagado && <span className="ml-1.5 font-normal" style={{ color: T.warn }}>· apagado, sigue en seguimiento</span>}
            </span>
            <Toggle checked={!apagado} onChange={toggleMantener} disabled={busy} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function UniversoSenalRow({ s, first, precioVivo }: { s: Senal; first: boolean; precioVivo: number | null }) {
  const celda = "px-1.5 py-1.5";
  const borde = !first ? { borderTop: `1px solid ${T.grid}` } : undefined;

  const cerradaAMano = s.estado === "vendida" && !s.resuelta && s.cierre_manual != null;
  const enCurso = !s.resuelta && !cerradaAMano;
  const ret = cerradaAMano ? Number(s.cierre_manual!.ret)
    : enCurso && precioVivo != null ? (precioVivo / costeBase(s) - 1) * 100
    : Number(s.ret);
  const motivoTxt = cerradaAMano ? "cerrada a mano"
    : enCurso ? (s.estado === "descartada" ? "descartada, en curso" : "en curso")
    : s.motivo === "objetivo" ? "objetivo" : s.motivo === "tiempo" ? "90 días" : "-";

  return (
    <tr style={borde}>
      <td className={`${celda} ${NUMS}`} style={{ color: T.ink2 }}>{fmtFecha(s.entry_date)}</td>
      <td className={celda} style={{ color: T.muted }}>{TIPO_LABEL[s.tipo]}</td>
      <td className={`${celda} ${NUMS} text-right`} style={{ color: T.ink }}>${money(s.entry_price)}</td>
      <td className={`${celda} ${NUMS} text-right`} style={{ color: T.bad }}>-{Number(s.caida_pct).toFixed(1)}%</td>
      <td className={`${celda} ${NUMS} text-right`} style={{ color: T.bad }}>
        {caidaVsAth(s) != null ? `-${caidaVsAth(s)!.toFixed(1)}%` : "-"}
      </td>
      <td className={`${celda} ${NUMS} text-right`} style={{ color: enCurso ? T.warn : ret >= 0 ? T.good : T.bad }}>
        {ret != null && !Number.isNaN(ret) ? fmtRet(ret) : "-"}
        <div className="text-[8.5px] font-normal" style={{ color: T.muted }}>{motivoTxt}</div>
      </td>
      <td className={`${celda} ${NUMS} text-right`} style={{ color: T.ink2 }}>{s.dias ?? "-"}</td>
      <td className={`${celda} ${NUMS} text-right`} style={{ color: T.bad }}>
        {s.caida_max_pct != null ? fmtRet(Number(s.caida_max_pct)) : "-"}
      </td>
      <td className={`${celda} ${NUMS} text-right`} style={{ color: T.ink2 }}>{s.dias_hasta_min ?? "-"}</td>
    </tr>
  );
}
