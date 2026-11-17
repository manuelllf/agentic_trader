import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadMessages } from "@/i18n/messages";
import { URL_PUBLICA } from "@/lib/sitio";
import { escaparJsonLd } from "@/lib/blog/publico";
import { leerPublicado, listarPublicados } from "@/lib/criptico/publico";
import type { Idioma, Textos } from "@/lib/criptico/tipos";
import ArchivoPagina from "./ArchivoPagina";
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
  const indexar = !accion;
  // Cada acertijo tiene su imagen para compartir (número y pista); la de hoy usa la de la marca.
  const imagen = numero !== undefined && !accion ? [{ url: `${url}/imagen`, width: 1200, height: 630 }] : undefined;
  // Sin hreflang: los juegos de palabras de ambos idiomas no son contenido equivalente.
  return { title, description, alternates: { canonical: url }, robots: { index: indexar, follow: indexar },
    openGraph: { title, description, url, locale: idioma === "es" ? "es_ES" : "en_GB", images: imagen },
    twitter: { card: "summary_large_image", title, description, images: imagen } };
}

export async function metadataArchivoLista(idioma: Idioma): Promise<Metadata> {
  const mensajes = await loadMessages(idioma);
  const t = traductor(idioma, mensajes as Textos);
  const title = t("seo_criptico_lista_titulo");
  const description = t("seo_criptico_lista_descripcion");
  const url = `${URL_PUBLICA}${ruta(idioma)}/archivo`;
  return { title, description, alternates: { canonical: url }, robots: { index: true, follow: true },
    openGraph: { title, description, url, locale: idioma === "es" ? "es_ES" : "en_GB" } };
}

// La lista llega del servidor con las pistas: así está en el HTML. Si la API falla, la página lo dice y deja reintentar.
export async function paginaArchivo(idioma: Idioma) {
  const [indice, textos] = await Promise.all([listarPublicados(idioma).catch(() => null), catalogo(idioma)]);
  // La lista es la página entera: se declara como colección para que los buscadores la lean así.
  const datos = { "@context": "https://schema.org", "@type": "CollectionPage", name: textos.cr_archivo_h1,
    url: `${URL_PUBLICA}${ruta(idioma)}/archivo`, inLanguage: idioma, numberOfItems: indice?.length ?? 0 };
  return <>
    <script type="application/ld+json">{escaparJsonLd(datos)}</script>
    <ArchivoPagina idioma={idioma} textos={textos} indice={indice} />
  </>;
}

export async function pagina(idioma: Idioma, numero?: string) {
  if (numero !== undefined && (!/^[1-9]\d*$/.test(numero) || !Number.isSafeInteger(Number(numero)))) notFound();
  // El acertijo y el de hoy se piden a la vez: el navegador los recibe ya listos.
  const [entrega, hoy] = await Promise.all([
    leerPublicado(idioma, numero).catch(() => undefined),
    numero === undefined ? undefined : leerPublicado(idioma).catch(() => undefined),
  ]);
  // Un número sin publicar es un 404; hoy sin acertijo es la página vacía, que deja suscribirse.
  if (entrega === null && numero !== undefined) notFound();
  // Si la lectura falló, la página lo pide en el navegador y permite reintentar.
  const inicial = entrega ? { entrega, ultimo: hoy?.acertijo.numero ?? entrega.acertijo.numero } : null;
  return <Pagina key={`${idioma}:${numero ?? "hoy"}`} idioma={idioma} textos={await catalogo(idioma)}
    numero={numero === undefined ? undefined : Number(numero)} inicial={inicial} />;
}

export async function paginaToken(idioma: Idioma, accion: "confirmar" | "baja", token: string | string[] | undefined) {
  return <Token idioma={idioma} textos={await catalogo(idioma)} accion={accion} token={typeof token === "string" ? token : ""} />;
}
