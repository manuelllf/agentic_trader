"use client";

// Selector EN|ES con aspecto de segmentado de iOS, el mismo en portada, críptico y boletín.
// Con `enlaces` cambia de ruta (/en/...) y recuerda la elección; sin ellos avisa con `onElegir`.

import Link from "next/link";
import { recordarIdioma, type Locale } from "@/i18n/locale";
import "./selector-idioma.css";

const ORDEN = ["en", "es"] as const;

type Props = {
  actual: Locale;
  etiqueta: string;
  enlaces?: Record<Locale, string>;
  onElegir?: (idioma: Locale) => void;
  deshabilitado?: boolean;
};

export function SelectorIdioma({ actual, etiqueta, enlaces, onElegir, deshabilitado = false }: Props) {
  return <span className="selector-idioma" role="group" aria-label={etiqueta}>
    {ORDEN.map((codigo) => enlaces
      ? <Link key={codigo} href={enlaces[codigo]} lang={codigo} hrefLang={codigo}
          aria-current={actual === codigo ? "true" : undefined}
          onClick={() => { recordarIdioma(codigo); onElegir?.(codigo); }}>{codigo.toUpperCase()}</Link>
      : <button key={codigo} type="button" lang={codigo} aria-pressed={actual === codigo} disabled={deshabilitado}
          onClick={() => { if (actual !== codigo) onElegir?.(codigo); }}>{codigo.toUpperCase()}</button>)}
  </span>;
}
