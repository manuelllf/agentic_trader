import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import Link from "next/link";
import { loadMessages } from "@/i18n/messages";
import ConfirmarBoletin from "../../../_blog/ConfirmarBoletin";

async function traductor() {
  const messages = await loadMessages("es");
  return createTranslator({ locale: "es", messages: { blog: messages }, namespace: "blog" }) as unknown as (clave: string, valores?: Record<string, string | number>) => string;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await traductor();
  return { title: t("blog_confirm_title"), robots: { index: false, follow: false } };
}

export default async function Page() {
  const t = await traductor();
  return <main lang="es">
    <h1>{t("blog_confirm_title")}</h1><p>{t("blog_confirm_intro")}</p>
    <ConfirmarBoletin textos={{ boton: t("blog_confirm_button"), espera: t("blog_confirm_wait"), exito: t("blog_confirm_success"),
      invalido: t("blog_confirm_invalid"), error: t("blog_newsletter_error") }} />
    <footer><Link href="/legal/privacidad" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>{t("blog_privacy")}</Link></footer>
  </main>;
}
