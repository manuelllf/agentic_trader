"use client";

import { useEffect, useRef } from "react";
import type { SeguimientoEstrategia } from "@/lib/liga/seguimiento";
import styles from "./CambiosEstrategia.module.css";

function pct(valor: number): string {
  const n = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 2 })
    .format(Math.abs(valor));
  return `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${n} %`;
}

function lista(tickers: string[]): string {
  return tickers.length ? tickers.join(", ") : "Ninguna";
}

/** Factual summary shared by Mías and the owner's strategy ficha. */
export function CambiosEstrategia({ resumen, alMostrar }: {
  resumen: SeguimientoEstrategia;
  alMostrar?: () => void;
}) {
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
    <section ref={tarjeta} className={styles.card} aria-label={`Seguimiento de ${resumen.nombre}`}>
      <div className={styles.heading}>Seguimiento</div>
      {resumen.primera_revision ? (
        <p className={styles.note}>Primera revisión: esta información queda como referencia.</p>
      ) : (
        <p className={styles.note}>
          {resumen.resultado_nuevo
            ? "Hay un resultado cerrado desde tu última revisión."
            : "Sin resultados cerrados nuevos desde tu última revisión."}
        </p>
      )}

      {resultado ? (
        <div className={styles.metrics}>
          <div><span>Última jornada cerrada</span><b>{resultado.jornada_id} · {resultado.dia_fin}</b></div>
          <div><span>Estrategia</span><b>{pct(resultado.rentabilidad)}</b></div>
          <div><span>S&amp;P 500</span><b>{pct(resultado.sp500)}</b></div>
          <div><span>Diferencia</span><b>{pct(resultado.diferencia_sp).replace(" %", " pp")}</b></div>
        </div>
      ) : (
        <p className={styles.note}>Aún no hay un resultado cerrado para mostrar.</p>
      )}

      <div className={styles.portfolio}>
        {resumen.cambio_desde_revision && <>
          <b>Desde tu última revisión</b>
          {resumen.cambio_desde_revision.entradas.length || resumen.cambio_desde_revision.salidas.length ? (
            <p>Entradas: {lista(resumen.cambio_desde_revision.entradas)} · Salidas: {lista(resumen.cambio_desde_revision.salidas)}</p>
          ) : <p>Sin cambios de composición desde tu última revisión.</p>}
        </>}
        <b>Comparación de las dos carteras formadas más recientes</b>
        {cambio ? (
          <>
            <p>Jornada {cambio.jornada_actual_id} frente a la jornada {cambio.jornada_anterior_id}.</p>
            <p>Entradas: {lista(cambio.entradas)} · Salidas: {lista(cambio.salidas)}</p>
            {cambio.nueva_desde_revision && !resumen.primera_revision && (
              <p className={styles.note}>La cartera más reciente se formó después de tu última revisión.</p>
            )}
          </>
        ) : (
          <p>Aún no hay dos carteras formadas con las que comparar.</p>
        )}
        <p className={styles.note}>La comparación refleja posiciones guardadas; no confirma una reevaluación de reglas.</p>
      </div>
    </section>
  );
}
