"use client";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Idioma, Texto } from "@/lib/blog/admin";

export default function VistaPrevia({ texto, idioma, cerrar }: { texto: Texto; idioma: Idioma; cerrar: () => void }) {
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { anterior?.focus(); };
  }, []);
  return <dialog ref={dialog} className="blog-admin ba-preview" aria-labelledby="ba-preview-title" onCancel={cerrar}>
    <button type="button" className="ba-button" onClick={cerrar}>{t("ba_close")}</button>
    <article lang={idioma}><h1 id="ba-preview-title">{texto.titulo || t("ba_preview")}</h1><p>{texto.resumen}</p>
      <div className="ba-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{texto.cuerpo}</ReactMarkdown></div>
    </article>
  </dialog>;
}
