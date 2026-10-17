"use client";

import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/locale";
import es from "../../../../messages/es/blog.json";
import en from "../../../../messages/en/blog.json";

const NOMBRES: Record<Locale, string> = { es: "Español", en: "English" };
const CATALOGOS = { es, en };

export function SelectorIdiomaBlog({ idioma, hrefEs, hrefEn }: { idioma: Locale; hrefEs: string; hrefEn: string }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<Locale | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const etiqueta = CATALOGOS[idioma].blog_language_label;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <span ref={root} className="language-control">
    <button ref={trigger} type="button" aria-label={`${etiqueta}: ${NOMBRES[idioma]}`} aria-expanded={open}
      style={{ minWidth: 44, minHeight: 44 }} onClick={() => setOpen(value => !value)}>
      {idioma.toUpperCase()}
      <svg className="language-chevron" viewBox="0 0 12 12" width="10" height="10" style={{ width: 10, height: 10 }} aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    {open && <span className="language-options" role="group" aria-label={etiqueta}>
      {(["es", "en"] as const).map(language => <a key={language} href={language === "es" ? hrefEs : hrefEn}
        lang={language} hrefLang={language} aria-pressed={language === idioma}
        onPointerEnter={() => setHover(language)} onPointerLeave={() => setHover(null)}
        onClick={() => { setOpen(false); trigger.current?.focus(); }}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 5,
          textAlign: "left", width: "100%", minWidth: 140, minHeight: 44, padding: 8,
          borderRadius: "var(--control-radius)", fontSize: 15, fontWeight: language === idioma ? 600 : 400,
          textDecoration: "none", background: language === idioma
            ? "color-mix(in srgb, currentColor 10%, transparent)"
            : hover === language ? "color-mix(in srgb, currentColor 7%, transparent)" : undefined }}>
        {NOMBRES[language]}
        {language === idioma && <svg viewBox="0 0 14 14" width="14" height="14" style={{ width: 14, height: 14 }} aria-hidden="true" focusable="false"><path d="m3 7 2.5 2.5L11 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>}
      </a>)}
    </span>}
  </span>;
}
