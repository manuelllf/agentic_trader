"use client";

import type { CSSProperties } from "react";
import { claseSigno, porcentaje } from "@/lib/liga/format";
import { Escudo, type EscudoValor } from "./Escudo";

// `.tr` de la maqueta: fila de la clasificación (DESIGN.md §6). `rowT()` la porta tal cual.

export type ResultadoJornada = "G" | "E" | "P";
export type TipoFila = "normal" | "mia" | "casa";

const TEXTO_RESULTADO: Record<ResultadoJornada, string> = {
  G: "Ganada",
  E: "Empate",
  P: "Perdida",
};

const Chevron = () => (
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
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export interface FilaEquipoProps {
  puesto: number;
  nombre: string;
  escudo: EscudoValor;
  /** Resultado de las últimas jornadas, más reciente al final (letras G/E/P bajo el nombre). */
  resultados?: ResultadoJornada[];
  /** «de la casa» / «publicada» / «privada» / «la tuya» (DESIGN.md §7, leyenda de clasificación). */
  etiqueta: string;
  vsIndice: number;
  puntos: number;
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
  resultados = [],
  etiqueta,
  vsIndice,
  puntos,
  tipo = "normal",
  colorCasa,
  abrible = true,
  onClick,
}: FilaEquipoProps) {
  const clases = ["tr", tipo === "mia" ? "me" : tipo === "casa" ? "casa" : ""]
    .filter(Boolean)
    .join(" ");
  const estilo =
    tipo === "casa" && colorCasa ? ({ "--hc": colorCasa } as CSSProperties) : undefined;

  return (
    <button type="button" className={clases} style={estilo} onClick={onClick}>
      <span className="pos num">{puesto}</span>
      <span className="name">
        <Escudo valor={escudo} etiqueta={`Escudo de ${nombre}`} />
        <span className="nm">
          <b>{nombre}</b>
          <span className="sub">
            {resultados.map((r, i) => (
              <span key={i} className={`rs ${r}`} aria-label={TEXTO_RESULTADO[r]}>
                {r}
              </span>
            ))}
            <span className="tag">{etiqueta}</span>
          </span>
        </span>
        {abrible && <Chevron />}
      </span>
      <span className={`vs num ${claseSigno(vsIndice)}`}>{porcentaje(vsIndice)}</span>
      <span className="pts num">{puntos}</span>
    </button>
  );
}
