"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useLanguage } from "./Provider";
import type { Locale } from "./locale";

function Flag({ locale }: { locale: Locale }) {
  return <svg viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" focusable="false">
    {locale === "es" ? <>
      <path fill="#aa151b" d="M0 0h24v16H0z" />
      <path fill="#f1bf00" d="M0 4h24v8H0z" />
      <path fill="#aa151b" d="M6 6h3v4H6z" />
      <path fill="#f1bf00" d="M6.5 6.5h2v1h-2zM7 8h1v1H7z" />
    </> : <>
      <path fill="#fff" d="M0 0h24v16H0z" />
      {Array.from({ length: 7 }, (_, i) => <path key={i} fill="#b22234" d={`M0 ${i * 32 / 13}h24v${16 / 13}H0z`} />)}
      <path fill="#3c3b6e" d="M0 0h10v8.6H0z" />
      {Array.from({ length: 5 }, (_, row) => Array.from({ length: 6 }, (_, col) =>
        <circle key={`${row}-${col}`} cx={.8 + col * 1.65} cy={.8 + row * 1.7} r=".25" fill="#fff" />))}
    </>}
  </svg>;
}

export function LanguageSelector() {
  const t = useTranslations();
  const { locale, changing, failure, selectLocale } = useLanguage();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
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
    <button ref={trigger} type="button" aria-label={t("common_idioma")} aria-expanded={open}
      disabled={changing} aria-busy={changing} onClick={() => setOpen(value => !value)}>
      <Flag locale={locale} />
      <svg className="language-chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    {open && <span className="language-options" role="group" aria-label={t("common_idioma")}>
      {(["es", "en"] as const).map(language => <button key={language} type="button"
        aria-label={language === "es" ? "Español" : "English"} title={language === "es" ? "Español" : "English"}
        aria-pressed={language === locale} disabled={changing} onClick={() => {
          setOpen(false); trigger.current?.focus(); void selectLocale(language);
        }}><Flag locale={language} /></button>)}
    </span>}
    {failure && <span role="status" className="language-error">{t("common_idioma_error")}</span>}
  </span>;
}
