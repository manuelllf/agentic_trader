"use client";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Idioma, Texto } from "@/lib/blog/admin";
import { Hoja } from "../../_panel/ui";

/** Hoja con el artículo en un idioma, tal y como se lee en el blog. */
export default function VistaPrevia({ abierta, texto, idioma, cerrar }: { abierta: boolean; texto: Texto; idioma: Idioma; cerrar: () => void }) {
  const t = useTranslations();
  return <Hoja abierta={abierta} titulo={t("ba_preview")} accion={t("ba_close")} onCerrar={cerrar}>
    {abierta && <article className="pc-previa" lang={idioma}>
      <h3>{texto.titulo || t("ba_preview")}</h3>
      <p>{texto.resumen}</p>
      <div className="pc-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{texto.cuerpo}</ReactMarkdown></div>
    </article>}
  </Hoja>;
}
