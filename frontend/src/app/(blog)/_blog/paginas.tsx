import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Marca } from "@/app/(liga)/_ui/Marca";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locale";
import { listarPublicados, leerPublicado, datosArticulo, escaparJsonLd, type Articulo } from "@/lib/blog/publico";
import FirmaAutor from "@/components/FirmaAutor";
import { AUTOR_PUBLICO, URL_PUBLICA } from "@/lib/sitio";
import Boletin from "./Boletin";
import { CabeceraDeLista } from "./CabeceraDeLista";
import { SelectorIdioma } from "@/components/SelectorIdioma";
import { Cabecera, Cuerpo, Destacado, Fecha, Fila, Pie, rutaBlog, type Textos } from "./componentes";

type Traductor = (clave: string, valores?: Record<string, string | number>) => string;

async function traductor(idioma: Locale): Promise<Traductor> {
  const messages = await loadMessages(idioma);
  return createTranslator({ locale: idioma, messages: { blog: messages }, namespace: "blog" }) as unknown as Traductor;
}

async function textosBlog(idioma: Locale): Promise<Textos> {
  const t = await traductor(idioma);
  const claves = ["title", "seo", "intro", "empty", "error", "terms", "privacy", "legal", "disclaimer", "practice", "cta", "previous", "next", "switch", "article_disclaimer", "language_label"];
  return { ...Object.fromEntries(claves.map(key => [key, t(`blog_${key}`)])), minutes: t("blog_minutes", { count: "{count}" }), firma: t("firma_articulo", { autor: AUTOR_PUBLICO }) };
}

async function Formulario({ idioma, titulo }: { idioma: Locale; titulo: "blog_newsletter_title" | "blog_newsletter_article_title" }) {
  const t = await traductor(idioma);
  return <Boletin idioma={idioma} textos={{
    titulo: t(titulo), nota: t("blog_newsletter_note"),
    correo: t("blog_newsletter_email"), boton: t("blog_newsletter_button"), revisaTitulo: t("blog_newsletter_check_title"),
    revisaTexto: t("blog_newsletter_check_text"), error: t("blog_newsletter_error"), correoInvalido: t("blog_newsletter_invalid"),
  }} />;
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
  let articulos;
  try { articulos = await listarPublicados(idioma); } catch { articulos = null; }
  const [destacado, ...resto] = articulos ?? [];
  return <main lang={idioma}>
    <CabeceraDeLista titulo={textos.title}
      izquierda={<Link href="/" className="wordmark"><Marca /></Link>}
      derecha={<SelectorIdioma actual={idioma} enlaces={{ es: rutaBlog("es"), en: rutaBlog("en") }} etiqueta={textos.language_label} />} />
    <Formulario idioma={idioma} titulo="blog_newsletter_title" />
    {articulos === null ? <p role="alert">{textos.error}</p> : articulos.length === 0 ? <p>{textos.empty}</p> : <>
      {destacado && <Destacado articulo={destacado} idioma={idioma} textos={textos} />}
      {resto.length > 0 && <ul className="blog-lista">{resto.map(articulo => <Fila key={articulo.slug} articulo={articulo} idioma={idioma} textos={textos} />)}</ul>}
    </>}
    <Pie textos={textos} /></main>;
}

export async function Leccion({ idioma, slug }: { idioma: Locale; slug: string }) {
  const textos = await textosBlog(idioma);
  const hrefEs = rutaBlog("es", slug);
  const hrefEn = rutaBlog("en", slug);
  let articulo;
  try { articulo = await leerPublicado(slug, idioma); }
  catch { return <main lang={idioma}><Cabecera idioma={idioma} hrefEs={hrefEs} hrefEn={hrefEn} textos={textos} atras /><p role="alert">{textos.error}</p><Pie textos={textos} articulo /></main>; }
  if (!articulo) notFound();
  let articulos;
  try { articulos = await listarPublicados(idioma); } catch { articulos = null; }
  const indice = articulos?.findIndex(item => item.slug === slug) ?? -1;
  const anterior = indice >= 0 ? articulos?.[indice + 1] : undefined;
  const siguiente = indice > 0 ? articulos?.[indice - 1] : undefined;
  const datos = datosArticulo({ articulo, idioma, url: `${URL_PUBLICA}${rutaBlog(idioma, slug)}` });
  return <main lang={idioma}><Cabecera idioma={idioma} hrefEs={hrefEs} hrefEn={hrefEn} textos={textos} atras />
    <article className="blog-articulo">
      <h1>{articulo.titulo}</h1><Fecha articulo={articulo} idioma={idioma} textos={textos} />
      <p className="blog-entradilla">{articulo.resumen}</p><Cuerpo cuerpo={articulo.cuerpo} />
      <FirmaAutor texto={textos.firma} />
      <Formulario idioma={idioma} titulo="blog_newsletter_article_title" />
      <Link className="blog-boton blog-boton-cta" href="/liga">{textos.cta}</Link>
      {articulos === null && <p role="alert">{textos.error}</p>}
      <nav className="blog-vecinos">
        {anterior && <Link href={rutaBlog(idioma, anterior.slug)}><span className="blog-etiqueta">{textos.previous}</span><span className="blog-vecino-titulo">{anterior.titulo}</span></Link>}
        {siguiente && <Link href={rutaBlog(idioma, siguiente.slug)}><span className="blog-etiqueta">{textos.next}</span><span className="blog-vecino-titulo">{siguiente.titulo}</span></Link>}
      </nav>
      <script type="application/ld+json">{escaparJsonLd(datos)}</script>
    </article><Pie textos={textos} articulo /></main>;
}
