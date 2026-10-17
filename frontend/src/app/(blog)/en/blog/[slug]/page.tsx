import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { Leccion, metadataBlog } from "../../../_blog/paginas";
import Boletin from "../../../_blog/Boletin";

type Props = { params: Promise<{ slug: string }> };
export const revalidate = 300;
export async function generateMetadata({ params }: Props) { return metadataBlog("en", (await params).slug); }
export default async function Page({ params }: Props) {
  const contenido = await Leccion({ idioma: "en", slug: (await params).slug });
  const messages = await loadMessages("en");
  const t = createTranslator({ locale: "en", messages: { blog: messages }, namespace: "blog" }) as unknown as (clave: string, valores?: Record<string, string | number>) => string;
  const boletin = <Boletin key="boletin" idioma="en" variante="articulo" textos={{
    titulo: t("blog_newsletter_article_title"), intro: t("blog_newsletter_intro"), nota: t("blog_newsletter_note"),
    correo: t("blog_newsletter_email"), boton: t("blog_newsletter_button"), revisaTitulo: t("blog_newsletter_check_title"),
    revisaTexto: t("blog_newsletter_check_text"), error: t("blog_newsletter_error"),
  }} />;
  const hijos = Children.map(contenido.props.children, hijo => {
    if (!isValidElement<{ children: ReactNode }>(hijo) || hijo.type !== "article") return hijo;
    const cuerpo = Children.toArray(hijo.props.children);
    const indice = cuerpo.findIndex(elemento => isValidElement(elemento) && elemento.type === "nav");
    cuerpo.splice(indice < 0 ? cuerpo.length : indice, 0, boletin);
    return cloneElement(hijo, {}, cuerpo);
  });
  return cloneElement(contenido, {}, hijos);
}
