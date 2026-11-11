import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Marca } from "@/app/(liga)/_ui/Marca";
import type { Locale } from "@/i18n/locale";
import type { ArticuloResumen } from "@/lib/blog/publico";
import { SelectorIdioma } from "@/components/SelectorIdioma";

export type Textos = Record<string, string>;
export const rutaBlog = (idioma: Locale, slug?: string) => `${idioma === "en" ? "/en" : ""}/blog${slug ? `/${encodeURIComponent(slug)}` : ""}`;

// Cabecera de un artículo: volver a la lista o, en la lista, el logotipo.
export function Cabecera({ idioma, hrefEs, hrefEn, textos, atras = false }: { idioma: Locale; hrefEs: string; hrefEn: string; textos: Textos; atras?: boolean }) {
  return <header className="blog-header">
    {atras
      ? <Link href={rutaBlog(idioma)} className="blog-atras"><span aria-hidden="true">‹</span> {textos.title}</Link>
      : <Link href="/" className="wordmark"><Marca /></Link>}
    <SelectorIdioma actual={idioma} enlaces={{ es: hrefEs, en: hrefEn }} etiqueta={textos.language_label} />
  </header>;
}

// En las listas, solo la fecha corta; en el artículo, la fecha completa y el tiempo de lectura.
export function Fecha({ articulo, idioma, textos, corta = false }: { articulo: ArticuloResumen; idioma: Locale; textos: Textos; corta?: boolean }) {
  const opciones: Intl.DateTimeFormatOptions = corta ? { day: "numeric", month: "short" } : { dateStyle: "long" };
  const fecha = new Intl.DateTimeFormat(idioma, { ...opciones, timeZone: "Europe/Madrid" }).format(new Date(articulo.publicado_en));
  if (corta) return <time className="blog-fecha" dateTime={articulo.publicado_en}>{fecha}</time>;
  const minutos = String(Math.max(1, Math.round(articulo.palabras / 200)));
  return <p className="blog-meta"><time dateTime={articulo.publicado_en}>{fecha}</time> · {textos.minutes.replace("{count}", minutos)}</p>;
}

export function Destacado({ articulo, idioma, textos }: { articulo: ArticuloResumen; idioma: Locale; textos: Textos }) {
  return <Link className="blog-destacado" href={rutaBlog(idioma, articulo.slug)}>
    <h2 className="blog-titulo">{articulo.titulo}</h2>
    <p className="blog-resumen">{articulo.resumen}</p>
    <Fecha articulo={articulo} idioma={idioma} textos={textos} corta />
  </Link>;
}

export function Fila({ articulo, idioma, textos }: { articulo: ArticuloResumen; idioma: Locale; textos: Textos }) {
  return <li className="blog-fila"><Link href={rutaBlog(idioma, articulo.slug)}>
    <h2 className="blog-titulo">{articulo.titulo}</h2>
    <p className="blog-resumen">{articulo.resumen}</p>
    <Fecha articulo={articulo} idioma={idioma} textos={textos} corta />
  </Link></li>;
}

type NodoMarkdown = { type: string; alt?: string; value?: string; children?: NodoMarkdown[] };
function imagenesComoTexto() {
  return (arbol: NodoMarkdown) => {
    function recorrer(nodo: NodoMarkdown) {
      if (nodo.type === "image" || nodo.type === "imageReference") {
        nodo.type = "text";
        nodo.value = nodo.alt ?? "";
      }
      nodo.children?.forEach(recorrer);
    }
    recorrer(arbol);
  };
}

export function Cuerpo({ cuerpo }: { cuerpo: string }) {
  return <div className="blog-markdown"><ReactMarkdown remarkPlugins={[remarkGfm, imagenesComoTexto]} disallowedElements={["img"]} unwrapDisallowed
    components={{ a: ({ href, children }) => <a href={href} rel={href && /^(https?:)?\/\//i.test(href) ? "noopener noreferrer" : undefined}>{children}</a>,
      img: ({ alt }) => <span>{alt}</span> }}
  >{cuerpo}</ReactMarkdown></div>;
}

// Pie con lo legal; el enlace a la liga va en el artículo, no en cada página.
export function Pie({ textos, articulo = false }: { textos: Textos; articulo?: boolean }) {
  return <footer className="blog-pie"><nav><Link href="/legal/terminos">{textos.terms}</Link><Link href="/legal/privacidad">{textos.privacy}</Link><Link href="/legal/aviso">{textos.legal}</Link></nav>
    <p>{articulo ? textos.article_disclaimer : textos.disclaimer}</p>
  </footer>;
}
