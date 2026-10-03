"use client";

import { useTransition, type CSSProperties } from "react";
import { claseSigno, porcentaje } from "@/lib/liga/format";
import { CASA, Escudo, type ClaveCasa, type EscudoValor } from "./Escudo";

// `.tr` de la maqueta: fila de la clasificación (DESIGN.md §6). `rowT()` la porta tal cual.

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
  G: "Ganada",
  E: "Empate",
  P: "Perdida",
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
  tipo?: TipoFila;
  /** Color de la casa para el tinte `--hc` cuando `tipo === "casa"` (DESIGN.md §2). */
  colorCasa?: string;
  abrible?: boolean;
  onClick?: () => void;
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
  tipo = "normal",
  colorCasa,
  abrible = true,
  onClick,
}: FilaEquipoProps) {
  const [pendiente, navegar] = useTransition();
  const clases = ["tr", tipo === "mia" ? "me" : tipo === "casa" ? "casa" : ""]
    .filter(Boolean)
    .join(" ");
  const acento = casa ? (casa === "lambda" ? "#8F8A80" : CASA[casa].color) : colorCasa;
  const estilo =
    tipo === "casa" && acento ? ({ "--hc": acento } as CSSProperties) : undefined;
  const formatoIntervalo = (valor: string) => new Date(`${valor}T12:00:00`).toLocaleDateString(
    "es-ES", { day: "numeric", month: "short", year: "numeric" },
  );
  const claseFila = `${clases}${acumulado !== undefined ? " financiero" : ""}${pendiente ? " navegando" : ""}`;

  return (
    <button type="button" className={claseFila} style={estilo} aria-busy={pendiente || undefined}
      data-symbol={casa ? { alpha: "α", omega: "Ω", lambda: "λ" }[casa] : undefined}
      aria-disabled={pendiente || undefined}
      onClick={() => {
        if (onClick && !pendiente) navegar(onClick);
      }}>
      <span className="pos num" aria-label={`Posición ${puesto}`}>{puesto}<span className="pos-label">posición</span></span>
      <span className="name">
        <Escudo valor={escudo} casa={casa} etiqueta={`Escudo de ${nombre}`} />
        <span className="nm">
          <b>{nombre}</b>
          <span className="sub">
            {acumulado === undefined && resultados.map((r, i) => (
              <span key={i} className={`rs ${r}`} aria-label={TEXTO_RESULTADO[r]}>
                {r}
              </span>
            ))}
            <span>{etiqueta}</span>
          </span>
        </span>
        {abrible && <Chevron pendiente={pendiente} />}
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {pendiente ? `Abriendo ${nombre}` : ""}
        </span>
      </span>
      {acumulado !== undefined ? (
        <span className="finance" aria-label="Rentabilidad acumulada y benchmark">
          {acumulado ? (
            <>
              <span className={`primary num ${claseSigno(acumulado.rentabilidad)}`}>
                {porcentaje(acumulado.rentabilidad)}<span className="finance-label">retorno acumulado</span>
              </span>
              <span className={`bench num ${claseSigno(acumulado.sp500)}`}>
                S&amp;P 500 {porcentaje(acumulado.sp500)}
              </span>
              <span className={`pp num ${claseSigno(acumulado.diferencia_pp)}`}>
                {porcentaje(acumulado.diferencia_pp).replace(" %", " pp")} vs S&amp;P
              </span>
              <span className="period">
                {acumulado.incompleta ? `Últimos ${acumulado.periodos} periodos seguidos` : "Acumulado"}
                {" · "}{formatoIntervalo(acumulado.desde)} – {formatoIntervalo(acumulado.hasta)}
              </span>
            </>
          ) : (
            <span className="period">Sin jornadas cerradas comparables</span>
          )}
        </span>
      ) : (
        <span className={`vs num ${claseSigno(vsIndice)}`}>{porcentaje(vsIndice).replace(/%$/, "pp")}</span>
      )}
      <span className="rankmeta">
        {acumulado !== undefined && (
          movimiento != null && <span className={`move ${movimiento > 0 ? "up" : movimiento < 0 ? "dn" : "fl"}`}>
            {movimiento > 0 ? `↑${movimiento} posiciones`
              : movimiento < 0 ? `↓${Math.abs(movimiento)} posiciones` : "Sin cambio de posición"}
          </span>
        )}
        <span className="pts num">{puntos} pts</span>
      </span>
    </button>
  );
}
