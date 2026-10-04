"use client";
import { useLocale, useTranslations } from "next-intl";
// Detalle de una fila de Historial: mismo lenguaje visual que AlertaCard pero de solo
// lectura (ya esta descartada o resuelta, no hay nada que ejecutar aqui).
import { useEffect } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { money } from '@/lib/format';
import {
  costeBase, distAth, distPicoLocal, esGateRegimen, fmtFecha, fmtRet, precioHoy,
  tituloRegimen, TIPO_LABEL,
} from '../helpers';
import { MONO, NUMS, T } from '../tokens';
import type { Regimen, Senal } from '../types';

/** Card expandida de una fila de Historial (9-sep-2026): mismo lenguaje visual que `AlertaCard`
 *  pero sin sus acciones (ya está descartada o resuelta, no hay nada que ejecutar) -- solo para
 *  mirar el detalle de una señal que quizá interese reconsiderar, sobre todo las t("omega_in_progress")
 *  (descartadas pero aún sin resolver, ver doc). En t("omega_resolved") no hay "hoy" que valga -- el
 *  precio de salida es el mismo cálculo que ya usa `precioHoy` sobre el `ret` final guardado. */
export function HistorialModal({ s, precioVivo, regimen, onClose }: {
  s: Senal; precioVivo: number | null; regimen: Regimen | null; onClose: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale() === "en" ? "en" : "es";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cerradaAMano = s.estado === "vendida" && s.cierre_manual != null;
  const soloSistema = cerradaAMano && s.cierre_manual!.ret_sistema != null
    ? Number(s.cierre_manual!.ret_sistema) : null;
  const enCurso = !s.resuelta && !cerradaAMano;
  const precioMostrado = enCurso ? (precioVivo ?? precioHoy(s)) : precioHoy(s);
  const retornoMostrado = cerradaAMano
    ? Number(s.cierre_manual!.ret)
    : enCurso && precioVivo != null
      ? (precioVivo / costeBase(s) - 1) * 100
      : Number(s.ret);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-6"
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Detalle señal ${s.ticker}`}
           className="w-full max-w-md rounded-2xl border shadow-xl"
           style={{ borderColor: T.ring, background: T.panel }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: T.grid }}>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-[16px] font-bold ${MONO}`} style={{ color: T.ink }}>{s.ticker}</span>
            <span className="text-[10.5px]" style={{ color: T.muted }}>{s.sector}</span>
          </div>
          <button onClick={onClose} aria-label={t("omega_attr_cerrar")} className="hover:opacity-70" style={{ color: T.muted }}>✕</button>
        </div>

        <div className="p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wide"
                  style={{ background: "rgba(255,255,255,0.06)", color: T.ink2 }}>
              {t(TIPO_LABEL[s.tipo] ?? "omega_pattern_zigzag")}
            </span>
            <span className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wide"
                  style={enCurso ? { background: "rgba(250,178,25,0.14)", color: T.warn } : { background: "rgba(255,255,255,0.06)", color: T.ink2 }}>
              {enCurso ? t("omega_in_progress") : cerradaAMano ? t("omega_manually_closed") : t("omega_resolved")}
            </span>
            {!enCurso && s.motivo && (
              <span className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wide"
                    style={{ background: "rgba(255,255,255,0.06)", color: T.ink2 }}>
                {s.motivo === "objetivo" ? t("omega_target") : t("omega_time")}
              </span>
            )}
            {s.mantener === false && <span className="text-[9px]" style={{ color: T.warn }}>{t("omega_ui_apagado")}</span>}
            {esGateRegimen(s) && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold" style={{ color: T.bad }}>
                ⛔ {t("omega_regime")}
                <InfoTip text={tituloRegimen(s, regimen, t)} />
              </span>
            )}
          </div>

          <div className="mt-3 text-[12px]" style={{ color: T.ink2 }}>
            <b className={NUMS} style={{ color: T.bad }}>-{Number(s.caida_pct).toFixed(1)}%</b>{t("omega_ui_bajo_el")}{" "}
            {s.ref_label === "ATH_referencia" ? "ATH" : t("omega_last_peak")} (${money(s.ref_price, 2, locale)})
            {distAth(s) != null && (
              <>
                {" "}· <b className={NUMS} style={{ color: T.bad }}>-{distAth(s)!.toFixed(1)}%</b>{t("omega_ui_bajo_el_ath")}{money(s.ath!, 2, locale)})
              </>
            )}
            {distPicoLocal(s) != null && (
              <>
                {" "}· <b className={NUMS} style={{ color: T.bad }}>-{distPicoLocal(s)!.toFixed(1)}%</b>{t("omega_ui_bajo_el_ultimo_pico")}{money(s.ref_price_pico!, 2, locale)})
              </>
            )}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
            <div className="min-w-0">
              <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_senal_titulo")}</div>
              <b className={`${NUMS} text-[14px]`} style={{ color: T.ink }}>${money(s.entry_price, 2, locale)}</b>
            </div>
            <div className="min-w-0">
              <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>{enCurso ? "Hoy" : "Salida"}</div>
              <b className={`${NUMS} text-[14px]`} style={{ color: T.ink }}>${money(precioMostrado, 2, locale)}</b>
            </div>
            <div className="min-w-0">
              <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_retorno")}</div>
              <b className={`${NUMS} text-[14px]`} style={{ color: retornoMostrado >= 0 ? T.good : T.bad }}>{fmtRet(retornoMostrado, locale)}</b>
            </div>
          </div>

          <div className="mt-3 text-[11px]" style={{ color: T.muted }}>
            Gate:{" "}
            {s.gate_resultado == null ? <b style={{ color: T.warn }}>{t("omega_ui_pendiente")}</b>
              : s.gate_resultado === "pasa" ? <b style={{ color: T.good }}>{t("omega_ui_pasa")}</b>
              : <b style={{ color: T.bad }}>{t("omega_ui_falla")}</b>}
            {s.gate_detalle && <span>. {s.gate_detalle}</span>}
          </div>

          {/* Lo que se escribió de verdad al marcar "Ejecutada" -- vive en `momentum_ejecuciones`,
              tabla aparte de la señal; hasta el 14-sep-2026 se guardaba y ningún sitio lo volvía
              a mostrar. Solo aparece si /alertas trajo una ejecución para esta señal. */}
          {s.ejecucion && (
            <div className="mt-4 rounded-lg p-3" style={{ background: T.panel2 }}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_tu_ejecucion")}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                <div>
                  <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_acciones")}</div>
                  <b className={NUMS} style={{ color: T.ink }}>{Number(s.ejecucion.acciones)}</b>
                </div>
                <div>
                  <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_precio_de_compra")}</div>
                  <b className={NUMS} style={{ color: T.ink }}>${money(s.ejecucion.precio, 2, locale)}</b>
                </div>
                <div>
                  <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_comision")}</div>
                  <b className={NUMS} style={{ color: T.ink }}>${money(s.ejecucion.comision, 2, locale)}</b>
                </div>
                <div>
                  <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_invertido")}</div>
                  <b className={NUMS} style={{ color: T.ink }}>
                    ${money(Number(s.ejecucion.acciones) * Number(s.ejecucion.precio) + Number(s.ejecucion.comision), 2, locale)}
                  </b>
                </div>
              </div>
              {s.ejecucion.notas && (
                <div className="mt-2.5 border-t pt-2" style={{ borderColor: T.grid }}>
                  <div className="text-[8.5px] uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_notas")}</div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: T.ink2 }}>{s.ejecucion.notas}</p>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t pt-3 text-[10.5px]" style={{ borderColor: T.grid, color: T.muted }}>
            <span>{t("omega_entry_date", { date: fmtFecha(s.entry_date, locale) })}</span>
            {enCurso
              ? <span style={{ color: T.warn }}>{s.dias}{t("omega_ui_d_en_seguimiento")}</span>
              : cerradaAMano
                ? <span>
                    {s.cierre_manual!.exit_date ? `Vendida ${fmtFecha(s.cierre_manual!.exit_date, locale)}` : t("omega_manual_sale")}
                    {soloSistema != null && ` · sola habría hecho ${fmtRet(soloSistema, locale)}`}
                  </span>
                : s.exit_date && <span>{t("omega_exit_date", { date: fmtFecha(s.exit_date, locale), days: s.dias ?? "—" })}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
