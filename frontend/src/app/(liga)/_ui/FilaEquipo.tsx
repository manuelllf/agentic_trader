"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { claseSigno, fraseVsIndice, porcentaje } from "@/lib/liga/format";
import { Escudo, type ClaveCasa, type EscudoValor } from "./Escudo";

// `.tr` de la maqueta: fila de la clasificación (DESIGN.md §6). Con `acumulado` es una fila de
// lista como la de «Este mes»: escudo y nombre a la izquierda, resultado frente al S&P a la derecha.

export type ResultadoJornada = "G" | "E" | "P";
export type TipoFila = "normal" | "mia" | "casa";
export type RentabilidadAcumulada = {
  rentabilidad: number;
  sp500: number;
  diferencia_pp: number;
  desde: string;
  hasta: string;
  periodos: number;
  incompleta: boolean;
};

const TEXTO_RESULTADO: Record<ResultadoJornada, string> = {
  G: "ganada",
  E: "empate",
  P: "perdida",
};

const Chevron = ({ pendiente = false }: { pendiente?: boolean }) => (
  <svg
    className="chev"
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {pendiente ? <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>
      : <path d="M9 6l6 6-6 6" />}
  </svg>
);

export interface FilaEquipoProps {
  puesto: number;
  nombre: string;
  escudo: EscudoValor;
  casa?: ClaveCasa | null;
  /** Resultado de las últimas jornadas, más reciente al final (letras G/E/P bajo el nombre). */
  resultados?: ResultadoJornada[];
  /** «de la casa» / «publicada» / «privada» / «la tuya» (DESIGN.md §7, leyenda de clasificación). */
  etiqueta: string;
  vsIndice: number;
  puntos: number;
  acumulado?: RentabilidadAcumulada | null;
  /** Places moved up since the immediately preceding completed league period. */
  movimiento?: number | null;
  orden?: "rentabilidad" | "puntos";
  ganadas?: number;
  empatadas?: number;
  perdidas?: number;
  tipo?: TipoFila;
  /** Sin tinte propio desde el rediseño; se acepta por compatibilidad con quien aún lo pasa. */
  colorCasa?: string;
  abrible?: boolean;
  onClick?: () => void;
  /** Se llama al tocar o pasar por encima, antes del clic: para ir cargando lo que se abrirá. */
  alAcercar?: () => void;
}

export function FilaEquipo({
  puesto,
  nombre,
  escudo,
  casa,
  resultados = [],
  etiqueta,
  vsIndice,
  puntos,
  acumulado,
  movimiento,
  orden,
  ganadas,
  empatadas,
  perdidas,
  tipo = "normal",
  abrible = true,
  onClick,
  alAcercar,
}: FilaEquipoProps) {
  const t = useTranslations();
  const locale = useLocale() === "en" ? "en" : "es";
  const [pendiente, navegar] = useTransition();
  const clases = ["tr", tipo === "mia" ? "me" : tipo === "casa" ? "casa" : ""]
    .filter(Boolean)
    .join(" ");
  const claseFila = `${clases}${acumulado !== undefined ? " financiero" : ""}${pendiente ? " navegando" : ""}`;
  const abrir = () => {
    if (onClick && !pendiente) navegar(onClick);
  };
  const acercar = abrible && alAcercar
    ? { onPointerEnter: alAcercar, onPointerDown: alAcercar, onFocus: alAcercar }
    : {};
  const sube = movimiento ?? 0;
  const posicion = (
    <span className="pos num">
      <span aria-label={t("common_ranking_posicion_aria", { count: puesto })}>{puesto}</span>
      {acumulado !== undefined && orden !== "rentabilidad" && sube !== 0 && (
        <small className={`move ${sube > 0 ? "up" : "dn"}`}
          aria-label={t(sube > 0 ? "common_ranking_sube_posiciones" : "common_ranking_baja_posiciones", { count: Math.abs(sube) })}>
          {sube > 0 ? "↑" : "↓"}{Math.abs(sube)}
        </small>
      )}
    </span>
  );
  const estadoApertura = (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {pendiente ? t("common_abriendo", { texto: nombre }) : ""}
    </span>
  );

  if (acumulado !== undefined) {
    return (
      <button type="button" disabled={!abrible} className={claseFila} aria-busy={pendiente || undefined}
        aria-disabled={pendiente || undefined} onClick={abrir} {...acercar}>
        <span className="name">
          {posicion}
          <Escudo valor={escudo} casa={casa} baldosa tamano={28} etiqueta={t("common_ranking_escudo", { name: nombre })} />
          <span className="nm">
            <b>{nombre}</b>
            <span className="sub">
              <span>{etiqueta}</span>
              {orden !== "puntos" && <>
                {acumulado?.incompleta && <span>{t("common_ranking_periodos_seguidos", { count: acumulado.periodos })}</span>}
                <span className="num">{t("strategies_points", { count: puntos })}</span>
              </>}
            </span>
          </span>
        </span>
        <span className="fila-res" aria-label={t(orden === "puntos" ? "common_ranking_puntos_balance" : "common_ranking_rentabilidad_benchmark")}>
          {orden === "puntos" ? (
            <>
              <span className="ret num">{t("strategies_points", { count: puntos })}</span>
              {ganadas !== undefined && empatadas !== undefined && perdidas !== undefined && (
                <span className="vsp num">{ganadas}{t("common_ranking_letra_ganada")} · {empatadas}{t("common_ranking_letra_empate")} · {perdidas}{t("common_ranking_letra_perdida")}</span>
              )}
            </>
          ) : acumulado ? (
            <>
              <span className={`ret num ${claseSigno(acumulado.rentabilidad)}`}>{porcentaje(acumulado.rentabilidad, 1, locale)}</span>
              <span className="vsp num">{fraseVsIndice(t, acumulado.diferencia_pp, locale)}</span>
            </>
          ) : (
            <>
              <span className="ret num fl">—</span>
              <span className="vsp">{t("strategies_no_closes")}</span>
            </>
          )}
        </span>
        {abrible ? <Chevron pendiente={pendiente} /> : <span />}
        {estadoApertura}
      </button>
    );
  }

  return (
    <button type="button" disabled={!abrible} className={claseFila} aria-busy={pendiente || undefined}
      aria-disabled={pendiente || undefined} onClick={abrir} {...acercar}>
      {posicion}
      <span className="name">
        <Escudo valor={escudo} casa={casa} etiqueta={t("common_ranking_escudo", { name: nombre })} />
        <span className="nm">
          <b>{nombre}</b>
          <span className="sub">
            {resultados.map((r, i) => (
              <span key={i} className={`rs ${r}`} aria-label={t(`common_ranking_${TEXTO_RESULTADO[r]}`)}>
                {t(`common_ranking_letra_${TEXTO_RESULTADO[r]}`)}
              </span>
            ))}
            <span>{etiqueta}</span>
          </span>
        </span>
        {abrible && <Chevron pendiente={pendiente} />}
        {estadoApertura}
      </span>
      <span className={`vs num ${claseSigno(vsIndice)}`}>{porcentaje(vsIndice, 1, locale).replace(/%$/, "pp")}</span>
      <span className="rankmeta">
        <span className="pts num">{t("strategies_points", { count: puntos })}</span>
      </span>
    </button>
  );
}
