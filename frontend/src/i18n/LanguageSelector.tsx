"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useLanguage } from "./Provider";
import type { Locale } from "./locale";

const NOMBRES: Record<Locale, string> = { es: "Español", en: "English" };

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
    <button ref={trigger} type="button" aria-label={`${t("common_idioma")}: ${NOMBRES[locale]}`} aria-expanded={open}
      disabled={changing} aria-busy={changing} onClick={() => setOpen(value => !value)}>
      {locale.toUpperCase()}
      <svg className="language-chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    {open && <span className="language-options" role="group" aria-label={t("common_idioma")}>
      {(["es", "en"] as const).map(language => <button key={language} type="button"
        lang={language}
        aria-pressed={language === locale} disabled={changing} onClick={() => {
          setOpen(false); trigger.current?.focus(); void selectLocale(language);
        }}>
          {NOMBRES[language]}
          {language === locale && <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><path d="m3 7 2.5 2.5L11 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>}
        </button>)}
    </span>}
    {failure && <span role="status" className="language-error">{t("common_idioma_error")}</span>}
  </span>;
}
