import Link from "next/link";
import { useEffect, useState } from "react";
import * as api from "@/lib/criptico/api";
import { fechaDeNumero, resueltoLocal } from "@/lib/criptico/archivo";
import type { EntradaIndice } from "@/lib/criptico/publico";
import type { Idioma, Traducir } from "@/lib/criptico/tipos";
import { ruta } from "./textos";

type Indice = EntradaIndice[] | null;

const fechaCorta = (idioma: Idioma, fecha: string, opciones: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(idioma, { ...opciones, timeZone: "Europe/Madrid" }).format(new Date(`${fecha.slice(0, 10)}T12:00:00Z`));
const rutaNumero = (idioma: Idioma, numero: number) => `${ruta(idioma)}/${numero}`;

// Una petición por idioma: volver a montar la página no la repite.
const indicePorIdioma = new Map<Idioma, EntradaIndice[]>();

// Solo da las fechas de los días de la tira; si el índice no llega, se calculan a partir del actual.
export function useIndice(idioma: Idioma): Indice {
  const [indice, setIndice] = useState<Indice>(indicePorIdioma.get(idioma) ?? null);
  useEffect(() => {
    const guardado = indicePorIdioma.get(idioma);
    if (guardado) { setIndice(guardado); return; }
    let activo = true;
    api.indice(idioma).then(datos => {
      indicePorIdioma.set(idioma, datos);
      if (activo) setIndice(datos);
    }, () => { /* La tira se calcula sin el índice. */ });
    return () => { activo = false; };
  }, [idioma]);
  return indice;
}

// Cinco días seguidos con el que estás viendo en medio, o al final si es de los últimos: siempre se ve dónde estás.
// Se calcula al instante, sin esperar al índice, para que no salte al cargar.
export default function Archivo({ idioma, actual, ultimo, fecha, indice, t }: {
  idioma: Idioma; actual: number; ultimo: number; fecha: string; indice: Indice; t: Traducir;
}) {
  const inicio = Math.max(1, Math.min(actual - 2, ultimo - 4));
  const numeros = Array.from({ length: Math.min(5, ultimo) }, (_, i) => inicio + i);
  return <nav className="cr-dias" aria-label={t("cr_archivo")}>
    {numeros.map(numero => {
      const entrada = indice?.find(e => e.numero === numero);
      const dia = entrada?.fecha ?? fechaDeNumero(fecha, actual, numero);
      const hecho = resueltoLocal(idioma, numero);
      return <Link key={numero} href={rutaNumero(idioma, numero)}
        aria-current={actual === numero ? "page" : undefined} className={`cr-dia${hecho ? " hecho" : ""}`}
        aria-label={`${fechaCorta(idioma, dia, { dateStyle: "long" })}: ${t(hecho ? "cr_hecho" : "cr_pendiente")}`}>
        <span>{numero === ultimo ? t("cr_hoy") : fechaCorta(idioma, dia, { weekday: "short" })}</span>
        <b>{fechaCorta(idioma, dia, { day: "numeric" })}</b><i aria-hidden="true" />
      </Link>;
    })}
  </nav>;
}
