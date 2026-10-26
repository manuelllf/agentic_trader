import type { Entrega, Idioma } from "./tipos";
import { fechaMadrid } from "./reloj";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export type EntradaIndice = { numero: number; fecha: string };

export async function listarPublicados(idioma: Idioma): Promise<EntradaIndice[]> {
  const respuesta = await fetch(`${API_URL}/criptico/indice?idioma=${idioma}`, { next: { revalidate: 300 } });
  if (!respuesta.ok) throw new Error("Criptico API unavailable");
  const indice: EntradaIndice[] = await respuesta.json();
  return indice.filter(entrada => entrada.fecha <= fechaMadrid());
}

export async function leerPublicado(idioma: Idioma, numero?: string): Promise<Entrega | null> {
  if (numero !== undefined && (!/^[1-9]\d*$/.test(numero) || !Number.isSafeInteger(Number(numero)))) return null;
  const camino = numero === undefined ? "hoy" : `numero/${numero}`;
  const respuesta = await fetch(`${API_URL}/criptico/${camino}?idioma=${idioma}`, { cache: "no-store" });
  if (respuesta.status === 404) return null;
  if (!respuesta.ok) throw new Error("Criptico API unavailable");
  const entrega: Entrega = await respuesta.json();
  return entrega.acertijo.fecha <= fechaMadrid() ? entrega : null;
}

export async function proximaFecha(idioma: Idioma): Promise<string | null> {
  const respuesta = await fetch(`${API_URL}/criptico/proximo?idioma=${idioma}`, { next: { revalidate: 300 } });
  if (respuesta.status === 404) return null;
  if (!respuesta.ok) throw new Error("Criptico API unavailable");
  const { fecha }: { fecha: string } = await respuesta.json();
  return fecha;
}
