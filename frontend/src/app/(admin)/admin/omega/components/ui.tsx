"use client";

// Piezas propias de la sala Omega que el kit del panel no trae: botones, campos de hoja, filas de selección y cifra.
import { useId, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { Progreso } from "../../_panel/ui";
import "../omega.css";

export function useIdioma(): "es" | "en" {
  return useLocale() === "en" ? "en" : "es";
}

/** Color solo en cifras de ganar y perder; lo que se lee como cero, con los decimales que se
 *  enseñan, queda neutro. */
export const tonoRet = (n: number, decimales = 1): "po-bien" | "po-mal" | "" => {
  const r = Number(Number(n).toFixed(decimales));
  return r > 0 ? "po-bien" : r < 0 ? "po-mal" : "";
};

const ICO_ATRAS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
const ICO_CHEV = (
  <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m1 1 6 6-6 6" />
  </svg>
);
const ICO_MARCA = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

/** Vuelta a la pantalla anterior dentro de la sala (el marco solo sabe volver a Vennett). */
export function Atras({ texto, onClick }: { texto: string; onClick: () => void }) {
  return <button type="button" className="po-atras" onClick={onClick}>{ICO_ATRAS}<span>{texto}</span></button>;
}

export type TonoBoton = "primario" | "tinte" | "peligro";

export function Boton({ children, tono = "primario", onClick, deshabilitado = false, ocupado = false }:
  { children: ReactNode; tono?: TonoBoton; onClick: () => void; deshabilitado?: boolean; ocupado?: boolean }) {
  return (
    <button type="button" className={`po-boton ${tono}`} disabled={deshabilitado || ocupado} aria-busy={ocupado || undefined} onClick={onClick}>
      {children}
    </button>
  );
}

export function Botones({ children }: { children: ReactNode }) {
  return <div className="po-botones">{children}</div>;
}

interface CampoProps {
  etiqueta: string;
  valor: string;
  onCambio: (valor: string) => void;
  decimal?: boolean;
  multilinea?: boolean;
  placeholder?: string;
  mayusculas?: boolean;
  deshabilitado?: boolean;
  onEnter?: () => void;
}

/** Campo con la etiqueta encima y la caja visible; sin spinners ni estilo del navegador. */
export function Campo({ etiqueta, valor, onCambio, decimal, multilinea, placeholder, mayusculas, deshabilitado, onEnter }: CampoProps) {
  const id = useId();
  return (
    <div>
      <label className="po-etq" htmlFor={id}>{etiqueta}</label>
      <div className="po-caja">
        {multilinea ? (
          <textarea id={id} className="po-campo" rows={3} value={valor} placeholder={placeholder} disabled={deshabilitado}
            onChange={(e) => onCambio(e.target.value)} />
        ) : (
          <input id={id} className={`po-campo${mayusculas ? " mayus" : ""}`} type="text" value={valor} placeholder={placeholder} disabled={deshabilitado}
            inputMode={decimal ? "decimal" : "text"} autoComplete="off" autoCorrect="off" autoCapitalize={mayusculas ? "characters" : "off"} spellCheck={false}
            enterKeyHint={onEnter ? "search" : undefined}
            onChange={(e) => onCambio(e.target.value)} onKeyDown={onEnter ? (e) => { if (e.key === "Enter") onEnter(); } : undefined} />
        )}
      </div>
    </div>
  );
}

/** Fila de selección con círculo marcado (casilla o botón de opción) dentro de un `Grupo`. */
export function FilaCheck({ rol, marcado, titulo, subtitulo, onClick, deshabilitada = false }:
  { rol: "checkbox" | "radio"; marcado: boolean; titulo: ReactNode; subtitulo?: ReactNode; onClick: () => void; deshabilitada?: boolean }) {
  return (
    <li>
      <button type="button" className="po-check" role={rol} aria-checked={marcado} disabled={deshabilitada} onClick={onClick}>
        <span className="marca">{ICO_MARCA}</span>
        <span className="t"><b>{titulo}</b>{subtitulo && <small>{subtitulo}</small>}</span>
      </button>
    </li>
  );
}

/** Fila de lista con barra de progreso debajo: procesos que tardan (buscar señales, evaluar el gate). */
export function FilaProceso({ titulo, subtitulo, valor, onClick, deshabilitada = false, progreso, etiquetaProgreso, cuenta }:
  { titulo: ReactNode; subtitulo?: ReactNode; valor?: ReactNode; onClick: () => void; deshabilitada?: boolean;
    progreso?: number | null; etiquetaProgreso?: string; cuenta?: number }) {
  const hayValor = Boolean(cuenta) || Boolean(valor);
  return (
    <li>
      <button type="button" className={`pnl-celda alta${hayValor ? " con-valor" : ""}`} disabled={deshabilitada} onClick={onClick}>
        <span className="t"><b>{titulo}</b>{subtitulo && <small>{subtitulo}</small>}</span>
        {hayValor && <span className="valor">{cuenta ? <span className="pnl-cuenta">{cuenta}</span> : valor}</span>}
        {ICO_CHEV}
        {progreso != null && <span className="po-fila-prog"><Progreso valor={progreso} etiqueta={etiquetaProgreso ?? ""} /></span>}
      </button>
    </li>
  );
}

/** Fila de texto corrido dentro de un `Grupo` (veredictos, detalles largos). */
export function FilaTexto({ children }: { children: ReactNode }) {
  return <li><div className="po-texto">{children}</div></li>;
}

export function Cifra({ etiqueta, valor, tono, pie }: { etiqueta: string; valor: string; tono?: string; pie?: ReactNode }) {
  return (
    <div className="po-cifra">
      <small>{etiqueta}</small>
      <b className={tono}>{valor}</b>
      {pie && <p>{pie}</p>}
    </div>
  );
}

/** Mensaje de estado que aparece y se va: guardado, error o resultado de un proceso. */
export function Estado({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`po-estado${error ? " error" : ""}`} role={error ? "alert" : "status"}>{children}</p>;
}
