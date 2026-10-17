import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import Link from "next/link";
import { loadMessages } from "@/i18n/messages";
import DarseDeBaja from "../../../../_blog/DarseDeBaja";

async function traductor() {
  const messages = await loadMessages("en");
  return createTranslator({ locale: "en", messages: { blog: messages }, namespace: "blog" }) as unknown as (clave: string, valores?: Record<string, string | number>) => string;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await traductor();
  return { title: t("blog_unsubscribe_title"), robots: { index: false, follow: false } };
}

export default async function Page() {
  const t = await traductor();
  return <main lang="en">
    <h1>{t("blog_unsubscribe_title")}</h1><p>{t("blog_unsubscribe_intro")}</p>
    <DarseDeBaja textos={{ boton: t("blog_unsubscribe_button"), espera: t("blog_unsubscribe_wait"), exito: t("blog_unsubscribe_success"),
      invalido: t("blog_unsubscribe_invalid"), error: t("blog_newsletter_error") }} />
    <footer><Link href="/legal/privacidad" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>{t("blog_privacy")}</Link></footer>
  </main>;
}
