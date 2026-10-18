"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type PremioPublico } from "@/lib/liga/api";

export function TarjetaPremio({ premio }: { premio: PremioPublico }) {
  const t = useTranslations();
  if (!premio.visible) return null;
  const primero = premio.importes?.["1"] ?? [];
  const completo = premio.importes?.["2"] ?? [];
  return (
    <section className="sec" style={{ border: "1px solid var(--line)", padding: 16, color: "var(--ink)" }}>
      <h2 className="h2">{t("premio_titulo")}</h2>
      <p>{t("premio_cuentas", { count: premio.cuentas ?? 0 })}</p>
      <p className="meta" style={{ color: "var(--muted)" }}>{t("premio_umbrales", {
        basico: premio.umbral_basico ?? 0, completo: premio.umbral_completo ?? 0,
      })}</p>
      <p>{t("premio_importes", { a: primero[0] ?? 0, b: primero[1] ?? 0, c: primero[2] ?? 0,
        d: completo[0] ?? 0, e: completo[1] ?? 0, f: completo[2] ?? 0 })}</p>
      {premio.calculado && <p>{t("premio_calculado", { escalon: premio.escalon ?? 0 })}</p>}
      <Link href="/legal/bases-premio" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>{t("premio_bases")}</Link>
    </section>
  );
}
