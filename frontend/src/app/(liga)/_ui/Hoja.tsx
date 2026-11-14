"use client";

import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from "react";
import "./hoja.css";

// Hoja de iOS para la liga: Cancelar a la izquierda, la acción a la derecha y el asa arriba.
// Se cierra con Cancelar, con Escape, tocando fuera o arrastrando el asa hacia abajo.
export interface HojaProps {
  abierta: boolean;
  titulo: string;
  /** Texto del botón de la izquierda. Sin él, la hoja solo se cierra con la acción o arrastrando. */
  cancelar?: string;
  /** Texto del botón de la derecha. */
  accion: string;
  accionDesactivada?: boolean;
  /** Sin esto, la acción solo cierra la hoja. */
  onAccion?: () => void;
  onCerrar: () => void;
  children: ReactNode;
}

/** Arrastrar más de esto, en píxeles, cierra la hoja. */
const UMBRAL_CIERRE = 90;

export function Hoja({ abierta, titulo, cancelar, accion, accionDesactivada = false, onAccion, onCerrar, children }: HojaProps) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const cuerpo = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ y: number; dy: number; activo: boolean } | null>(null);
  const idTitulo = useId();

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierta && !d.open) d.showModal();
    if (!abierta && d.open) d.close();
  }, [abierta]);

  // El gesto se toma solo al empezar a moverse, para que los toques en Cancelar y Listo sigan siendo clics.
  const bajar = (e: PointerEvent<HTMLDivElement>) => {
    arrastre.current = { y: e.clientY, dy: 0, activo: false };
  };
  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const a = arrastre.current;
    if (!a || !cuerpo.current) return;
    const bajo = e.clientY - a.y;
    if (!a.activo) {
      if (bajo < 6) return;
      a.activo = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      cuerpo.current.style.transition = "none";
    }
    a.dy = Math.max(0, bajo);
    cuerpo.current.style.transform = `translateY(${a.dy}px)`;
  };
  const soltar = () => {
    const a = arrastre.current;
    arrastre.current = null;
    if (!a || !a.activo) return;
    if (cuerpo.current) cuerpo.current.style.transition = "";
    if (a.dy > UMBRAL_CIERRE) onCerrar();
    else if (cuerpo.current) cuerpo.current.style.transform = "";
  };
  const gesto = { onPointerDown: bajar, onPointerMove: mover, onPointerUp: soltar, onPointerCancel: soltar };

  return (
    <dialog ref={dialogo} className="hoja-liga" aria-labelledby={idTitulo}
      onCancel={(e) => { e.preventDefault(); onCerrar(); }}
      onClick={(e) => { if (e.target === dialogo.current) onCerrar(); }}>
      <div className="hoja-liga-cuerpo" ref={cuerpo}>
        <div className="hoja-liga-agarre" {...gesto}>
          <span className="hoja-liga-asa" aria-hidden="true" />
        </div>
        <div className="hoja-liga-nav" {...gesto}>
          <span className="lado">
            {cancelar && <button type="button" className="hoja-liga-acc" onClick={onCerrar}>{cancelar}</button>}
          </span>
          <h2 id={idTitulo}>{titulo}</h2>
          <span className="lado der">
            <button type="button" className="hoja-liga-acc der" disabled={accionDesactivada}
              onClick={onAccion ?? onCerrar}>{accion}</button>
          </span>
        </div>
        <div className="hoja-liga-contenido">{children}</div>
      </div>
    </dialog>
  );
}
