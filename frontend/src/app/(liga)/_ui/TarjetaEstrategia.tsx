import Link from "next/link";
import type { ReactNode } from "react";
import { Escudo, type EscudoValor } from "./Escudo";

export interface TarjetaEstrategiaProps {
  id: string;
  nombre: string;
  escudo: EscudoValor;
  escudoEtiqueta: string;
  estado: string;
  punto: "jugando" | "apuntada" | "otro";
  puesto?: number;
  movimiento?: number;
  puestoEtiqueta?: string;
  mes?: { etiqueta: string; valor: string; clase: "up" | "dn" | "fl" | ""; dif?: string } | null;
  abrible: boolean;
  ajustesAbiertos: boolean;
  ajustesEtiqueta: string;
  ocupada?: boolean;
  onAjustes: () => void;
  alAcercar: () => void;
  lineas?: ReactNode;
  ajustes?: ReactNode;
}

// La tarjeta resume la estrategia porque el detalle vive en la ficha.
export function TarjetaEstrategia({ id, nombre, escudo, escudoEtiqueta, estado, punto, puesto,
  movimiento, puestoEtiqueta, mes, abrible, ajustesAbiertos, ajustesEtiqueta, ocupada,
  onAjustes, alAcercar, lineas, ajustes }: TarjetaEstrategiaProps) {
  return (
    <article className={`mias-estrategia${abrible ? " abrible" : ""}`} aria-busy={ocupada || undefined}>
      <div className={`mias-cab${puesto != null ? "" : " sinpos"}`}>
        {puesto != null && (
          <span className="mias-pos num" aria-label={puestoEtiqueta}>{puesto}
            {movimiento ? <small className={movimiento > 0 ? "up" : "dn"}>{movimiento > 0 ? "↑" : "↓"}{Math.abs(movimiento)}</small> : null}
          </span>
        )}
        <Link href={`/ficha/${id}`} className="mias-identidad" onPointerEnter={alAcercar} onPointerDown={alAcercar}>
          <Escudo valor={escudo} etiqueta={escudoEtiqueta} tamano={36} />
          <span className="mias-nm">
            <h2>{nombre}</h2>
            <small className="mias-est"><i className={`punto ${punto}`} aria-hidden="true" /><span>{estado}</span></small>
          </span>
        </Link>
        {mes && (
          <span className="mias-res">
            <u>{mes.etiqueta}</u><b className={`num ${mes.clase}`}>{mes.valor}</b>{mes.dif && <small className={`num ${mes.clase}`}>{mes.dif}</small>}
          </span>
        )}
        <button type="button" className="mias-mas" aria-expanded={ajustesAbiertos} aria-label={ajustesEtiqueta} onClick={onAjustes}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
      </div>
      {lineas}
      {ajustesAbiertos && ajustes}
    </article>
  );
}
