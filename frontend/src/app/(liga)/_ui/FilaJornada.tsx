"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { claseSigno, fraseVsIndice, porcentaje } from "@/lib/liga/format";
import { Escudo, type ClaveCasa, type EscudoValor } from "./Escudo";

const Chevron = ({ pendiente = false }: { pendiente?: boolean }) => (
  <svg className="chev" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {pendiente ? <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>
      : <path d="M9 6l6 6-6 6" />}
  </svg>
);

export interface FilaJornadaProps {
  nombre: string;
  escudo: EscudoValor;
  casa?: ClaveCasa | null;
  etiqueta: string;
  rentabilidad: number;
  /** Puntos porcentuales frente al S&P 500; debajo del resultado. */
  diferencia?: number | null;
  puesto?: number;
  /** Sin esto la fila es informativa: no se pulsa ni lleva flecha. */
  onAbrir?: () => void;
  propia?: boolean;
}

/** Fila de «Este mes»: escudo, nombre y resultado de la jornada, la misma en Liga y en Privadas. */
export function FilaJornada({
  nombre, escudo, casa, etiqueta, rentabilidad, diferencia, puesto, onAbrir, propia,
}: FilaJornadaProps) {
  const t = useTranslations();
  const locale = useLocale() === "en" ? "en" : "es";
  const [pendiente, navegar] = useTransition();
  return (
    <button type="button" disabled={!onAbrir}
      className={`jr${casa ? " casa" : ""}${propia ? " me" : ""}${pendiente ? " navegando" : ""}`}
      aria-busy={pendiente || undefined}
      onClick={() => { if (onAbrir && !pendiente) navegar(onAbrir); }}>
      <span className="name">
        {puesto != null && <span className="pos num">{puesto}</span>}
        <Escudo valor={escudo} casa={casa} baldosa tamano={28} etiqueta={t("league_escudo_de", { name: nombre })} />
        <span className="nm">
          <b>{nombre}</b>
          <span className="sub">{etiqueta}</span>
        </span>
      </span>
      <span className="fila-res">
        <span className={`ret num ${claseSigno(rentabilidad)}`}>{porcentaje(rentabilidad, 1, locale)}</span>
        {diferencia != null && (
          <span className="vsp num">{fraseVsIndice(t, diferencia, locale)}</span>
        )}
      </span>
      {onAbrir
        ? (pendiente ? <span className="chev" aria-label={t("league_abriendo", { name: nombre })}>···</span> : <Chevron />)
        : <span />}
    </button>
  );
}
