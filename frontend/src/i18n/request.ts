import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { acceptLanguage, LOCALE_COOKIE, normalizeLocale } from "./locale";
import { loadMessages } from "./messages";

export default getRequestConfig(async () => {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value)
    ?? acceptLanguage(requestHeaders.get("accept-language"));
  return { locale, messages: await loadMessages(locale), timeZone: "America/New_York" };
});
