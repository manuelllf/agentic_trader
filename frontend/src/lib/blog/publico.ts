import type { Locale } from "@/i18n/locale";

export type ArticuloResumen = { slug: string; titulo: string; resumen: string; publicado_en: string; palabras: number };
export type Articulo = ArticuloResumen & { cuerpo: string };
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function listarPublicados(idioma: Locale): Promise<ArticuloResumen[]> {
  const respuesta = await fetch(`${API_URL}/blog/articulos?idioma=${idioma}`, { next: { revalidate: 300 } });
  if (!respuesta.ok) throw new Error("Blog API unavailable");
  return respuesta.json();
}

export async function leerPublicado(slug: string, idioma: Locale): Promise<Articulo | null> {
  const respuesta = await fetch(`${API_URL}/blog/articulos/${encodeURIComponent(slug)}?idioma=${idioma}`, { next: { revalidate: 300 } });
  if (respuesta.status === 404) return null;
  if (!respuesta.ok) throw new Error("Blog API unavailable");
  return respuesta.json();
}

export function escaparJsonLd(datos: unknown): string {
  return JSON.stringify(datos).replace(/</g, "\\u003c");
}
