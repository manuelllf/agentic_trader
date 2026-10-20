"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export function IndiceLateral({ guias }: { guias: { slug: string; titulo: string }[] }) {
  const pathname = usePathname();
  const t = useTranslations();
  return <nav className="apr-lado" aria-label={t("learn_guias_titulo")}><p className="apr-eyebrow">{t("learn_title")}</p><ol className="apr-indice corto">
    {guias.map(({ slug, titulo }, i) => <li key={slug}><Link href={`/aprender/${slug}`} aria-current={pathname === `/aprender/${slug}` ? "page" : undefined}><span className="apr-n">{i + 1}</span><b>{titulo}</b></Link></li>)}
  </ol></nav>;
}
