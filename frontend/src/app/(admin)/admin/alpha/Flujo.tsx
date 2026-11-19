"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";

export type EstadoPaso = "hecho" | "curso" | "pendiente" | "fallo" | "fijo";
export interface Paso {
  clave: string;
  titulo: string;
  sub?: ReactNode;
  valor?: ReactNode;
  /** El valor como texto plano, para la imagen de compartir (que se pinta en un lienzo). */
  valorTexto?: string;
  estado: EstadoPaso;
  subMal?: boolean;
  href?: string;
  onClick?: () => void;
}

const CHECK = <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 5.2 2 2 4-4.4" /></svg>;
const EQUIS = <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m3 3 4 4M7 3 3 7" /></svg>;
const CHEV = <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m1 1 6 6-6 6" /></svg>;

const color = (e: EstadoPaso) => (e === "pendiente" ? "var(--line2)" : e === "fallo" ? "var(--bad)" : "var(--accent)");
const sigue = (e: EstadoPaso) => e === "hecho" || e === "fijo";

/** Pasos con pista, como la línea de estado de un pedido en iOS: dentro de un grupo normal, cada
 *  tramo de la pista toma el color del paso al que lleva. */
export function Flujo({ pasos }: { pasos: Paso[] }) {
  const t = useTranslations();
  return (
    <ol className="pnl-grupo pa-flujo">
      {pasos.map((p, i) => {
        const sig = pasos[i + 1];
        const arriba = i ? color(p.estado) : "transparent";
        const abajo = sigue(p.estado) && sig && sig.estado !== "pendiente" ? color(sig.estado === "fallo" ? "hecho" : sig.estado) : "var(--line2)";
        const pulsable = Boolean(p.href || p.onClick);
        const hayValor = Boolean(p.valor);
        const clases = ["pnl-celda", p.sub ? "alta" : "", hayValor && pulsable ? "con-valor" : "", !pulsable ? "sin-chev" : ""].filter(Boolean).join(" ");
        const dentro = (
          <>
            <span className="pa-punto" aria-hidden="true">{p.estado === "hecho" ? CHECK : p.estado === "fallo" ? EQUIS : null}</span>
            <span className="t">
              <b>{p.titulo}</b>
              {p.sub && <small>{p.subMal ? <span className="pa-fallo">{p.sub}</span> : p.sub}</small>}
              {p.estado !== "fijo" && <span className="pnl-solo-lector">{t(`pnl_agente_flujo_${p.estado}`)}</span>}
            </span>
            {hayValor && <span className="valor">{p.valor}</span>}
            {pulsable && CHEV}
          </>
        );
        return (
          <li key={p.clave} className={p.estado} style={{ "--arriba": arriba, "--abajo": abajo } as CSSProperties}>
            {p.href ? <Link href={p.href} className={clases}>{dentro}</Link>
              : p.onClick ? <button type="button" className={clases} onClick={p.onClick}>{dentro}</button>
              : <div className={clases}>{dentro}</div>}
          </li>
        );
      })}
    </ol>
  );
}

const COMPARTIR = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
  </svg>
);

/** Cabecera de grupo con la acción de compartir a la derecha, en petróleo y sin fondo. */
export function CabeceraCompartir({ titulo, onCompartir }: { titulo: string; onCompartir: () => void }) {
  const t = useTranslations();
  return (
    <div className="pa-cab-acc">
      <h2 className="pnl-cab-grupo">{titulo}</h2>
      <button type="button" className="pa-compartir" onClick={onCompartir} aria-label={t("pnl_agente_compartir_aria")}>{COMPARTIR}</button>
    </div>
  );
}

export const ICONO_COMPARTIR = COMPARTIR;
