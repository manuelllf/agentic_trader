import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locale";
import { listarPublicados, leerPublicado, escaparJsonLd, type Articulo } from "@/lib/blog/publico";
import { URL_PUBLICA } from "@/lib/sitio";
import { Cabecera, Fecha, Fila, Cuerpo, Pie, rutaBlog, type Textos } from "./componentes";

async function textosBlog(idioma: Locale): Promise<Textos> {
  const messages = await loadMessages(idioma);
  const t = createTranslator({ locale: idioma, messages: { blog: messages }, namespace: "blog" }) as unknown as (clave: string, valores?: Record<string, string | number>) => string;
  const claves = ["title", "seo", "intro", "empty", "error", "terms", "privacy", "legal", "disclaimer", "practice", "cta", "previous", "next", "switch", "article_disclaimer"];
  return { ...Object.fromEntries(claves.map(key => [key, t(`blog_${key}`)])), minutes: t("blog_minutes", { count: "{count}" }) };
}

export async function metadataBlog(idioma: Locale, slug?: string): Promise<Metadata> {
  const textos = await textosBlog(idioma);
  let articulo: Articulo | null = null;
  if (slug) {
    try { articulo = await leerPublicado(slug, idioma); }
    catch { return { title: textos.seo, description: textos.error, robots: { index: false } }; }
    if (!articulo) notFound();
  }
  const title = articulo?.titulo ?? textos.seo;
  const description = articulo?.resumen ?? textos.intro;
  const url = `${URL_PUBLICA}${rutaBlog(idioma, slug)}`;
  return { title, description, alternates: { canonical: url, languages: {
    es: `${URL_PUBLICA}${rutaBlog("es", slug)}`, en: `${URL_PUBLICA}${rutaBlog("en", slug)}`,
  } }, openGraph: { type: "article", title, description, url, locale: idioma === "es" ? "es_ES" : "en_GB",
    ...(articulo ? { publishedTime: articulo.publicado_en } : {}) } };
}

export async function Listado({ idioma }: { idioma: Locale }) {
  const textos = await textosBlog(idioma);
  const hrefEs = rutaBlog("es");
  const hrefEn = rutaBlog("en");
  let articulos;
  try { articulos = await listarPublicados(idioma); } catch { articulos = null; }
  return <main lang={idioma}><Cabecera idioma={idioma} hrefEs={hrefEs} hrefEn={hrefEn} /><h1>{textos.title}</h1><p className="blog-entradilla">{textos.intro}</p>
    {articulos === null ? <p role="alert">{textos.error}</p> : articulos.length === 0 ? <p>{textos.empty}</p> : <ul className="blog-lista">{articulos.map(articulo => <Fila key={articulo.slug} articulo={articulo} idioma={idioma} textos={textos} />)}</ul>}
    <Pie textos={textos} /></main>;
}

export async function Leccion({ idioma, slug }: { idioma: Locale; slug: string }) {
  const textos = await textosBlog(idioma);
  const hrefEs = rutaBlog("es", slug);
  const hrefEn = rutaBlog("en", slug);
  let articulo;
  try { articulo = await leerPublicado(slug, idioma); }
  catch { return <main lang={idioma}><Cabecera idioma={idioma} hrefEs={hrefEs} hrefEn={hrefEn} /><p role="alert">{textos.error}</p><Pie textos={textos} articulo /></main>; }
  if (!articulo) notFound();
  let articulos;
  try { articulos = await listarPublicados(idioma); } catch { articulos = null; }
  const indice = articulos?.findIndex(item => item.slug === slug) ?? -1;
  const anterior = indice >= 0 ? articulos?.[indice + 1] : undefined;
  const siguiente = indice > 0 ? articulos?.[indice - 1] : undefined;
  const datos = { "@context": "https://schema.org", "@type": "BlogPosting", headline: articulo.titulo, description: articulo.resumen,
    datePublished: articulo.publicado_en, inLanguage: idioma, mainEntityOfPage: `${URL_PUBLICA}${rutaBlog(idioma, slug)}`,
    publisher: { "@type": "Organization", name: "Vennett" } };
  return <main lang={idioma}><Cabecera idioma={idioma} hrefEs={hrefEs} hrefEn={hrefEn} /><article>
    <Fecha articulo={articulo} idioma={idioma} textos={textos} /><h1>{articulo.titulo}</h1><p className="blog-entradilla">{articulo.resumen}</p><Cuerpo cuerpo={articulo.cuerpo} />
    <Link className="blog-boton" href="/liga">{textos.cta}</Link>
    {articulos === null && <p role="alert">{textos.error}</p>}
    <nav className="blog-vecinos">{anterior && <Link href={rutaBlog(idioma, anterior.slug)}>{textos.previous}: {anterior.titulo}</Link>}{siguiente && <Link href={rutaBlog(idioma, siguiente.slug)}>{textos.next}: {siguiente.titulo}</Link>}</nav>
    <script type="application/ld+json">{escaparJsonLd(datos)}</script>
  </article><Pie textos={textos} articulo /></main>;
}
