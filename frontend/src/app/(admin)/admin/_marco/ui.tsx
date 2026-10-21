"use client";

import { Children, type ButtonHTMLAttributes, type ReactNode } from "react";
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
