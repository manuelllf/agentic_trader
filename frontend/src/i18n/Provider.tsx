"use client";

import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { LOCALE_CHANGED, LOCALE_COOKIE, normalizeLocale,
  deviceLocale, readCookie, VISITOR_COOKIE, type Locale } from "./locale";

type Account = { id: string; locale: Locale | null };
type LanguageContext = {
  locale: Locale;
  changing: boolean;
  failure: boolean;
  selectLocale: (locale: Locale) => Promise<void>;
  setAccount: (account: Account | null) => void;
};
const Context = createContext<LanguageContext | null>(null);

function writeLocale(locale: Locale, visitor = false) {
  const security = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${security}`;
  if (visitor) document.cookie = `${VISITOR_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${security}`;
  document.documentElement.lang = locale;
  navigator.serviceWorker?.controller?.postMessage({ type: "VENNETT_LOCALE", locale });
}

export function LanguageProvider({ locale: initialLocale, messages: initialMessages, children }: {
  locale: Locale; messages: AbstractIntlMessages; children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState(initialLocale);
  const [messages, setMessages] = useState(initialMessages);
  const [loading, setLoading] = useState(false);
  const [pending, transition] = useTransition();
  const [failure, setFailure] = useState(false);
  const account = useRef<Account | null>(null);
  const defaultLocale = useRef(initialLocale);
  const revision = useRef(0);
  const catalogs = useRef(new Map<Locale, AbstractIntlMessages>([[initialLocale, initialMessages]]));

  useEffect(() => {
    catalogs.current.set(initialLocale, initialMessages);
    if (initialLocale === locale) setMessages(initialMessages);
  }, [initialLocale, initialMessages, locale]);

  const applyLocale = useCallback(async (next: Locale, visitor: boolean) => {
    const ticket = ++revision.current;
    setLoading(true);
    setFailure(false);
    try {
      let catalog = catalogs.current.get(next);
      if (!catalog) {
        const response = await fetch(`/api/i18n/catalog/${next}`, { cache: "force-cache" });
        if (!response.ok) throw new Error("Language catalog unavailable");
        catalog = await response.json() as AbstractIntlMessages;
        catalogs.current.set(next, catalog);
      }
      if (ticket !== revision.current) return;
      writeLocale(next, visitor);
      setMessages(catalog);
      setLocale(next);
      const { refrescarPresentacion } = await import("@/lib/liga/cache");
      if (ticket !== revision.current) return;
      refrescarPresentacion();
      window.dispatchEvent(new CustomEvent(LOCALE_CHANGED, { detail: { locale: next } }));
      transition(() => router.refresh());
    } catch {
      if (ticket === revision.current) setFailure(true);
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }, [router]);

  const selectLocale = useCallback(async (next: Locale) => {
    await applyLocale(next, account.current === null);
    if (!account.current || normalizeLocale(readCookie(LOCALE_COOKIE, document.cookie)) !== next) return;
    const owner = account.current.id;
    const { guardarIdioma } = await import("@/lib/liga/api");
    const result = await guardarIdioma(next, owner);
    if (account.current?.id !== owner) return;
    if (typeof result === "string") { setFailure(true); return; }
    account.current = { id: owner, locale: next };
  }, [applyLocale]);

  const setAccount = useCallback((next: Account | null) => {
    const previous = account.current;
    if (previous?.id === next?.id) return;
    account.current = next;
    if (next?.locale) {
      const current = normalizeLocale(readCookie(LOCALE_COOKIE, document.cookie)) ?? defaultLocale.current;
      if (next.locale !== current) void applyLocale(next.locale, false);
    } else if (next) {
      const visitor = normalizeLocale(readCookie(VISITOR_COOKIE, document.cookie));
      if (visitor) {
        void import("@/lib/liga/api").then(async ({ guardarIdioma }) => {
          const result = await guardarIdioma(visitor, next.id);
          if (account.current?.id !== next.id) return;
          if (typeof result === "string") setFailure(true);
          else account.current = { ...next, locale: visitor };
        });
      }
    } else if (previous) {
      const visitor = normalizeLocale(readCookie(VISITOR_COOKIE, document.cookie))
        ?? deviceLocale(navigator.languages, navigator.language);
      void applyLocale(visitor, false);
    }
  }, [applyLocale]);

  useEffect(() => {
    if (account.current || normalizeLocale(readCookie(LOCALE_COOKIE, document.cookie))) return;
    const detected = deviceLocale(navigator.languages, navigator.language);
    if (detected !== defaultLocale.current) void applyLocale(detected, false);
  }, [applyLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    const send = () => navigator.serviceWorker?.controller?.postMessage({ type: "VENNETT_LOCALE", locale });
    send();
    navigator.serviceWorker?.addEventListener("controllerchange", send);
    return () => navigator.serviceWorker?.removeEventListener("controllerchange", send);
  }, [locale]);

  return <Context.Provider value={{ locale, changing: loading || pending, failure, selectLocale, setAccount }}>
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="America/New_York">
      {children}
    </NextIntlClientProvider>
  </Context.Provider>;
}

export function useLanguage() {
  const context = useContext(Context);
  if (!context) throw new Error("LanguageProvider is required");
  return context;
}
