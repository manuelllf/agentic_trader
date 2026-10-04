export const LOCALES = ["es", "en"] as const;
export type Locale = typeof LOCALES[number];
export const LOCALE_COOKIE = "vennett_locale";
export const VISITOR_COOKIE = "vennett_visitor_locale";
export const LOCALE_CHANGED = "vennett-locale-changed";

export function normalizeLocale(value: string | null | undefined): Locale | null {
  const language = value?.trim().toLowerCase().split(/[-_]/)[0];
  return language === "es" || language === "en" ? language : null;
}

export function preferredLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const locale = normalizeLocale(language);
    if (locale) return locale;
  }
  return "es";
}

export function deviceLocale(languages: readonly string[] | undefined, language?: string): Locale {
  return preferredLocale(languages?.length ? languages : language ? [language] : []);
}

export function acceptLanguage(header: string | null | undefined): Locale {
  const candidates = (header ?? "").split(",").map((part, index) => {
    const [language, ...parameters] = part.trim().split(";");
    const parameter = parameters.find((item) => item.trim().startsWith("q="));
    const quality = parameter ? Number(parameter.trim().slice(2)) : 1;
    return { language, index, quality };
  }).filter(({ quality }) => Number.isFinite(quality) && quality > 0 && quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return preferredLocale(candidates.map(({ language }) => language));
}

export function readCookie(name: string, cookies: string): string | null {
  const value = cookies.split(";").find((item) => item.trim().startsWith(`${name}=`));
  if (!value) return null;
  try { return decodeURIComponent(value.trim().slice(name.length + 1)); }
  catch { return null; }
}

export function browserLocale(): Locale {
  if (typeof document === "undefined") return "es";
  return normalizeLocale(readCookie(LOCALE_COOKIE, document.cookie))
    ?? deviceLocale(typeof navigator === "undefined" ? [] : navigator.languages, typeof navigator === "undefined" ? undefined : navigator.language);
}

export function localeTag(locale: string): "es-ES" | "en-US" {
  return normalizeLocale(locale) === "en" ? "en-US" : "es-ES";
}
