import type { ReactNode } from "react";
import Link from "next/link";
import "@/app/(blog)/_blog/blog.css";
import type { Locale } from "@/i18n/locale";
import { rutaEnIdioma } from "@/i18n/rutas";

// Las dos palabras que llevan a Quiénes somos y a la política editorial, ya en la ruta del idioma.
export function enlacesFirma(idioma: Locale) {
  const quienes = (texto: ReactNode) => <Link href={rutaEnIdioma("/quienes-somos", idioma)}>{texto}</Link>;
  const politica = (texto: ReactNode) => <Link href={rutaEnIdioma("/politica-editorial", idioma)}>{texto}</Link>;
  return { quienes, politica };
}

export default function FirmaAutor({ children }: { children: ReactNode }) {
  return <p className="firma-autor">{children}</p>;
}
