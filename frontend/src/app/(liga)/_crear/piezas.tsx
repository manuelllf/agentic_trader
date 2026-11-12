"use client";

import { useEffect, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";

// Piezas de la maqueta de Crear v1: iconos de trazo propios, cabecera de grupo, deslizador y aviso breve.

export function Chevron() {
  return (
    <svg className="cr-chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m1.5 1.5 5 5.5-5 5.5" /></svg>
  );
}

/** Marca de la opción elegida en una lista; sin marcar ocupa su sitio para que nada salte. */
export function Marca({ marcada }: { marcada: boolean }) {
  return (
    <svg className={marcada ? "cr-check" : "cr-check vacio"} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
  );
}

export function IconoMas() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" /><path d="M12 7.5v9M7.5 12h9" /></svg>
  );
}

export function IconoInfo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" /><path d="M12 11v5.5" /><circle cx="12" cy="7.6" r=".6" fill="currentColor" /></svg>
  );
}

export function IconoLupa() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
  );
}

export function IconoArribaAbajo() {
  return (
    <svg viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true"><path d="m2 6 3-3.5L8 6M2 10l3 3.5L8 10" /></svg>
  );
}

export function IconoAtras() {
  return (
    <svg viewBox="0 0 11 19" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true"><path d="M9.5 1.5 1.5 9.5l8 8" /></svg>
  );
}

export function IconoCheckMenu() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
  );
}

/** Encabezado de grupo de iOS: frase normal en Footnote, con un dato opcional a la derecha. */
export function CabGrupo({ children, derecha }: { children: ReactNode; derecha?: ReactNode }) {
  return <p className="cr-cab-grupo"><span>{children}</span>{derecha != null && <span>{derecha}</span>}</p>;
}

/** Deslizador propio: el tramo lleno se pinta con `--p` para que ningún navegador ponga el suyo. */
export function Deslizador({ valor, min, max, style, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max"> & {
  valor: number; min: number; max: number;
}) {
  const p = max > min ? ((valor - min) / (max - min)) * 100 : 0;
  return <input type="range" className="cr-rango" value={valor} min={min} max={max} {...props}
    style={{ ...style, "--p": `${Math.max(0, Math.min(100, p))}%` } as CSSProperties} />;
}

/** Aviso breve sobre la barra (DESIGN §7): se va solo y, si se puede deshacer, lo ofrece. */
export function AvisoCrear({ texto, onDeshacer, etiquetaDeshacer, onFin, duracion }: {
  texto: string; onDeshacer?: () => void; etiquetaDeshacer?: string; onFin: () => void; duracion?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onFin, duracion ?? (onDeshacer ? 5000 : 3200));
    return () => clearTimeout(t);
  }, [texto, onFin, onDeshacer, duracion]);
  return (
    <div className={onDeshacer ? "cr-toast" : "cr-toast solo"} role="status">
      <span>{texto}</span>
      {onDeshacer && <button type="button" onClick={onDeshacer}>{etiquetaDeshacer}</button>}
    </div>
  );
}
