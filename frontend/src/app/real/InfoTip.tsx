"use client";

/** Icono "ⓘ" que al pinchar abre un tooltip propio (no el `title` nativo del navegador) con la
 *  explicación larga — sustituye el texto permanente que antes vivía al lado de cada botón, para
 *  que la UI por defecto quede limpia y el porqué siga a un clic de distancia. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { T } from "./tokens";

const MARGEN_PX = 8;   // separación mínima al borde de la pantalla

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [ajuste, setAjuste] = useState(0);   // corrección sobre el centrado, en px
  const ref = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onFuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onFuera);
    return () => document.removeEventListener("mousedown", onFuera);
  }, [open]);

  // Cerca del borde (móvil), el centrado por defecto lo cortaría: se mide y se desplaza lo justo
  // para que quepa entero, en vez de recortarlo.
  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const medir = () => {
      const r = popRef.current!.getBoundingClientRect();
      if (r.left < MARGEN_PX) setAjuste(MARGEN_PX - r.left);
      else if (r.right > window.innerWidth - MARGEN_PX) setAjuste(window.innerWidth - MARGEN_PX - r.right);
      else setAjuste(0);
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" onClick={() => { setAjuste(0); setOpen((v) => !v); }}
              aria-label="Más información" aria-expanded={open}
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9.5px] font-bold leading-none transition-colors hover:opacity-80"
              style={{ color: T.muted, border: `1px solid ${T.ring}` }}>
        i
      </button>
      {open && (
        <span ref={popRef} role="tooltip"
              className="absolute left-1/2 top-full z-10 mt-1.5 w-56 rounded border px-2.5 py-2 text-[10.5px] shadow-lg"
              style={{ borderColor: T.ring, background: T.panel2, color: T.ink2,
                      transform: `translateX(calc(-50% + ${ajuste}px))` }}>
          {text}
        </span>
      )}
    </span>
  );
}
