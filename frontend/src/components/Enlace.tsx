"use client";

// Un `next/link` que mantiene el idioma en la URL: en inglés, las páginas públicas con versión propia
// van a `/en/<ruta>`. El resto de enlaces no cambia.
import Link from "next/link";
import { useLocale } from "next-intl";
import type { ComponentProps } from "react";
import { normalizeLocale } from "@/i18n/locale";
import { rutaEnIdioma } from "@/i18n/rutas";

export default function Enlace({ href, ...resto }: ComponentProps<typeof Link>) {
  const idioma = normalizeLocale(useLocale()) ?? "es";
  return <Link href={typeof href === "string" ? rutaEnIdioma(href, idioma) : href} {...resto} />;
}
