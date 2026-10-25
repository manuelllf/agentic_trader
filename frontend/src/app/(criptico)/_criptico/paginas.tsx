import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadMessages } from "@/i18n/messages";
import { URL_PUBLICA } from "@/lib/sitio";
import { leerPublicado } from "@/lib/criptico/publico";
import type { Idioma, Textos } from "@/lib/criptico/tipos";
import Pagina from "./Pagina";
import Token from "./Token";
import { ruta, traductor } from "./textos";

async function catalogo(idioma: Idioma): Promise<Textos> {
  const mensajes = await loadMessages(idioma);
  return Object.fromEntries(Object.entries(mensajes).filter(([clave]) => clave.startsWith("cr_"))) as Textos;
}

export async function metadataCriptico(idioma: Idioma, numero?: string, accion?: "confirmar" | "baja"): Promise<Metadata> {
  const mensajes = await loadMessages(idioma);
  const t = traductor(idioma, mensajes as Textos);
  const tipo = accion ?? (numero === undefined ? "hoy" : "archivo");
  const title = t(`seo_criptico_${tipo}_titulo`, { numero: numero ?? "" });
  const description = t(`seo_criptico_${tipo}_descripcion`, { numero: numero ?? "" });
  const url = `${URL_PUBLICA}${ruta(idioma)}${accion ? `/${accion}` : numero === undefined ? "" : `/${numero}`}`;
  let indexar = false;
  if (!accion) {
    try { indexar = (await leerPublicado(idioma, numero)) !== null; }
    catch { /* Si la API falla, no se indexa una página sin contenido. */ }
  }
  // Sin hreflang: los juegos de palabras de ambos idiomas no son contenido equivalente.
  return { title, description, alternates: { canonical: url }, robots: { index: indexar, follow: indexar },
    openGraph: { title, description, url, locale: idioma === "es" ? "es_ES" : "en_GB" } };
}

export async function pagina(idioma: Idioma, numero?: string) {
  if (numero !== undefined && (!/^[1-9]\d*$/.test(numero) || !Number.isSafeInteger(Number(numero)))) notFound();
  let entrega;
  try { entrega = await leerPublicado(idioma, numero); }
  catch { /* El cliente conserva el estado de error y permite reintentar. */ }
  // Un número sin publicar es un 404; hoy sin acertijo es la página vacía, que deja suscribirse.
  if (entrega === null && numero !== undefined) notFound();
  return <Pagina idioma={idioma} textos={await catalogo(idioma)} numero={numero === undefined ? undefined : Number(numero)} />;
}

export async function paginaToken(idioma: Idioma, accion: "confirmar" | "baja", token: string | string[] | undefined) {
  return <Token idioma={idioma} textos={await catalogo(idioma)} accion={accion} token={typeof token === "string" ? token : ""} />;
}
