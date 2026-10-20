"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";

export function Hora({ iso, formato, zona }: { iso: string; formato: "hora" | "dia" | "fecha"; zona?: string }) {
  const locale = useLocale();
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  const opciones: Intl.DateTimeFormatOptions = formato === "hora"
    ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zona }
    : formato === "dia"
      ? { weekday: "long", day: "numeric", month: "long", timeZone: zona }
      : { day: "numeric", month: "long", timeZone: zona };
  const texto = new Intl.DateTimeFormat(locale, opciones).format(new Date(iso));
  return <time dateTime={iso}>{texto}</time>;
}
