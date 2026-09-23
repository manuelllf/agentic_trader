"use client";

/** Icono "ⓘ" que al tocar abre un tooltip propio (no el `title` nativo del navegador) con la
 *  explicación larga — sustituye el texto permanente que antes vivía al lado de cada botón, para
 *  que la UI por defecto quede limpia y el porqué siga a un toque de distancia. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { T } from "@/app/alpha/tokens";

const MARGEN_PX = 8;   // separación mínima al borde de la pantalla
const ANCHO_PX = 224;

export function InfoTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const cerrar = () => setPos(null);
    const onFuera = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cerrar();
    };
    const onEscape = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("mousedown", onFuera);
    document.addEventListener("touchstart", onFuera);
    document.addEventListener("keydown", onEscape);
    // `fixed` no acompaña al scroll: se cierra en vez de quedarse flotando lejos del icono.
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", onFuera);
      document.removeEventListener("touchstart", onFuera);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [open]);

  // `fixed` y no `absolute`: dentro de tablas con scroll horizontal el popover quedaba recortado.
  useLayoutEffect(() => {
    if (!pos) return;
    const r = btnRef.current!.getBoundingClientRect();
    const ancho = Math.min(ANCHO_PX, window.innerWidth - 2 * MARGEN_PX);
    const left = Math.min(Math.max(MARGEN_PX, r.left + r.width / 2 - ancho / 2),
                          window.innerWidth - MARGEN_PX - ancho);
    if (left !== pos.left) setPos({ top: pos.top, left });
  }, [pos]);

  function alternar(e: React.MouseEvent) {
    e.stopPropagation();   // muchos van dentro de filas o tarjetas que se abren al tocar
    if (open) { setPos(null); return; }
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left });
  }

  return (
    <span ref={ref} className="inline-flex">
      {/* El `before` agranda la zona táctil (~34 px) sin cambiar el dibujo de 14 px. */}
      <button ref={btnRef} type="button" onClick={alternar}
              aria-label="Más información" aria-expanded={open}
              className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold leading-none transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:opacity-80"
              style={{ color: T.muted, border: `1px solid ${T.ring}` }}>
        i
      </button>
      {pos && (
        <span role="tooltip"
              className="fixed z-50 whitespace-normal rounded border px-2.5 py-2 text-left text-[10.5px] font-normal normal-case leading-snug tracking-normal shadow-lg"
              style={{ top: pos.top, left: pos.left, width: Math.min(ANCHO_PX, window.innerWidth - 2 * MARGEN_PX),
                      borderColor: T.ring, background: T.panel2, color: T.ink2 }}>
          {text}
        </span>
      )}
    </span>
  );
}
