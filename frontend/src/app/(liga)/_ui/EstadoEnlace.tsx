"use client";

import { useTranslations } from "next-intl";
import { useLinkStatus } from "next/link";

/** Next controla el estado real del enlace: no hay temporizadores ni espera artificial. */
export function EstadoEnlace({ texto, icono }: { texto: string; icono: React.ReactNode }) {
  const t = useTranslations();
  const { pending } = useLinkStatus();

  return (
    <span className="tab-contenido" aria-busy={pending || undefined}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icono}
      </svg>
      <span className="tab-texto" data-pending={pending || undefined}>
        {texto}
        {pending && <span className="tab-pendiente" aria-hidden="true" />}
      </span>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {pending ? t("common_abriendo", { texto }) : ""}
      </span>
    </span>
  );
}
