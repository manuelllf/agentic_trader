"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import "./contenido.css";

const ICO_ATRAS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
);

/** Enlace de vuelta a la pantalla anterior, como el «‹ Atrás» de iOS. */
export function Volver({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="pc-volver">{ICO_ATRAS}<span>{children}</span></Link>;
}

type Tono = "primario" | "sec" | "peligro";
const claseTono = (tono: Tono) => (tono === "primario" ? "pc-boton" : `pc-boton ${tono}`);

export function Boton({ tono = "primario", className, ...resto }: ButtonHTMLAttributes<HTMLButtonElement> & { tono?: Tono }) {
  return <button type="button" {...resto} className={[claseTono(tono), className].filter(Boolean).join(" ")} />;
}

export function BotonEnlace({ href, tono = "primario", children }: { href: string; tono?: Tono; children: ReactNode }) {
  return <Link href={href} className={claseTono(tono)}>{children}</Link>;
}

interface BaseCampo {
  id: string;
  etiqueta: string;
  contador?: string;
  nota?: ReactNode;
  error?: string;
}

function Envoltorio({ id, etiqueta, contador, nota, error, prefijo, children }: BaseCampo & { prefijo?: string; children: ReactNode }) {
  return (
    <div className="pc-bloque">
      <label className="pc-etiqueta" htmlFor={id}><span>{etiqueta}</span>{contador && <span className="pc-cuenta">{contador}</span>}</label>
      <div className={`pc-caja${error ? " error" : ""}`}>
        {prefijo && <span className="pc-prefijo" aria-hidden="true">{prefijo}</span>}
        {children}
      </div>
      {error && <p className="pc-error" id={`${id}-error`} role="alert">{error}</p>}
      {nota && <p className="pc-nota" id={`${id}-nota`}>{nota}</p>}
    </div>
  );
}

const describe = (id: string, error?: string, nota?: ReactNode) => (error ? `${id}-error` : nota ? `${id}-nota` : undefined);

export function CampoTexto({ id, etiqueta, contador, nota, error, prefijo, className, ...input }:
  BaseCampo & { prefijo?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Envoltorio id={id} etiqueta={etiqueta} contador={contador} nota={nota} error={error} prefijo={prefijo}>
      <input id={id} className={["pc-campo", className].filter(Boolean).join(" ")} aria-invalid={error ? true : undefined}
        aria-describedby={describe(id, error, nota)} {...input} />
    </Envoltorio>
  );
}

export function CampoArea({ id, etiqueta, contador, nota, error, largo = false, className, ...area }:
  BaseCampo & { largo?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Envoltorio id={id} etiqueta={etiqueta} contador={contador} nota={nota} error={error}>
      <textarea id={id} className={["pc-campo", largo ? "largo" : "", className].filter(Boolean).join(" ")} aria-invalid={error ? true : undefined}
        aria-describedby={describe(id, error, nota)} {...area} />
    </Envoltorio>
  );
}
