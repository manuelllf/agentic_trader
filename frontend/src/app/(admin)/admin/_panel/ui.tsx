"use client";

import Link from "next/link";
import { useId, type CSSProperties, type ReactNode } from "react";
import "../../../(liga)/liga/ranking.css";
import "./panel.css";

export { Hoja, type HojaProps } from "../../../(liga)/_ui/Hoja";

const ICO_CHEV = (
  <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m1 1 6 6-6 6" />
  </svg>
);
const ICO_LUPA = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" />
  </svg>
);
const ICO_VACIO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4M8.5 11h5" />
  </svg>
);

/* ---------- Grupo y celdas ---------- */

export interface GrupoProps {
  cabecera?: ReactNode;
  pie?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Lista agrupada de iOS: cabecera y pie en gris fuera de la caja; los hijos son `Celda`. */
export function Grupo({ cabecera, pie, children, className }: GrupoProps) {
  const id = useId();
  return (
    <>
      {cabecera && <h2 className="pnl-cab-grupo" id={`${id}-c`}>{cabecera}</h2>}
      <ul className={["pnl-grupo", className].filter(Boolean).join(" ")} aria-labelledby={cabecera ? `${id}-c` : undefined}
        aria-describedby={pie ? `${id}-p` : undefined}>{children}</ul>
      {pie && <p className="pnl-pie-grupo" id={`${id}-p`}>{pie}</p>}
    </>
  );
}

export interface CeldaProps {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  /** Valor a la derecha, en gris. */
  valor?: ReactNode;
  /** Contador de pendientes; sustituye al valor y no se pinta si es 0. */
  cuenta?: number;
  /** Con `href` o `onClick` la celda es pulsable y lleva chevron. */
  href?: string;
  onClick?: () => void;
  tono?: "normal" | "accion" | "peligro";
  deshabilitada?: boolean;
}

export function Celda({ titulo, subtitulo, valor, cuenta, href, onClick, tono = "normal", deshabilitada = false }: CeldaProps) {
  const pulsable = !deshabilitada && Boolean(href || onClick);
  const hayValor = Boolean(cuenta) || (valor !== undefined && valor !== null && valor !== "");
  const clases = ["pnl-celda", subtitulo ? "alta" : "", hayValor && pulsable ? "con-valor" : "",
    tono !== "normal" ? tono : "", deshabilitada ? "apagada" : ""].filter(Boolean).join(" ");
  const contenido = (
    <>
      <span className="t"><b>{titulo}</b>{subtitulo && <small>{subtitulo}</small>}</span>
      {hayValor ? <span className="valor">{cuenta ? <span className="pnl-cuenta">{cuenta}</span> : valor}</span> : null}
      {pulsable && ICO_CHEV}
    </>
  );
  if (pulsable && href) return <li><Link href={href} className={clases}>{contenido}</Link></li>;
  if (pulsable) return <li><button type="button" className={clases} onClick={onClick}>{contenido}</button></li>;
  return <li><div className={clases} aria-disabled={deshabilitada || undefined}>{contenido}</div></li>;
}

export interface CeldaInterruptorProps {
  titulo: string;
  subtitulo?: ReactNode;
  activo: boolean;
  onCambio: (activo: boolean) => void;
  deshabilitado?: boolean;
}

export function CeldaInterruptor({ titulo, subtitulo, activo, onCambio, deshabilitado = false }: CeldaInterruptorProps) {
  const id = useId();
  return (
    <li>
      <div className={`pnl-celda pnl-interruptor${subtitulo ? " alta" : ""}`}>
        <span className="t" id={id}><b>{titulo}</b>{subtitulo && <small>{subtitulo}</small>}</span>
        <button type="button" role="switch" className="pnl-sw" aria-checked={activo} aria-labelledby={id}
          disabled={deshabilitado} onClick={() => onCambio(!activo)} />
      </div>
    </li>
  );
}

/* ---------- Segmentado, progreso, buscador, chips ---------- */

export interface SegmentadoProps<V extends string | number> {
  etiquetaGrupo: string;
  opciones: { valor: V; etiqueta: string }[];
  valor: V;
  onChange: (valor: V) => void;
}

/** `lv-seg` de la Liga: pulgar que se desliza bajo la opción activa. */
export function Segmentado<V extends string | number>({ etiquetaGrupo, opciones, valor, onChange }: SegmentadoProps<V>) {
  const activo = Math.max(0, opciones.findIndex(o => o.valor === valor));
  return (
    <div className="lv-seg pnl-segmento" style={{ "--n": opciones.length } as CSSProperties} data-activo={activo} role="group" aria-label={etiquetaGrupo}>
      <span className="lv-pulgar" aria-hidden="true" style={{ transform: `translateX(${activo * 100}%)` }} />
      {opciones.map(o => (
        <button key={String(o.valor)} type="button" aria-pressed={o.valor === valor} onClick={() => onChange(o.valor)}>{o.etiqueta}</button>
      ))}
    </div>
  );
}

export function Progreso({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  const pct = Math.max(0, Math.min(100, valor));
  return (
    <span className="pnl-progreso" role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i style={{ width: `${Math.max(2, pct)}%` }} />
    </span>
  );
}

export interface BuscadorProps {
  valor: string;
  onCambio: (valor: string) => void;
  etiqueta: string;
  placeholder?: string;
}

/** Campo de búsqueda sin el estilo del navegador (ni la cruz nativa de `type=search`). */
export function Buscador({ valor, onCambio, etiqueta, placeholder }: BuscadorProps) {
  return (
    <label className="pnl-buscar">
      {ICO_LUPA}
      <input type="text" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
        value={valor} onChange={e => onCambio(e.target.value)} placeholder={placeholder ?? etiqueta} aria-label={etiqueta} />
    </label>
  );
}

export function Chips({ children, etiqueta }: { children: ReactNode; etiqueta?: string }) {
  return <div className="pnl-chips" role="group" aria-label={etiqueta}>{children}</div>;
}

export function ChipFiltro({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="pnl-chip" aria-pressed={activo} onClick={onClick}>{children}</button>;
}

/* ---------- Datos, vacío, esqueleto, barras ---------- */

export function Datos({ items }: { items: { etiqueta: ReactNode; valor: ReactNode }[] }) {
  return (
    <dl className="pnl-datos">
      {items.map((d, i) => <div key={i}><dt style={{ display: "contents" }}><span>{d.etiqueta}</span></dt><dd style={{ display: "contents", margin: 0 }}><b>{d.valor}</b></dd></div>)}
    </dl>
  );
}

export function Vacio({ titulo, texto, icono }: { titulo: string; texto?: string; icono?: ReactNode }) {
  return (
    <div className="pnl-vacio">
      {icono ?? ICO_VACIO}
      <h2>{titulo}</h2>
      {texto && <p>{texto}</p>}
    </div>
  );
}

/** Filas grises con la forma de un grupo, mientras llega el contenido. */
export function Esqueleto({ filas = 3, etiqueta }: { filas?: number; etiqueta?: string }) {
  return (
    <div role="status" aria-busy="true">
      {etiqueta && <span className="pnl-solo-lector">{etiqueta}</span>}
      <ul className="pnl-grupo" aria-hidden="true">
        {Array.from({ length: filas }, (_, i) => (
          <li key={i}><div className="pnl-celda esqueleto"><span className="pnl-esq" style={{ width: `${70 - (i % 3) * 14}%` }} /></div></li>
        ))}
      </ul>
    </div>
  );
}

/** Barras SVG sobre una línea base, con la primera y la última etiqueta en los extremos. */
export function Barras({ valores, etiquetas, etiquetaAria, alto = 92 }: { valores: number[]; etiquetas: [string, string]; etiquetaAria: string; alto?: number }) {
  const ancho = 320;
  const n = Math.max(valores.length, 1);
  const max = Math.max(...valores, 1);
  const bw = ancho / n;
  return (
    <div className="pnl-barras">
      <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={etiquetaAria}>
        {valores.map((v, i) => {
          const a = v ? Math.max(3, (v / max) * (alto - 22)) : 0;
          return <rect key={i} x={(i * bw + bw * 0.18).toFixed(1)} y={(alto - 18 - a).toFixed(1)} width={(bw * 0.64).toFixed(1)} height={a.toFixed(1)}
            rx="2" fill="var(--ink2)" opacity=".55" />;
        })}
        <line x1="0" x2={ancho} y1={alto - 18} y2={alto - 18} stroke="var(--line2)" />
        <text x="0" y={alto - 3} fontSize="11" fill="var(--muted)">{etiquetas[0]}</text>
        <text x={ancho} y={alto - 3} fontSize="11" fill="var(--muted)" textAnchor="end">{etiquetas[1]}</text>
      </svg>
    </div>
  );
}
