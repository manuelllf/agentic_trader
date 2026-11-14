"use client";

// Cabecera de las páginas de lectura y producto (maqueta Páginas v1): chevron con el título de donde vienes; si se llega
// por un enlace de fuera, la cabecera de las pestañas («⋯» o Entrar, y la campana). `RecordarOrigen` va en el layout.

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { anotarTitulo, cambioDeRuta, leerOrigen, type Origen } from "@/lib/liga/origen";
import { CabeceraApp } from "./CabeceraApp";

/** Anota cada cambio de ruta de la liga (y el título cuando ya está puesto) para saber de dónde se viene. */
export function RecordarOrigen() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    cambioDeRuta(pathname);
    const id = window.setTimeout(() => anotarTitulo(pathname, document.title), 400);
    return () => window.clearTimeout(id);
  }, [pathname]);
  return null;
}

export function CabeceraPagina({ titulo, derecha }: { titulo: string; derecha?: ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [origen, setOrigen] = useState<Origen | null>(null);
  // sessionStorage solo existe en el navegador: se lee tras hidratar para no desajustar el marcado.
  useEffect(() => { setOrigen(pathname ? leerOrigen(pathname) : null); }, [pathname]);
  if (!origen) return <CabeceraApp titulo={titulo} derecha={derecha} />;
  return <header className="cab centrada">
    <button type="button" className="cu-atras" aria-label={t("account_volver_aria", { destino: origen.titulo })}
      onClick={() => router.back()}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      <span>{origen.titulo}</span>
    </button>
    <h1 className="cab-titulo">{titulo}</h1>
    <div className="cab-der">{derecha}</div>
  </header>;
}
