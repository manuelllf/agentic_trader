import Link from "next/link";
import { SelectorIdiomaBlog } from "./SelectorIdiomaBlog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Marca } from "@/app/(liga)/_ui/Marca";
import type { Locale } from "@/i18n/locale";
import type { ArticuloResumen } from "@/lib/blog/publico";

export type Textos = Record<string, string>;
export const rutaBlog = (idioma: Locale, slug?: string) => `${idioma === "en" ? "/en" : ""}/blog${slug ? `/${encodeURIComponent(slug)}` : ""}`;

export function Cabecera({ idioma, hrefEs, hrefEn }: { idioma: Locale; hrefEs: string; hrefEn: string }) {
  return <header className="blog-header">
    <Link href="/" className="wordmark"><Marca /></Link>
    <nav><SelectorIdiomaBlog idioma={idioma} hrefEs={hrefEs} hrefEn={hrefEn} /></nav>
  </header>;
}

export function Fecha({ articulo, idioma, textos }: { articulo: ArticuloResumen; idioma: Locale; textos: Textos }) {
  const fecha = new Intl.DateTimeFormat(idioma, { dateStyle: "long", timeZone: "Europe/Madrid" }).format(new Date(articulo.publicado_en));
  return <p className="blog-meta"><time dateTime={articulo.publicado_en}>{fecha}</time> · {textos.minutes.replace("{count}", String(Math.max(1, Math.round(articulo.palabras / 200))))}</p>;
}

export function Fila({ articulo, idioma, textos }: { articulo: ArticuloResumen; idioma: Locale; textos: Textos }) {
  return <li className="blog-fila"><Link href={rutaBlog(idioma, articulo.slug)}>
    <Fecha articulo={articulo} idioma={idioma} textos={textos} /><h2>{articulo.titulo}</h2><p>{articulo.resumen}</p>
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

export function Pie({ textos, articulo = false }: { textos: Textos; articulo?: boolean }) {
  return <footer className="blog-pie"><nav><Link href="/legal/terminos">{textos.terms}</Link><Link href="/legal/privacidad">{textos.privacy}</Link><Link href="/legal/aviso">{textos.legal}</Link></nav>
    <p>{articulo ? textos.article_disclaimer : textos.disclaimer}</p>{!articulo && <Link href="/liga">{textos.practice}</Link>}
  </footer>;
}
