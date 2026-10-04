"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import type { SeguimientoEstrategia } from "@/lib/liga/seguimiento";
import styles from "./CambiosEstrategia.module.css";

function pct(valor: number, locale: string): string {
  const n = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    .format(Math.abs(valor));
  return `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${n} %`;
}

function lista(tickers: string[], none: string): string {
  return tickers.length ? tickers.join(", ") : none;
}

/** Factual summary shared by Mías and the owner's strategy ficha. */
export function CambiosEstrategia({ resumen, alMostrar }: {
  resumen: SeguimientoEstrategia;
  alMostrar?: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const listaLocal = (tickers: string[]) => lista(tickers, t("common_seguimiento_ninguna"));
  const tarjeta = useRef<HTMLElement | null>(null);
  const avisado = useRef(false);
  useEffect(() => {
    const elemento = tarjeta.current;
    if (!elemento || !alMostrar || avisado.current) return;
    const observador = new IntersectionObserver(([entrada]) => {
      if (entrada.isIntersecting && document.visibilityState === "visible" && !avisado.current) {
        avisado.current = true;
        alMostrar();
        observador.disconnect();
      }
    }, { threshold: 0.2 });
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [alMostrar]);
  const { resultado, cambio_cartera: cambio } = resumen;
  return (
    <section ref={tarjeta} className={styles.card} aria-label={t("common_seguimiento_aria", { nombre: resumen.nombre })}>
      <div className={styles.heading}>{t("common_seguimiento_titulo")}</div>
      {resumen.primera_revision ? (
        <p className={styles.note}>{t("common_seguimiento_primera_revision")}</p>
      ) : (
        <p className={styles.note}>
          {resumen.resultado_nuevo
            ? t("common_seguimiento_resultado_nuevo")
            : t("common_seguimiento_sin_resultado_nuevo")}
        </p>
      )}

      {resultado ? (
        <div className={styles.metrics}>
          <div><span>{t("common_seguimiento_ultima_jornada")}</span><b>{resultado.jornada_id} · {resultado.dia_fin}</b></div>
          <div><span>{t("common_seguimiento_estrategia")}</span><b>{pct(resultado.rentabilidad, locale)}</b></div>
          <div><span>S&amp;P 500</span><b>{pct(resultado.sp500, locale)}</b></div>
          <div><span>{t("common_seguimiento_diferencia")}</span><b>{pct(resultado.diferencia_sp, locale).replace(" %", " pp")}</b></div>
        </div>
      ) : (
        <p className={styles.note}>{t("common_seguimiento_sin_resultado")}</p>
      )}

      <div className={styles.portfolio}>
        {resumen.cambio_desde_revision && <>
          <b>{t("common_seguimiento_desde_revision")}</b>
          {resumen.cambio_desde_revision.entradas.length || resumen.cambio_desde_revision.salidas.length ? (
            <p>{t("common_seguimiento_cambios", { entradas: listaLocal(resumen.cambio_desde_revision.entradas), salidas: listaLocal(resumen.cambio_desde_revision.salidas) })}</p>
          ) : <p>{t("common_seguimiento_sin_cambios")}</p>}
        </>}
        <b>{t("common_seguimiento_comparacion")}</b>
        {cambio ? (
          <>
            <p>{t("common_seguimiento_jornadas", { actual: cambio.jornada_actual_id, anterior: cambio.jornada_anterior_id })}</p>
            <p>{t("common_seguimiento_cambios", { entradas: listaLocal(cambio.entradas), salidas: listaLocal(cambio.salidas) })}</p>
            {cambio.nueva_desde_revision && !resumen.primera_revision && (
              <p className={styles.note}>{t("common_seguimiento_cartera_nueva")}</p>
            )}
          </>
        ) : (
          <p>{t("common_seguimiento_sin_dos_carteras")}</p>
        )}
        <p className={styles.note}>{t("common_seguimiento_nota")}</p>
      </div>
    </section>
  );
}
