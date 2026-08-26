"use client";

/** Icono "ⓘ" que al pinchar abre un tooltip propio (no el `title` nativo del navegador) con la
 *  explicación larga — sustituye el texto permanente que antes vivía al lado de cada botón, para
 *  que la UI por defecto quede limpia y el porqué siga a un clic de distancia. */

import { useEffect, useRef, useState } from "react";
import { T } from "./tokens";

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onFuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onFuera);
    return () => document.removeEventListener("mousedown", onFuera);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Más información"
              aria-expanded={open}
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9.5px] font-bold leading-none transition-colors hover:opacity-80"
              style={{ color: T.muted, border: `1px solid ${T.ring}` }}>
        i
      </button>
      {open && (
        <span role="tooltip"
              className="absolute left-1/2 top-full z-10 mt-1.5 w-56 -translate-x-1/2 rounded border px-2.5 py-2 text-[10.5px] shadow-lg"
              style={{ borderColor: T.ring, background: T.panel2, color: T.ink2 }}>
          {text}
        </span>
      )}
    </span>
  );
}
