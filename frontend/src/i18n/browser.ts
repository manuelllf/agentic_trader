import { createTranslator } from "next-intl";
import es from "../../messages/es/system.json";
import en from "../../messages/en/system.json";
import { browserLocale } from "./locale";

const translators = {
  es: createTranslator({ locale: "es", messages: es }),
  en: createTranslator({ locale: "en", messages: en }),
};

export function browserText(key: keyof typeof es, values?: Record<string, string | number>): string {
  return translators[browserLocale()](key, values);
}
