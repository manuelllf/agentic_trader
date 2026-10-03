"use client";

/** Icono "ⓘ" que al tocar abre un tooltip propio (no el `title` nativo del navegador) con la
 *  explicación larga — sustituye el texto permanente que antes vivía al lado de cada botón, para
 *  que la UI por defecto quede limpia y el porqué siga a un toque de distancia. */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { T } from "@/app/(admin)/admin/alpha/tokens";

const MARGEN_PX = 8;   // separación mínima al borde de la pantalla
const ANCHO_PX = 224;

export function InfoTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const tipId = useId();
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
    const alto = tipRef.current?.getBoundingClientRect().height ?? 0;
    const top = r.bottom + 6 + alto > window.innerHeight - MARGEN_PX
      ? Math.max(MARGEN_PX, r.top - alto - 6) : r.bottom + 6;
    if (left !== pos.left || top !== pos.top) setPos({ top, left });
  }, [pos]);

  function alternar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();   // muchos van dentro de filas o tarjetas que se abren al tocar
    if (open) { setPos(null); return; }
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left });
  }

  return (
    <span ref={ref} className="info-tip" style={{ display: "inline-flex", width: 14, height: 14, flexShrink: 0, verticalAlign: "middle" }}>
      {/* El `before` agranda la zona táctil (~34 px) sin cambiar el dibujo de 14 px. */}
      <button ref={btnRef} type="button" onClick={alternar}
              aria-label="Más información" aria-expanded={open}
              aria-describedby={open ? tipId : undefined}
              className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold leading-none transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:opacity-80"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34,
                flexShrink: 0, margin: -10, padding: 10, border: 0, background: "transparent", cursor: "pointer",
                color: `var(--info-ink, ${T.muted})` }}>
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 14, height: 14, flexShrink: 0, borderRadius: "50%", border: `1px solid var(--info-line, ${T.ring})`,
          fontSize: 9.5, fontWeight: 700, lineHeight: 1, boxSizing: "border-box" }}>i</span>
      </button>
      {pos && (
        <span ref={tipRef} id={tipId} role="tooltip"
              className="fixed z-50 whitespace-normal rounded border px-2.5 py-2 text-left text-[10.5px] font-normal normal-case leading-snug tracking-normal shadow-lg"
              style={{ top: pos.top, left: pos.left, width: Math.min(ANCHO_PX, window.innerWidth - 2 * MARGEN_PX),
                      position: "fixed", zIndex: 50, display: "block", boxSizing: "border-box", padding: "8px 10px",
                      borderWidth: 1, borderStyle: "solid", textAlign: "left", fontWeight: 400, lineHeight: 1.4,
                      letterSpacing: "normal", textTransform: "none", whiteSpace: "normal",
                      boxShadow: "0 8px 24px rgba(0,0,0,.12)",
                      maxHeight: "calc(100svh - 16px)", overflowY: "auto",
                      fontSize: "var(--info-size, 10.5px)", borderRadius: "var(--info-radius, 4px)",
                      borderColor: `var(--info-line, ${T.ring})`, background: `var(--info-bg, ${T.panel2})`, color: `var(--info-text, ${T.ink2})` }}>
          {text}
        </span>
      )}
    </span>
  );
}
