"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Grupo } from "../../_panel/ui";
import "./pp.css";

export const ICO_MARCA = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const ICO_MAS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
const ICO_ORDEN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" /></svg>
);
export const ICO_ATRAS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
);

/** Campo de texto dentro de un grupo; en las hojas toma el gris de la hoja. */
export function Campo({ etiqueta, pie, ...resto }: { etiqueta: string; pie?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Grupo cabecera={etiqueta} pie={pie}>
      <li><input className="pp-campo" aria-label={etiqueta} autoComplete="off" autoCorrect="off" spellCheck={false} {...resto} /></li>
    </Grupo>
  );
}

export interface MenuOrdenProps<V extends string> {
  /** Texto del botón que lo abre. */
  etiqueta: string;
  titulo: string;
  opciones: { valor: V; etiqueta: string }[];
  valor: V;
  onElegir: (valor: V) => void;
}

/** Menú anclado a su botón, propio: se cierra al elegir, con Escape o tocando fuera. */
export function MenuOrden<V extends string>({ etiqueta, titulo, opciones, valor, onElegir }: MenuOrdenProps<V>) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setAbierto(false); boton.current?.focus(); } };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    caja.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", tecla); };
  }, [abierto]);

  return (
    <div className="pp-menu-caja" ref={caja}>
      <button ref={boton} type="button" className="pp-accion" aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto(a => !a)}>
        {ICO_ORDEN}{etiqueta}
      </button>
      {abierto && (
        <div className="pp-menu" role="menu" aria-label={titulo}>
          <p className="pp-menu-cab" aria-hidden="true">{titulo}</p>
          {opciones.map(o => (
            <button key={o.valor} type="button" role="menuitemradio" aria-checked={o.valor === valor}
              onClick={() => { setAbierto(false); onElegir(o.valor); boton.current?.focus(); }}>
              <span className="marca">{ICO_MARCA}</span>{o.etiqueta}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
