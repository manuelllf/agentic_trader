import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { acceptLanguage, CABECERA_IDIOMA_RUTA, LOCALE_COOKIE, normalizeLocale } from "./locale";
import { loadMessages } from "./messages";

export default getRequestConfig(async () => {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const locale = normalizeLocale(requestHeaders.get(CABECERA_IDIOMA_RUTA))
    ?? normalizeLocale(store.get(LOCALE_COOKIE)?.value)
    ?? acceptLanguage(requestHeaders.get("accept-language"));
  return { locale, messages: await loadMessages(locale), timeZone: "America/New_York" };
});
