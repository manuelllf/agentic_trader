import { createTranslator } from "next-intl";
import type { Idioma, Textos, Traducir } from "@/lib/criptico/tipos";

export function traductor(idioma: Idioma, textos: Textos): Traducir {
  return createTranslator({ locale: idioma, messages: textos }) as Traducir;
}

export const ruta = (idioma: Idioma) => idioma === "es" ? "/criptico" : "/en/criptico";
