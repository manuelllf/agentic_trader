import { Children, cloneElement } from "react";
import { createTranslator } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { Listado, metadataBlog } from "../../_blog/paginas";
import Boletin from "../../_blog/Boletin";

export const revalidate = 300;
export const generateMetadata = () => metadataBlog("en");
export default async function Page() {
  const contenido = await Listado({ idioma: "en" });
  const messages = await loadMessages("en");
  const t = createTranslator({ locale: "en", messages: { blog: messages }, namespace: "blog" }) as unknown as (clave: string, valores?: Record<string, string | number>) => string;
  const boletin = <Boletin key="boletin" idioma="en" variante="pagina" textos={{
    titulo: t("blog_newsletter_title"), intro: t("blog_newsletter_intro"), nota: t("blog_newsletter_note"),
    correo: t("blog_newsletter_email"), boton: t("blog_newsletter_button"), revisaTitulo: t("blog_newsletter_check_title"),
    revisaTexto: t("blog_newsletter_check_text"), error: t("blog_newsletter_error"),
  }} />;
  const hijos = Children.toArray(contenido.props.children);
  hijos.splice(Math.max(0, hijos.length - 1), 0, boletin);
  return cloneElement(contenido, {}, hijos);
}
