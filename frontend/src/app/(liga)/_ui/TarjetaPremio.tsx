"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { confirmarMayorEdad, type PremioPublico } from "@/lib/liga/api";
import { invalidar } from "@/lib/liga/cache";

export function TarjetaPremio({ premio, sesion, confirmada }: {
  premio: PremioPublico; sesion: boolean; confirmada: boolean;
}) {
  const t = useTranslations();
  const [marcada, setMarcada] = useState(confirmada);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { setMarcada(confirmada); }, [confirmada, sesion]);
  if (!premio.visible) return null;
  const primero = premio.importes?.["1"] ?? [];
  const completo = premio.importes?.["2"] ?? [];
  async function cambiar(valor: boolean) {
    setGuardando(true);
    setError(false);
    try {
      const resultado = await confirmarMayorEdad(valor);
      if (typeof resultado === "string") setError(true);
      else { setMarcada(resultado.confirmada); invalidar("premio", "yo"); }
    } catch { setError(true); }
    finally { setGuardando(false); }
  }
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
      {sesion && <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
        <input type="checkbox" checked={marcada} disabled={guardando}
          onChange={(e) => { void cambiar(e.target.checked); }} />
        {t("premio_edad_casilla")}
      </label>}
      {error && <p role="alert">{t("premio_edad_error")}</p>}
    </section>
  );
}
