"use client";

import { useEffect, useId, useRef, useState, Children, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Contenido = { children: ReactNode; className?: string };
const clases = (base: string, extra?: string) => [base, extra].filter(Boolean).join(" ");

export function Pagina({ titulo, accion, children, className, repetido = false }: Contenido & { titulo: ReactNode; accion?: ReactNode; repetido?: boolean }) {
  return <div className={clases("adm-pagina", className)}><header className="adm-cab"><h1 className={clases("adm-h1", repetido ? "adm-h1-repetido" : undefined)}>{titulo}</h1>{accion}</header>{children}</div>;
}
export function Bloque({ titulo, extra, children, className }: Contenido & { titulo?: ReactNode; extra?: ReactNode }) {
  return <section className={clases("adm-bloque", className)}>{titulo != null && <div className="adm-bloque-cab"><h2 className="adm-h2">{titulo}</h2>{extra}</div>}{children}</section>;
}
export function Cifras({ children, className }: Contenido) { return <div className={clases("adm-cifras", className)}>{children}</div>; }
export function Cifra({ etiqueta, valor, nota, href, tono, className }: { etiqueta: ReactNode; valor: ReactNode; nota?: ReactNode; href?: string; tono?: "mal" | "aviso"; className?: string }) {
  const contenido = <><span className="adm-cifra-etiqueta">{etiqueta}</span><span className={clases("adm-cifra-valor", tono && `adm-tono-${tono}`)}>{valor}</span>{nota != null && <span className="adm-nota">{nota}</span>}</>;
  const css = clases("adm-cifra", className);
  return href ? <Link href={href} className={css}>{contenido}</Link> : <div className={css}>{contenido}</div>;
}
export function Boton({ variante = "sec", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "pri" | "sec" | "texto" }) {
  return <button type={type} className={clases(`adm-btn adm-btn-${variante}`, className)} {...props} />;
}
export function Segmentos<T extends string>({ opciones, valor, alCambiar, etiqueta, className }: { opciones: { valor: T; etiqueta: string; cuenta?: number }[]; valor: T; alCambiar: (valor: T) => void; etiqueta: string; className?: string }) {
  return <div className={clases("adm-seg", className)} role="tablist" aria-label={etiqueta}>{opciones.map(o => <button key={o.valor} type="button" role="tab" aria-selected={valor === o.valor} onClick={() => alCambiar(o.valor)}>{o.etiqueta}{o.cuenta != null && <span className="adm-seg-cuenta">{o.cuenta}</span>}</button>)}</div>;
}
export function Combo<T extends string>({ opciones, valor, alCambiar, etiqueta, className }: { opciones: { valor: T; etiqueta: string; cuenta?: number }[]; valor: T; alCambiar: (valor: T) => void; etiqueta: string; className?: string }) {
  const id = useId();
  const contenedor = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [resaltada, setResaltada] = useState(0);
  const activa = opciones.find(o => o.valor === valor);
  const abrir = () => { setResaltada(Math.max(0, opciones.findIndex(o => o.valor === valor))); setAbierto(true); };
  const cerrar = () => { setAbierto(false); boton.current?.focus(); };
  const elegir = (indice: number) => {
    if (opciones[indice]) alCambiar(opciones[indice].valor);
    cerrar();
  };

  useEffect(() => {
    if (!abierto) return;
    const fuera = (evento: PointerEvent) => {
      if (evento.target instanceof Node && !contenedor.current?.contains(evento.target)) {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierto]);

  return <div ref={contenedor} className={clases("adm-combo", className)}>
    <span id={`${id}-etiqueta`} className="adm-combo-etiqueta">{etiqueta}</span>
    <button ref={boton} id={`${id}-boton`} type="button" className="adm-combo-boton" role="combobox" aria-haspopup="listbox" aria-expanded={abierto}
      aria-controls={abierto ? `${id}-lista` : undefined} aria-labelledby={`${id}-etiqueta ${id}-boton`}
      aria-activedescendant={abierto && opciones[resaltada] ? `${id}-opcion-${resaltada}` : undefined}
      onClick={() => { if (abierto) cerrar(); else { boton.current?.focus(); abrir(); } }}
      onKeyDown={evento => {
        const tecla = evento.key;
        if (!abierto) {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(tecla)) { evento.preventDefault(); abrir(); }
          return;
        }
        if (tecla === "Tab") { cerrar(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(tecla)) return;
        evento.preventDefault();
        if (tecla === "ArrowDown") setResaltada(i => Math.min(opciones.length - 1, i + 1));
        else if (tecla === "ArrowUp") setResaltada(i => Math.max(0, i - 1));
        else if (tecla === "Home") setResaltada(0);
        else if (tecla === "End") setResaltada(opciones.length - 1);
        else if (tecla === "Escape") cerrar();
        else elegir(resaltada);
      }}
      onKeyUp={evento => { if (evento.key === " ") evento.preventDefault(); }}>
      {activa?.etiqueta}{activa?.cuenta != null && <span className="cuenta num">{activa.cuenta}</span>}
      <svg className="adm-combo-flecha" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {abierto && <ul id={`${id}-lista`} role="listbox" className="adm-combo-lista" aria-labelledby={`${id}-etiqueta`}>
      {opciones.map((o, indice) => <li key={o.valor} id={`${id}-opcion-${indice}`} role="option" aria-selected={o.valor === valor}
        className={clases("adm-combo-opcion", [o.valor === valor && "on", indice === resaltada && "resaltada"].filter(Boolean).join(" "))}
        onPointerDown={evento => evento.preventDefault()} onClick={() => elegir(indice)}>
        {o.etiqueta}{o.cuenta != null && <span className="cuenta num">{o.cuenta}</span>}
        {o.valor === valor && <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}
      </li>)}
    </ul>}
  </div>;
}
export function Chip({ tono = "neutro", children, className }: Contenido & { tono?: "bien" | "mal" | "aviso" | "neutro" }) {
  return <span className={clases(`adm-chip adm-chip-${tono}`, className)}>{children}</span>;
}
export function Interruptor({ encendido, alCambiar, etiqueta, deshabilitado, className }: { encendido: boolean; alCambiar: (encendido: boolean) => void; etiqueta: string; deshabilitado?: boolean; className?: string }) {
  return <button type="button" className={clases("adm-interruptor", className)} role="switch" aria-checked={encendido} aria-label={etiqueta} disabled={deshabilitado} onClick={() => alCambiar(!encendido)}><span /></button>;
}
export function Lista({ children, className }: Contenido) { return <div className={clases("adm-lista", className)}>{children}</div>; }
export function Fila({ children, href, onClick, className }: Contenido & { href?: string; onClick?: () => void }) {
  const css = clases("adm-fila", className);
  const [primero, ...resto] = Children.toArray(children);
  const contenido = <><div>{primero}</div><div className="adm-fila-extra">{resto}</div></>;
  if (href) return <Link href={href} onClick={onClick} className={css}>{contenido}</Link>;
  if (onClick) return <button type="button" className={css} onClick={onClick}>{contenido}</button>;
  return <div className={css}>{contenido}</div>;
}
export function Estado({ tipo, children, className }: { tipo: "cargando" | "error" | "vacio"; children?: ReactNode; className?: string }) {
  const t = useTranslations();
  return <p role={tipo === "error" ? "alert" : "status"} className={clases(`adm-estado${tipo === "error" ? " adm-tono-mal" : ""}`, className)}>{children ?? t(`admin_ui_${tipo}`)}</p>;
}
export function Barra({ valor, maximo, tono, className }: { valor: number; maximo: number; tono?: "mal" | "aviso"; className?: string }) {
  const porcentaje = maximo > 0 ? Math.min(100, Math.max(0, valor / maximo * 100)) : 0;
  return <div className={clases("adm-barra", className)}><span className={tono ? `adm-barra-${tono}` : undefined} style={{ width: `${Number.isFinite(porcentaje) ? porcentaje : 0}%` }} /></div>;
}
