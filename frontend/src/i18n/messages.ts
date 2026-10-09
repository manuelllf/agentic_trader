import type { AbstractIntlMessages } from "next-intl";
import type { Locale } from "./locale";

export const DOMAINS = ["common", "landing", "auth", "league", "strategies", "builder",
  "privateLeagues", "account", "planes", "legal", "help", "admin", "alpha", "alphaOperations", "beta", "omega", "system"] as const;

export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  const catalogs = await Promise.all(DOMAINS.map(async (domain) => {
    const catalogModule = await import(`../../messages/${locale}/${domain}.json`);
    return catalogModule.default as Record<string, string>;
  }));
  const merged: Record<string, string> = {};
  for (const catalog of catalogs) {
    for (const [key, value] of Object.entries(catalog)) {
      if (key in merged) throw new Error(`Duplicate i18n key: ${key}`);
      merged[key] = value;
    }
  }
  return merged;
}
